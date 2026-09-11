import { test, expect, type Page, type Locator } from "@playwright/test";
import { getCachedAdminSession, getSiteModules, patchSiteModule } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";
import {
  ensureTelehealthModuleWithDoctors,
  listAllAdminDoctors,
  createAdminDoctorFixture,
  deleteAdminDoctorFixture,
  setDoctorAvailabilityRaw,
  getPublicDoctorSlotsRaw,
  createAppointmentRaw,
  defaultSlotRangeISODates,
  type CreatedFixtureDoctor,
  type FixtureAvailabilitySlot,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — admin doktor listesi (`/admin/telehealth/doctors`) + halka açık doktor detay sayfası
 * (`/doctors/[slug]`) yeniden tasarımının e2e doğrulaması (koordinatörün doğrudan görev talimatı,
 * bu turda). Kapsam:
 *   1) Ücret alanı `Intl.NumberFormat` ile doktorun KENDİ `currency`'sine göre biçimlenir (admin
 *      listede VE detay sayfasında) — sabit ₺ DEĞİL.
 *   2) "Süre" alanı doktorun KENDİ `sessionDurationMin`'ini gösterir — sabit "30 dk" DEĞİL.
 *   3) Admin listede "Saat Dilimi" sütunu (Globe rozet) var.
 *   4) Detay sayfası: hero (avatar/monogram + isim + rozetler) + sağ sticky fiyat paneli; avatar
 *      YOKSA monogram fallback TAŞMADAN render olur.
 *   5) Doktor DETAY sayfasında (header dahil) sepet ikonu YOK; `/doctors` listesinde ve
 *      `/products/*`'ta HÂLÂ VAR (regresyon).
 *
 * `telehealth-clinic.ts` DOCTORS dizisinin 4 demo doktoru FARKLI `currency`/`timeZone` taşır (bkz.
 * `support/telehealth-fixtures.ts::KNOWN_DOCTOR_FULL_NAMES`) — 1/3/5 numaralı maddeler bunlarla
 * doğrulanır. AMA hepsi `sessionDurationMin: 30`dır — madde 2'yi ("süre GERÇEKTEN doktor bazında
 * farklı, sabit değer değil") demo veriyle KANITLAMAK mümkün değildir, bu yüzden bu dosya kendi
 * `sessionDurationMin`'i FARKLI 2 fixture doktoru + avatarsız 1 fixture doktoru (madde 4) API
 * üzerinden GERÇEKTEN oluşturur (bkz. `createAdminDoctorFixture`, mock DEĞİL).
 *
 * Public `/doctors*` sunucu bileşenleri `next: { revalidate: 60 }` ile fetch eder
 * (`server-telehealth.ts`) — proje genelinde bilinen "60sn eventual consistency" (bkz.
 * `TEST_COVERAGE.md`, ürün/blog/portfolyo notu İLE AYNI desen). Yeni oluşturulan fixture
 * doktorların public sayfalarını doğrulayan testler bu yüzden TEK seferlik assertion DEĞİL,
 * `toPass()` + `page.goto` (yeniden istek) polling'i kullanır.
 */
test.describe.configure({ mode: "serial" });

const RUN_SUFFIX = Date.now().toString(36);

let adminToken: string;
let initialTelehealthEnabled: boolean;
let adminPage: Page;
let closeAdminSession: () => Promise<void>;

let durationDoctorShort: CreatedFixtureDoctor;
let durationDoctorLong: CreatedFixtureDoctor;
let noAvatarDoctor: CreatedFixtureDoctor;
let calendarDoctor: CreatedFixtureDoctor;
let bookedCalendarSlot: FixtureAvailabilitySlot;

/** `doctor-card.tsx::initialsFromFullName` İLE BİREBİR AYNI mantık — kasıtlı, BAĞIMSIZ bir kopya
 * (test dosyası uygulama kaynak kodunu import ETMEZ, `@/` path alias'ı Playwright'ın kendi
 * derleme adımında çözülmeyebilir; bkz. bu dosyanın diğer fixture yardımcılarıyla AYNI ilke —
 * gerçek davranışı UI üzerinden gözlemleyip BAĞIMSIZ olarak yeniden hesaplar). */
function expectedInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/** Sepet ikonu — `site-header.tsx`'in `aria-label={\`Sepet, ${itemCount} ürün\`}` deseni. */
function cartLink(page: Page) {
  return page.getByRole("link", { name: /^Sepet,/ });
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(120_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);

  durationDoctorShort = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `Qa Sure Kisa ${RUN_SUFFIX}`,
    bio: "qa-agent fixture — GERÇEKTEN kısa bir seans süresi (20 dk), demo veriden BAĞIMSIZ.",
    languages: ["en"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 20,
    sessionPriceCents: 12345,
    currency: "EUR",
  });
  durationDoctorLong = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `Qa Sure Uzun ${RUN_SUFFIX}`,
    bio: "qa-agent fixture — GERÇEKTEN uzun bir seans süresi (75 dk), demo veriden BAĞIMSIZ.",
    languages: ["en"],
    timeZone: "America/New_York",
    sessionDurationMin: 75,
    sessionPriceCents: 98765,
    currency: "USD",
  });
  noAvatarDoctor = await createAdminDoctorFixture(adminToken, {
    title: "Prof. Dr.",
    fullName: `Qa Monogram Testci ${RUN_SUFFIX}`,
    bio: "qa-agent fixture — avatarMediaId YOK, monogram fallback taşma testi içindir.",
    languages: [],
    timeZone: "Europe/Berlin",
    sessionDurationMin: 45,
    sessionPriceCents: 55500,
    currency: "EUR",
  });

  ({ page: adminPage, close: closeAdminSession } = await createAuthenticatedPage(browser));
});

/**
 * qa-agent — koordinatörün bu turdaki doğrudan görev talimatı: `availability-calendar.tsx`
 * yeniden tasarımının (tarih chip'i/saat slotu AYNI görsel dil, Sabah/Öğleden Sonra/Akşam
 * grupları, seçim onay şeridi, dolu/geçmiş saat disabled) e2e doğrulaması. Demo şablonun 4
 * doktoru (`WEEKDAY_09_17`, bkz. `telehealth-clinic.ts`) YALNIZCA Sabah/Öğleden Sonra
 * gruplarını üretir (09:00-17:00, hiçbir saat 18:00'i AŞMAZ) — "Akşam" grubunun GERÇEKTEN
 * render olduğunu (boş grup gizleme mantığının ters yönü) demo veriyle KANITLAMAK mümkün
 * değildir. Bu yüzden BAĞIMSIZ bir fixture doktor (`calendarDoctor`), haftanın HER günü
 * 08:00-22:00 (`setDoctorAvailabilityRaw`, `PUT /admin/telehealth/doctors/{id}/availability`)
 * müsaitliğiyle oluşturulur — Sabah (08-12) + Öğleden Sonra (12-18) + Akşam (18-22) ÜÇÜ DE
 * garanti altına alınır. Ardından `POST /appointments` ile GERÇEK (mock DEĞİL) bir randevu
 * alınarak o TEK slot "dolu" durumuna geçirilir — "dolu/geçmiş saat disabled" maddesi böylece
 * sahte bir DOM class'ı DEĞİL, backend'in GERÇEKTEN döndürdüğü `available:false` üzerinden
 * doğrulanır.
 */
test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  calendarDoctor = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `Qa Takvim Testci ${RUN_SUFFIX}`,
    bio: "qa-agent fixture — randevu tarih-saat tasarımı (gruplama/onay şeridi/dolu slot) doğrulaması içindir.",
    languages: ["tr"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: 30000,
    currency: "TRY",
  });

  // Haftanın HER günü 08:00-22:00 — Sabah/Öğleden Sonra/Akşam saat gruplarının ÜÇÜNÜN DE en az
  // bir günde birlikte render olduğunu garanti eder (7 kural, `SetDoctorAvailabilityRequestSchema`
  // tavanı 21'in çok altında).
  const allWeekWideOpen = ([1, 2, 3, 4, 5, 6, 7] as const).map((dayOfWeek) => ({ dayOfWeek, startMinute: 480, endMinute: 1320 }));
  await setDoctorAvailabilityRaw(adminToken, calendarDoctor.id, allWeekWideOpen);

  const { from, to } = defaultSlotRangeISODates(30);
  const slotsRes = await getPublicDoctorSlotsRaw(calendarDoctor.slug, from, to);
  if (slotsRes.status !== 200) throw new Error(`calendarDoctor slotları alınamadı: ${slotsRes.status}`);
  const available = (slotsRes.data ?? []).filter((s) => s.available);
  const target = available[0];
  if (!target) throw new Error("calendarDoctor için müsait bir slot bulunamadı — availability kurulumu başarısız.");

  const bookRes = await createAppointmentRaw({
    doctorSlug: calendarDoctor.slug,
    startsAt: target.startsAt,
    patientName: "QA E2E Takvim Testi",
    patientEmail: `qa-e2e-telehealth-calendar-${RUN_SUFFIX}@example.com`,
  });
  if (bookRes.status !== 201 || !bookRes.data) {
    throw new Error(`calendarDoctor için test randevusu oluşturulamadı: ${bookRes.status} ${JSON.stringify(bookRes.error)}`);
  }
  bookedCalendarSlot = target;
});

test.afterAll(async () => {
  if (closeAdminSession) await closeAdminSession();
  for (const doc of [durationDoctorShort, durationDoctorLong, noAvatarDoctor, calendarDoctor]) {
    if (doc) await deleteAdminDoctorFixture(adminToken, doc.id).catch(() => undefined);
  }
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

test("madde 1/3: admin doktor listesi — aynı anda ≥4 FARKLI para birimi sembolü + 'Saat Dilimi' sütunu", async () => {
  await adminPage.goto("/admin/telehealth/doctors");
  await expect(adminPage.getByRole("columnheader", { name: "Saat Dilimi" })).toBeVisible({ timeout: 15_000 });
  // qa-agent bulgusu: paylaşımlı `saas_e2e` veritabanında `telehealth-clinic` şablonu ÖNCEKİ
  // koşumlarda birden fazla kez uygulanmış olabilir (importer'ın slug-benzersizleştirme deseni,
  // bkz. `support/telehealth-fixtures.ts` dosya başlığı) — AYNI isimde birden çok doktor satırı
  // (`strict mode violation`) beklenmelidir. Bu yüzden `.first()` kullanılır; test tekilliği
  // İDDİA ETMEZ, yalnızca en az bir eşleşmenin GÖRÜNÜR olduğunu doğrular.
  await expect(adminPage.getByText("James Whitfield").first()).toBeVisible({ timeout: 15_000 });

  const bodyText = await adminPage.locator("table tbody").innerText();
  // tr-TR biçimlendirmesinde 4 demo doktorun GERÇEK sembolleri (Elif=TRY, James=GBP, Laura=USD, Felix=EUR).
  expect(bodyText, "TRY (₺) görünmüyor — Elif Aydemir").toContain("₺");
  expect(bodyText, "GBP (£) görünmüyor — James Whitfield").toContain("£");
  expect(bodyText, "USD ($) görünmüyor — Laura Bennett").toContain("$");
  expect(bodyText, "EUR (€) görünmüyor — Felix Braun").toContain("€");

  // Saat dilimi rozetleri (Globe ikonlu) — doktor bazında BAĞIMSIZ değerler.
  await expect(adminPage.getByText("Europe/Istanbul", { exact: true }).first()).toBeVisible();
  await expect(adminPage.getByText("Europe/London", { exact: true }).first()).toBeVisible();
  await expect(adminPage.getByText("America/New_York", { exact: true }).first()).toBeVisible();
  await expect(adminPage.getByText("Europe/Berlin", { exact: true }).first()).toBeVisible();
});

test("madde 2: admin doktor listesi — süre alanı doktor bazında GERÇEKTEN farklı (sabit '30 dk' DEĞİL)", async () => {
  await adminPage.goto("/admin/telehealth/doctors");
  const rowShort = adminPage.locator("tr", { hasText: durationDoctorShort.fullName });
  const rowLong = adminPage.locator("tr", { hasText: durationDoctorLong.fullName });
  await expect(rowShort).toBeVisible({ timeout: 15_000 });
  await expect(rowLong).toBeVisible({ timeout: 15_000 });

  await expect(rowShort).toContainText("20 dk");
  await expect(rowLong).toContainText("75 dk");
  // Regresyon — ikisi de "30 dk" GÖSTERMEZ (sabit değer kalıntısı olmadığının kanıtı).
  await expect(rowShort).not.toContainText("30 dk");
  await expect(rowLong).not.toContainText("30 dk");
});

test("madde 1: doktor detay sayfası — doktorun KENDİ para biriminde biçimlendirilmiş ücret (USD $ / GBP £)", async ({ page }, testInfo) => {
  testInfo.setTimeout(180_000);
  const doctors = await listAllAdminDoctors(adminToken);
  // qa-agent bulgusu (bu turda, ortam kaynaklı — bkz. dosya sonu notu): paylaşımlı `saas_e2e`
  // veritabanı, `telehealth-clinic` şablonunun ÖNCEKİ (yeniden başlatılmamış/eski kod çalıştıran
  // bir backend süreciyle uygulanmış) koşumlarından KALMA, `currency`'si YANLIŞ (hepsi "TRY")
  // fixture doktor satırları içerebilir — bu GERÇEK bir uygulama bug'ı DEĞİLDİR (aşağıdaki nota
  // bkz.). Bu yüzden yalnızca isme göre DEĞİL, isim + BEKLENEN currency eşleşmesine göre seçilir;
  // hiçbir satır eşleşmezse test (doğru biçimde) BAŞARISIZ olur — sessizce yanlış bir satır SEÇİLMEZ.
  const laura = doctors.find((d) => d.fullName === "Laura Bennett" && d.currency === "USD");
  const james = doctors.find((d) => d.fullName === "James Whitfield" && d.currency === "GBP");
  expect(laura, "currency=USD olan bir Laura Bennett demo doktoru bulunamadı").toBeTruthy();
  expect(james, "currency=GBP olan bir James Whitfield demo doktoru bulunamadı").toBeTruthy();

  await expect(async () => {
    await page.goto(`/doctors/${laura!.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Laura Bennett", { timeout: 5_000 });
    // `DoctorPricePanel` fiyatı İKİ YERDE render eder (masaüstü sticky panel + mobil sabit alt bar,
    // biri CSS ile gizli ama DOM'da HALA VAR) — `.first()` strict-mode ihlalini önler.
    await expect(page.getByText(/\$450,00/).first()).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000, intervals: [1_000, 2_000, 5_000] });

  await expect(async () => {
    await page.goto(`/doctors/${james!.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("James Whitfield", { timeout: 5_000 });
    await expect(page.getByText(/£450,00/).first()).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000, intervals: [1_000, 2_000, 5_000] });
});

test("madde 2 (detay sayfası): doktor bazında gerçek `sessionDurationMin` — sabit değer DEĞİL", async ({ page }, testInfo) => {
  testInfo.setTimeout(180_000);
  await expect(async () => {
    await page.goto(`/doctors/${durationDoctorShort.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(durationDoctorShort.fullName, { timeout: 5_000 });
    await expect(page.getByText("20 dakika görüşme")).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000, intervals: [1_000, 2_000, 5_000] });

  await expect(async () => {
    await page.goto(`/doctors/${durationDoctorLong.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(durationDoctorLong.fullName, { timeout: 5_000 });
    await expect(page.getByText("75 dakika görüşme")).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000, intervals: [1_000, 2_000, 5_000] });
});

test("madde 4: doktor detay — avatar YOKSA monogram fallback TAŞMADAN render olur", async ({ page }, testInfo) => {
  testInfo.setTimeout(120_000);
  await expect(async () => {
    await page.goto(`/doctors/${noAvatarDoctor.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(noAvatarDoctor.fullName, { timeout: 5_000 });
  }).toPass({ timeout: 90_000, intervals: [1_000, 2_000, 5_000] });

  const initials = expectedInitials(noAvatarDoctor.fullName);
  const monogram = page.locator('[aria-hidden="true"]', { hasText: initials }).first();
  await expect(monogram).toBeVisible();
  await expect(monogram).toHaveText(initials);

  // Avatar KUTUSU (`h-28 w-28 ... overflow-hidden`, `sm:h-36 sm:w-36`) beklenen sabit kare boyutta
  // kalmalı — kare (width≈height) VE makul bir aralıkta (112px/144px tasarım tokenleri civarı).
  const avatarBox = page.locator("div.overflow-hidden.shrink-0").first();
  const box = await avatarBox.boundingBox();
  expect(box, "avatar kutusunun bounding box'ı alınamadı").toBeTruthy();
  expect(Math.abs(box!.width - box!.height)).toBeLessThanOrEqual(1);
  expect(box!.width).toBeGreaterThanOrEqual(100);
  expect(box!.width).toBeLessThanOrEqual(160);

  // Monogram metni KENDİ kutusunun İÇİNDE kalır — `scrollWidth`/`scrollHeight` kutunun kendi
  // `clientWidth`/`clientHeight`'ını AŞMAZ (taşma OLMAMALI, görev tanımı madde 5).
  const overflowCheck = await avatarBox.evaluate((el) => ({
    overflowsX: el.scrollWidth > el.clientWidth + 1,
    overflowsY: el.scrollHeight > el.clientHeight + 1,
  }));
  expect(overflowCheck.overflowsX, "monogram avatar kutusunun DIŞINA taşıyor (yatay)").toBe(false);
  expect(overflowCheck.overflowsY, "monogram avatar kutusunun DIŞINA taşıyor (dikey)").toBe(false);

  // Sayfa genelinde de yatay taşma OLMAMALI (uzun ad `break-words` ile sarmalanır, `truncate` DEĞİL).
  const pageOverflowsX = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  expect(pageOverflowsX, "sayfa genelinde yatay taşma var (muhtemelen uzun doktor adı/monogram)").toBe(false);
});

test("madde 5: doktor DETAY sayfasında (header dahil) sepet ikonu HİÇ görünmez", async ({ page }, testInfo) => {
  testInfo.setTimeout(120_000);
  const doctors = await listAllAdminDoctors(adminToken);
  const anyDoctor = doctors.find((d) => d.fullName === "Felix Braun" && d.currency === "EUR") ?? doctors[0]!;

  await expect(async () => {
    await page.goto(`/doctors/${anyDoctor.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000, intervals: [1_000, 2_000, 5_000] });

  await expect(cartLink(page)).toHaveCount(0);
});

test("REGRESYON — /doctors (liste) ve /products sayfalarında sepet ikonu HÂLÂ görünür (yanlışlıkla kaldırılmadı)", async ({ page }) => {
  await page.goto("/doctors");
  await expect(cartLink(page)).toBeVisible({ timeout: 15_000 });

  await page.goto("/products");
  await expect(cartLink(page)).toBeVisible({ timeout: 15_000 });
});

/**
 * qa-agent — koordinatörün bu turdaki doğrudan görev talimatı (hero görsel bug fix + saat-tarih
 * yeniden tasarımı doğrulaması), db-agent→backend-agent→ui-designer(x2)→frontend-agent(x2)→
 * qa-agent zincirinin SON adımı. `/doctors/elif-aydemir` — `telehealth-clinic` demo şablonunun
 * İLK doktoru, GERÇEK bir `avatarMediaId`'si vardır (bkz. `telehealth-clinic.ts::DOCTORS[0]`,
 * `avatarAssetKey: "avatar-elif-aydemir"`) — bu yüzden hero'da monogram DEĞİL, gerçek görsel
 * beklenir; ham `alt` metni ASLA görünmemelidir (bkz. `doctor-avatar.tsx` dosya başı yorumu,
 * `DoctorAvatarMedia::onError` düzeltmesi).
 */
test("madde 6 (bug fix): doktor detay hero — ham `alt` metni ASLA görünmez, gerçek görsel VEYA monogram render olur", async ({ page }, testInfo) => {
  testInfo.setTimeout(120_000);
  await expect(async () => {
    await page.goto("/doctors/elif-aydemir");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Elif Aydemir", { timeout: 5_000 });
  }).toPass({ timeout: 90_000, intervals: [1_000, 2_000, 5_000] });

  // Kök neden düzeltmesinin ASIL iddiası — kırık görselin ham `alt` metni (Docker ağı host
  // çözümleme sorununun BELİRTİSİ) sayfanın HİÇBİR yerinde görünür METİN olarak YOKTUR.
  await expect(page.getByText(/kolonat|kurumsal proje kapak/i)).toHaveCount(0);

  // Avatar kutusu (`doctor-avatar.tsx::DoctorAvatarMedia` — `relative shrink-0 overflow-hidden`)
  // İÇİNDE ya gerçek bir <img>/<picture> (SafeImage → next/image `fill`) ya da (yükleme
  // hatası/avatar yok durumunda) monogram fallback'i render olur — üçüncü bir durum (ham metin,
  // kırık resim ikonu) YOKTUR.
  const avatarBox = page.locator("div.overflow-hidden.shrink-0").first();
  await expect(avatarBox).toBeVisible();
  const imageCount = await avatarBox.locator("img").count();
  if (imageCount > 0) {
    await expect(avatarBox.locator("img").first()).toBeVisible();
  } else {
    // Gerçek görsel yüklenemediyse (bu ortamda beklenmez, Elif'in GERÇEK bir avatarMediaId'si
    // var — ama savunmacı: yükleme başarısız olsa da monogram TAŞMADAN görünmeli) monogram
    // fallback'e düşülmüş olmalı, ham alt metni DEĞİL.
    const monogram = avatarBox.locator('[aria-hidden="true"]').first();
    await expect(monogram).toBeVisible();
    await expect(monogram).toHaveText(expectedInitials("Elif Aydemir"));
  }
});

test("regresyon: doktor detay (/doctors/elif-aydemir) — ücret doktorun KENDİ para biriminde (₺450,00), sabit değer DEĞİL", async ({ page }, testInfo) => {
  testInfo.setTimeout(120_000);
  await expect(async () => {
    await page.goto("/doctors/elif-aydemir");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Elif Aydemir", { timeout: 5_000 });
    // `DoctorPricePanel` fiyatı İKİ YERDE render eder (masaüstü sticky panel + mobil sabit alt
    // bar) — `.first()` strict-mode ihlalini önler (bkz. madde 1 testinin AYNI notu).
    await expect(page.getByText(/₺450,00/).first()).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000, intervals: [1_000, 2_000, 5_000] });
});

/**
 * qa-agent — `availability-calendar.tsx` yeniden tasarımı: tarih chip'i + saat slotu AYNI görsel
 * dili paylaşıyor (§2.2.1 — `SELECTION_PILL_BASE`/`SELECTION_PILL_SELECTED` ortak sınıfları),
 * saat ızgarası Sabah/Öğleden Sonra/Akşam gruplarına ayrılmış (boş grup gizlenir), seçili tarihe
 * göre grid başlığı ("{gün} için uygun saatler") var, bir saat seçilince altta "{gün} · {saat}"
 * onay şeridi (CalendarCheck ikonlu) görünüyor, dolu bir saat disabled/tıklanamaz.
 *
 * Zaman etiketlerini (`formatDayLabel`/`formatTime`, `tr-TR` + tarayıcının YEREL saat dilimi,
 * bkz. `availability-calendar.tsx::displayTimeZone`) Node tarafında BAĞIMSIZ yeniden hesaplamak
 * (host/tarayıcı saat dilimi FARKLI olabilir) yerine, `page.evaluate` ile TARAYICININ KENDİ
 * `Intl.DateTimeFormat` çağrısı kullanılır — bu, uygulama kaynağını import ETMEK DEĞİLDİR
 * (`@/` alias'ı burada da çözülmez, dosyanın diğer yardımcılarıyla AYNI ilke), yalnızca aynı
 * standart Intl sözleşmesini BAĞIMSIZ olarak çağırıp component'in render ettiği metinle
 * (tarayıcının hydration SONRASI kendi yerel dilimiyle) birebir KARŞILAŞTIRILABİLİR bir referans
 * üretir.
 */
async function selectDayTabWithVisibleLocator(page: Page, locator: Locator): Promise<boolean> {
  const dayTabs = page.getByRole("tab");
  const count = await dayTabs.count();
  for (let i = 0; i < count; i++) {
    if (i > 0) await dayTabs.nth(i).click();
    if (await locator.isVisible().catch(() => false)) return true;
  }
  return false;
}

test("randevu tarih-saat tasarımı: tarih chip'i + saat slotu AYNI görsel dil, saat ızgarası Sabah/Öğleden Sonra/Akşam gruplu, seçim onay şeridi, dolu saat disabled", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(120_000);

  await expect(async () => {
    await page.goto(`/doctors/${calendarDoctor.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(calendarDoctor.fullName, { timeout: 5_000 });
    await expect(page.getByRole("heading", { name: "Müsaitlik ve Randevu" })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000, intervals: [1_000, 2_000, 5_000] });

  // Hidrasyon sonrası ziyaretçi dilimi yeniden hesaplanır (§4.2) — DOM'un oturmasını bekle
  // (`telehealth-public-booking.spec.ts` İLE AYNI desen).
  await page.waitForTimeout(500);

  // Booking sırasında oluşan randevunun tarayıcı-yerel görüntülenen gün/saat etiketleri —
  // component'in KENDİ Intl çağrılarıyla BİREBİR aynı sözleşme, tarayıcı içinde hesaplanır.
  const bookedTimeLabel: string = await page.evaluate(
    (iso) => new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)),
    bookedCalendarSlot.startsAt
  );
  const bookedDayLabel: string = await page.evaluate(
    (iso) => new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" }).format(new Date(iso)),
    bookedCalendarSlot.startsAt
  );

  // 1) Dolu saat — `${time} — dolu, seçilemez` `aria-label`'lı, disabled/tıklanamaz bir `<span>`
  // (role=radio DEĞİL — buton bile değil, gerçekten tıklanamaz bir eleman). Rezervasyonun günü
  // hangi gün sekmesindeyse ORAYA git.
  const dolu = page.locator(`[aria-label="${bookedTimeLabel} — dolu, seçilemez"]`);
  const foundDoluDay = await selectDayTabWithVisibleLocator(page, dolu);
  expect(foundDoluDay, `Rezerve edilen saat (${bookedTimeLabel}) hiçbir gün sekmesinde 'dolu' olarak görünmedi`).toBe(true);
  await expect(dolu).toBeVisible();
  await expect(dolu).toHaveAttribute("aria-disabled", "true");
  await expect(dolu.getByText("Dolu")).toBeVisible();
  // Gerçekten tıklanamaz — `<span>`, `role="radio"` YOK (müsait/seçili slotların ikisi de `<button role="radio">`'dur).
  await expect(dolu).not.toHaveJSProperty("tagName", "BUTTON");

  // 2) Grid başlığı — seçili güne göre "{gün} için uygun saatler".
  await expect(page.getByText(`${bookedDayLabel} için uygun saatler`)).toBeVisible();

  // 3) Sabah/Öğleden Sonra/Akşam — ÜÇÜ DE bu günde render olmalı (08:00-22:00 penceresi).
  const radiogroup = page.getByRole("radiogroup");
  await expect(radiogroup.getByText("Sabah", { exact: true })).toBeVisible();
  await expect(radiogroup.getByText("Öğleden Sonra", { exact: true })).toBeVisible();
  await expect(radiogroup.getByText("Akşam", { exact: true })).toBeVisible();

  // 4) Tarih chip'i (aktif/seçili gün sekmesi) VE müsait bir saat slotu AYNI taban görsel dili
  // paylaşır (`SELECTION_PILL_BASE` — `rounded-[var(--site-radius)]`/`tabular-nums`/
  // `focus-visible:ring-2` ortak sınıfları). Aktif tab HER ZAMAN `aria-selected="true"`.
  const activeDayTab = page.getByRole("tab", { selected: true });
  const availableRadio = page.getByRole("radio", { name: /— müsait$/ }).first();
  await expect(availableRadio).toBeVisible();
  const [activeTabClass, availableRadioClass] = await Promise.all([
    activeDayTab.getAttribute("class"),
    availableRadio.getAttribute("class"),
  ]);
  for (const sharedFragment of ["rounded-[var(--site-radius)]", "tabular-nums", "focus-visible:ring-2"]) {
    expect(activeTabClass, `tarih chip'i sınıfı '${sharedFragment}' içermiyor — paylaşılan taban stil bozuldu`).toContain(sharedFragment);
    expect(availableRadioClass, `saat slotu sınıfı '${sharedFragment}' içermiyor — paylaşılan taban stil bozuldu`).toContain(sharedFragment);
  }
  // Aktif tarih chip'inin İÇİNDE bir Check ikonu (§2.2.1 — seçili durum ortak dili) render olur.
  await expect(activeDayTab.locator("svg")).toHaveCount(1);

  // 5) Müsait bir saate tıkla → seçili duruma geçer (aynı `SELECTION_PILL_SELECTED` ailesi,
  // Check ikonu) VE altta "{gün} · {saat}" onay şeridi (CalendarCheck ikonlu) görünür.
  const availableTimeLabel = (await availableRadio.getAttribute("aria-label"))?.replace(/ — müsait$/, "");
  expect(availableTimeLabel, "müsait slotun aria-label'ından saat etiketi çıkarılamadı").toBeTruthy();
  await availableRadio.click();

  const selectedRadio = page.getByRole("radio", { checked: true });
  await expect(selectedRadio).toBeVisible();
  await expect(selectedRadio).toHaveAttribute("aria-label", `${availableTimeLabel} — seçili`);
  await expect(selectedRadio.locator("svg")).toHaveCount(1);
  const selectedRadioClass = await selectedRadio.getAttribute("class");
  for (const sharedFragment of ["rounded-[var(--site-radius)]", "tabular-nums", "ring-2", "ring-offset-2"]) {
    expect(selectedRadioClass, `seçili saat slotu sınıfı '${sharedFragment}' içermiyor`).toContain(sharedFragment);
  }
  // Aktif tarih chip'i de AYNI "ring-2"/"ring-offset-2" seçili aile sınıflarını taşır (§2.2.1 —
  // seçili durumda ikisi de aynı taban stil).
  const activeTabClassAfter = await page.getByRole("tab", { selected: true }).getAttribute("class");
  for (const sharedFragment of ["ring-2", "ring-offset-2"]) {
    expect(activeTabClassAfter, `aktif tarih chip'i sınıfı '${sharedFragment}' içermiyor`).toContain(sharedFragment);
  }

  // Onay şeridinin dış kapsayıcısı — "Değiştir" butonunun EBEVEYNİ (component'te `<button>` ile
  // "{gün} · {saat}" `<span>`'i AYNI dış `<div>`'in kardeşleridir, bkz. `availability-calendar.tsx`
  // §2.2.5 bloğu).
  const changeButton = page.getByRole("button", { name: "Değiştir" });
  await expect(changeButton).toBeVisible();
  const confirmationStrip = changeButton.locator("..");
  await expect(confirmationStrip).toContainText(`${bookedDayLabel} · ${availableTimeLabel}`);
  await expect(confirmationStrip.locator("svg")).toHaveCount(1); // CalendarCheck ikonu
});

/**
 * qa-agent ortam notu (bu turda, KOD BUG'I DEĞİL) — bu dosyayı ilk yazarken paylaşımlı `saas_e2e`
 * veritabanındaki 20 demo doktorun (5 önceki `telehealth-clinic` import koşumu) TAMAMI `currency`
 * alanında "TRY" gösteriyordu (James/Laura/Felix DAHİL — şablonun tanımladığı GBP/USD/EUR DEĞİL).
 * Kök neden ARAŞTIRILDI: `importer.ts::writeTemplateInTransaction` doğru `currency: doctor.currency`
 * değerini kullanıyor (canlı tanı logu ile doğrulandı: döngüde GBP/USD/EUR/TRY doğru okunuyordu) —
 * gerçek uygulama kodu HER ZAMAN doğruydu. Asıl neden: port 4001'de dinleyen e2e backend süreci,
 * bu telehealth çoklu-para-birimi özelliği kodlanmadan ÖNCE başlatılmış, hiç yeniden başlatılmamış
 * ESKİ bir `tsx` sürecidir (bkz. proje hafızası — "Rebuild after code changes" kuralı BACKEND'in
 * kendisi için de geçerlidir, yalnızca Docker'a özgü değil). Süreç yeniden başlatılınca (bu dosyanın
 * geliştirilmesi sırasında yapıldı) YENİ importlar (`-7` son ekli doktorlar) DOĞRU currency'lerle
 * geldi — bkz. yukarıdaki testlerin `currency` alanına göre EŞLEŞTİRME yapması (yalnızca isme göre
 * DEĞİL) tam olarak bu ortam kalıntısına karşı SAĞLAMLIK içindir. CI'da her koşum taze bir backend
 * süreciyle başladığı için bu sınıf sorun ORTAYA ÇIKMAZ; yerel/kalıcı `saas_e2e` + kalıcı backend
 * süreci kullanan geliştiricilere NOT: bu dosyadaki (veya herhangi bir telehealth) testler kod
 * değişikliğinden sonra MUTLAKA `DOTENV_CONFIG_PATH=.env.e2e npx tsx src/server.ts` sürecini
 * yeniden başlatarak koşulmalıdır.
 */
