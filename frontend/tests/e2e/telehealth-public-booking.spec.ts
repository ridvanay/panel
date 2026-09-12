import { test, expect, type Page, type Locator } from "@playwright/test";
import { getCachedAdminSession, getSiteModules, patchSiteModule } from "./support/api";
import {
  ensureTelehealthModuleWithDoctors,
  listAllAdminDoctors,
  getPublicDoctorSlotsRaw,
  defaultSlotRangeISODates,
  type FixtureDoctor,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — `.claude/architect-scope-telehealth-template.md` §10 (QA kapsamı) madde 8/9. Backend'in
 * `tests/unit/telehealth-availability.test.ts`/`telehealth-timezone.test.ts`/`telehealth-booking.test.ts`
 * + `tests/integration/telehealth.test.ts` ZATEN slot üretimi/DST/saat dilimi dönüşümünü/rezervasyon
 * yarışını `app.inject` seviyesinde kapsıyor — BURADA YENİDEN YAZILMAZ. Bu dosya yalnızca gerçek
 * tarayıcı + gerçek backend + gerçek Postgres (`saas_e2e`) üzerinden "hasta `/doctors`'ta doktor bulur
 * → slot seçer → randevu alır → katılım bağlantısı görür" zincirini VE "aynı slot, farklı ziyaretçi
 * dilimlerinde farklı yerel saatle gösteriliyor" (§4.2 bağlayıcı) davranışını gerçek DOM üzerinden
 * kapatır.
 *
 * `telehealth-template-import.spec.ts`'ten TAMAMEN BAĞIMSIZ çalışır (dosyalar arası sıra garantisi
 * yok) — `ensureTelehealthModuleWithDoctors()` (bkz. `support/telehealth-fixtures.ts`) GERÇEK
 * importer'ı (mock DEĞİL) kullanarak modülü açar ve doktor verisinin var olduğunu garanti eder.
 *
 * Proje kökü CLAUDE.md / memory notu: public sayfalar (`/doctors*`) `next: { revalidate: 60 }` ile
 * önbelleklenir (bkz. `lib/api/server-telehealth.ts`, `lib/api/server-modules.ts`) — bu modülü YENİ
 * açan/YENİ doktor üreten bir kurulumdan hemen sonraki ilk ziyaret en fazla 60 sn eski durumu
 * gösterebilir. Bu BİR HATA DEĞİLDİR (proje belleği: "60s ISR gecikmesi... e2e testleri `toPass` +
 * `reload` ile yoklamalıdır") — aşağıdaki `gotoAndWaitReady()` yardımcısı bunu tolere eder.
 */
test.describe.configure({ mode: "serial" });

let adminToken: string;
let initialTelehealthEnabled: boolean;
let bookableDoctor: FixtureDoctor;
let bookableDoctorFullName: string;

/** `customer-portal-module-toggle.spec.ts`'teki AYNI 60 sn ISR toleransı deseni. */
async function gotoAndWaitReady(page: Page, url: string, ready: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await ready();
  }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });
}

/**
 * qa-agent bulgusu (bu turda GÜNCELLENDİ — `availability-calendar.tsx` §2.3 ay takvimi ızgarası
 * yeniden tasarımı, tarih chip'i/`role="tab"` KALDIRILDI). Kök-neden gerekçesi DEĞİŞMEDİ (proje
 * kökü CLAUDE.md madde 3, flaky kaynağı ELE ALINIR — burada BİLE): `AvailabilityCalendar` mount'ta
 * varsayılan olarak kronolojik en erken müsait GÜNÜ seçili gösterir
 * (`availability-calendar.tsx::earliestAvailableDayKey`). Bu, aranan slotun (ister "herhangi bir
 * müsait slot", ister belirli bir saat etiketi) O günde olduğu ANLAMINA GELMEZ — hidrasyon
 * sonrası `displayTimeZone` değişimi (§4.2) gün gruplamasını kaydırabilir. Düzeltme: sabit
 * bekleme/varsayım yerine, hedef slot (`checkbox`, bkz. aşağıdaki fonksiyonun güncellenmiş başlığı)
 * görünür olana kadar takvimdeki "müsait" gün hücrelerinde SIRAYLA İLERLE (eski `role="tab"`
 * iterasyonunun takvim hücresine uyarlanmış hali).
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Herhangi bir müsait saat slotuna ulaşana kadar takvimdeki "müsait" gün hücrelerinde ilerler.
 *
 * qa-agent GÜNCELLEMESİ (bu turda) — frontend-agent'ın bıraktığı not: [TCT] §9.7.2 (bağlayıcı)
 * TEKİL slot varsayımı KALDIRILDI, saat slotları artık `role="radio"` DEĞİL `role="checkbox"`
 * (1..4 ÇOKLU seçim, `availability-calendar.tsx`). Bu yardımcı fonksiyon adı/dönüş tipi AYNI
 * KALDI (yalnızca tek bir çağıran — madde 8/9 — TEK bir slot seçtiği için isim değiştirilmedi,
 * davranışı hâlâ "ilk müsait slotu bul ve döndür"dür).
 */
async function selectAnyAvailableRadio(page: Page): Promise<Locator> {
  let checkbox = page.getByRole("checkbox", { name: /— müsait$/ }).first();
  if (await checkbox.isVisible().catch(() => false)) return checkbox;

  const availableDays = page.getByRole("button", { name: /— müsait/ });
  const count = await availableDays.count();
  for (let i = 0; i < count; i++) {
    await availableDays.nth(i).click();
    checkbox = page.getByRole("checkbox", { name: /— müsait$/ }).first();
    if (await checkbox.isVisible().catch(() => false)) return checkbox;
  }
  throw new Error("Takvimde görünür hiçbir günde müsait bir saat slotu bulunamadı.");
}

/** `formatCellDatePart` (`availability-calendar.tsx`) İLE BİREBİR AYNI biçim — takvim hücresinin `aria-label`'ının tarih kısmı ("16 Eylül Çarşamba"). */
async function cellDatePartForIso(page: Page, iso: string): Promise<string> {
  return page.evaluate((isoStr) => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return new Intl.DateTimeFormat("tr-TR", { timeZone: tz, day: "numeric", month: "long", weekday: "long" }).format(new Date(isoStr));
  }, iso);
}

/**
 * Belirli bir ISO zaman damgasının karşılık geldiği takvim hücresine gider (gerekirse ay ileri
 * sarılır, bkz. dosya başı yorumu), hücreye tıklar ve o zaman damgasının saat slotu `checkbox`'ını
 * döndürür — §4.2 saat dilimi testleri GİBİ belirli bir referans slotu arayan senaryolar içindir
 * ("herhangi bir müsait slot" için `selectAnyAvailableRadio` yeterlidir).
 */
async function selectSpecificSlot(page: Page, iso: string): Promise<Locator> {
  const datePart = await cellDatePartForIso(page, iso);
  const dayCell = page.getByRole("button", { name: new RegExp(`^${escapeRegExp(datePart)} —`) });
  for (let i = 0; i < 3 && !(await dayCell.first().isVisible().catch(() => false)); i++) {
    await page.getByRole("button", { name: "Sonraki ay" }).click();
  }
  await expect(dayCell.first()).toBeVisible({ timeout: 15_000 });
  await dayCell.first().click();

  const timeLabel = await page.evaluate((isoStr) => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return new Intl.DateTimeFormat("tr-TR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(isoStr));
  }, iso);
  // qa-agent GÜNCELLEMESİ (bu turda) — bkz. `selectAnyAvailableRadio()` başlığındaki AYNI not:
  // slot rolü artık `checkbox`dır.
  return page.getByRole("checkbox", { name: new RegExp(`^${escapeRegExp(timeLabel)} —`) });
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(150_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;

  await ensureTelehealthModuleWithDoctors(adminToken);

  const doctors = await listAllAdminDoctors(adminToken);
  const { from, to } = defaultSlotRangeISODates(30);
  let picked: FixtureDoctor | undefined;
  for (const doctor of doctors) {
    const slotsRes = await getPublicDoctorSlotsRaw(doctor.slug, from, to);
    if (slotsRes.status === 200 && (slotsRes.data ?? []).some((s) => s.available)) {
      picked = doctor;
      break;
    }
  }
  if (!picked) throw new Error("Rezervasyon testleri için müsait slotu olan bir doktor bulunamadı.");
  bookableDoctor = picked;
  bookableDoctorFullName = `${picked.title} ${picked.fullName}`.trim();
});

test.afterAll(async () => {
  // `customer-portal-module-toggle.spec.ts::initialProductsModuleEnabled` İLE AYNI ilke — yalnızca
  // BU dosyanın değiştirdiği global durumu (modül aç/kapa) geri yazar, içerik SİLİNMEZ (bkz.
  // `support/telehealth-fixtures.ts` dosya başlığı — `Appointment.doctor` `onDelete: Restrict`).
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

test("madde 8: /doctors listesi + uzmanlık filtresi → doktor detayına git → slot seç → randevu al → onay ekranında katılım bağlantısı var", async ({
  page,
}) => {
  test.setTimeout(120_000);

  // qa-agent notu — `.first()` KASITLI: paylaşımlı `saas_e2e` veritabanında AYNI isimli birden
  // fazla doktor (leftover fixture verisi, `support/telehealth-fixtures.ts` başlığındaki "leftover
  // satırlar sonraki koşumları BOZMAZ" felsefesi) birikebilir — bu test tek bir doktorun KİMLİĞİNİ
  // değil, listeleme/filtre/rezervasyon AKIŞININ ÇALIŞTIĞINI doğrular.
  await gotoAndWaitReady(page, "/doctors", async () => {
    await expect(page.getByRole("heading", { name: "Doktorlarımız" })).toBeVisible();
    await expect(page.getByText(bookableDoctorFullName).first()).toBeVisible();
  });

  // Uzmanlık filtresi — doktorun kendi uzmanlığı seçildiğinde hâlâ listede kalmalı.
  if (bookableDoctor.specialty) {
    await page.getByLabel("Uzmanlığa göre filtrele").selectOption(bookableDoctor.specialty.slug);
    await expect(page).toHaveURL(new RegExp(`specialty=${bookableDoctor.specialty.slug}`));
    await expect(page.getByText(bookableDoctorFullName).first()).toBeVisible();
  }

  // Arama filtresi — doktorun adına göre arayınca hâlâ listede kalmalı (debounce'lu, `q` URL'e yazılır).
  await page.getByLabel("Doktor ara").fill(bookableDoctor.fullName);
  await expect(page).toHaveURL(/[?&]q=/, { timeout: 5_000 });
  await expect(page.getByText(bookableDoctorFullName).first()).toBeVisible();

  // Aynı isimli birden fazla kart olsa da (yukarıdaki not) HANGİSİNE tıklandığı ÖNEMLİ DEĞİL —
  // rezervasyon akışı doktordan BAĞIMSIZ olarak aynı şekilde çalışır.
  await page.getByRole("link", { name: bookableDoctorFullName }).first().click();
  await expect(page).toHaveURL(/\/doctors\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "Müsaitlik ve Randevu" })).toBeVisible();

  // Hidrasyon sonrası ziyaretçi dilimi yeniden hesaplanır (§4.2) — DOM'un oturmasını bekle.
  await page.waitForTimeout(500);

  const doctorSlugMatch = page.url().match(/\/doctors\/([^/?]+)$/);
  const doctorSlug = doctorSlugMatch?.[1];
  expect(doctorSlug, "doktor slug'ı sayfa URL'inden çıkarılamadı").toBeTruthy();

  // bkz. dosya başı `selectAnyAvailableRadio()` yorumu — varsayılan/İLK gün HER ZAMAN müsait bir
  // slot İÇERMEYEBİLİR (saat-bağımlı), bu yüzden bulunana kadar takvim hücrelerinde ilerlenir.
  const availableSlot = await selectAnyAvailableRadio(page);
  const selectedTimeLabel = (await availableSlot.getAttribute("aria-label"))?.replace(/ — müsait$/, "");
  expect(selectedTimeLabel, "müsait slotun aria-label'ından saat etiketi çıkarılamadı").toBeTruthy();
  await availableSlot.click();

  // [TCT] §9.7.2 (bağlayıcı) — qa-agent GÜNCELLEMESİ (bu turda, frontend-agent'ın bıraktığı not):
  // tekil `POST /appointments` DEPRECATED oldu, yerine çoklu-slot `POST /appointments/bookings`
  // geldi (`slots: string[]`, tek slot seçilse dahi `slots: [iso]`). GERÇEK ağ isteğinin gövdesini
  // yakala (mock DEĞİL — `route.continue()` isteğin GERÇEK e2e backend'ine ulaşmasına izin verir).
  let capturedBody: { doctorSlug?: string; slots?: string[] } | undefined;
  await page.route("**/appointments/bookings", async (route) => {
    if (route.request().method() === "POST") {
      capturedBody = route.request().postDataJSON() as { doctorSlug?: string; slots?: string[] };
    }
    await route.continue();
  });

  const patientEmail = `qa-e2e-telehealth-booking-${Date.now()}@example.com`;
  await page.getByLabel("Ad soyad").fill("QA E2E Test Hastası");
  await page.getByLabel("E-posta").fill(patientEmail);
  // `Checkbox` (`@base-ui/react/checkbox`) GERÇEK etkileşimli kökü `id="consent"` DEĞİL — bu id,
  // form/label ilişkilendirmesi için GİZLİ (`aria-hidden`, sıfır boyutlu) yerel `<input>`'a
  // atanır. Native HTML semantiğiyle TUTARLI şekilde ilişkili `<label for="consent">`'a
  // tıklamak (görünür/normal akışta olan gerçek eleman) her tarayıcıda checkbox'ı değiştirir.
  await page.locator('label[for="consent"]').click();

  await page.getByRole("button", { name: "Randevuyu Onayla" }).click();

  // [TCT] §9.7.1/§9.7.2 (bağlayıcı) — qa-agent GÜNCELLEMESİ (bu turda, frontend-agent'ın bıraktığı
  // not): eski akış (`POST /appointments`) rezervasyon oluşturunca DOĞRUDAN "Randevunuz oluşturuldu."
  // + konsültasyon linkini gösteriyordu. Yeni akış booking→ödeme akışına DÖNÜŞTÜ:
  // `BookingPostCreationFlow` önce rezervasyon özetini (`bookingNumber` + slot çipleri) gösterir,
  // ardından OPSİYONEL intake adımına geçer — direkt bir konsültasyon linki BURADA ARTIK YOKTUR
  // (madde 24'ün kapsadığı "ödeme sonrası" akışının BİR PARÇASI, bu testin odağı DEĞİL — bkz.
  // `telehealth-multi-slot-booking.spec.ts::madde 24`).
  await expect(page.getByText(/Rezervasyonunuz oluşturuldu \(BKG-/)).toBeVisible({ timeout: 20_000 });
  // "1 Slot" metni HEM başarı uyarısının (Toplam) HEM Hizmet Özeti panelinin (Dk) İÇİNDE görünür —
  // `.first()` strict-mode ihlalini önler (`telehealth-multi-slot-booking.spec.ts`'teki AYNI not).
  await expect(page.getByText("1 Slot", { exact: false }).first()).toBeVisible();
  // Opsiyonel "Tıbbi Belgeler ve Ön Bilgiler" adımı otomatik açılır — bu adımın VARLIĞI, akışın
  // gerçekten yeni booking→intake→ödeme zincirine geçtiğinin kanıtıdır.
  await expect(page.getByText("Bu adım opsiyoneldir", { exact: false })).toBeVisible({ timeout: 10_000 });

  // Yakalanan payload — kontrata uygun `doctorSlug` VE seçilen slotun `startsAt`'ı (tarayıcının
  // yerel dilimindeki görüntülenen saat etiketiyle YENİDEN biçimlendirilip karşılaştırılır, ISO
  // dizesinin KENDİSİ host/tarayıcı saat dilimine göre değişebileceğinden ham string eşitliği
  // GÜVENİLMEZ).
  expect(capturedBody?.doctorSlug, "yakalanan POST /appointments/bookings gövdesinde doctorSlug eksik/yanlış").toBe(doctorSlug);
  expect(capturedBody?.slots, "yakalanan POST /appointments/bookings gövdesinde slots eksik").toHaveLength(1);
  // İstemci `totalCents`/`unitPriceCents` HİÇ GÖNDERMEZ (madde 14 — backend'in kendi entegrasyon
  // testi bunun sunucu tarafında da YOK SAYILDIĞINI ayrıca kanıtlıyor).
  expect((capturedBody as unknown as { totalCents?: unknown })?.totalCents).toBeUndefined();
  const capturedTimeLabel = await page.evaluate((iso) => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return new Intl.DateTimeFormat("tr-TR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  }, capturedBody!.slots![0]!);
  expect(capturedTimeLabel, "payload'daki slots[0], seçilen saat slotuyla eşleşmiyor").toBe(selectedTimeLabel);
});

test.describe("§4.2/madde 9 — saat dilimi duyarlılığı: aynı slot, farklı ziyaretçi dilimlerinde farklı yerel saat etiketiyle gösteriliyor", () => {
  let timezoneDoctorSlug: string;
  let referenceSlotIso: string;

  test.beforeAll(async () => {
    // qa-agent bulgusu (kendi testinde bulunup düzeltildi, proje kökü CLAUDE.md madde 3) — sırf
    // "İLK müsait slot" seçmek, o slotun sorgu anında rezervasyon tamponunun (§4.2: "şu andan
    // itibaren 2 saatten yakın slotlar `available:false`") SINIRINA ÇOK YAKIN olma ihtimalini
    // taşıyordu: bu describe'un `beforeAll`'ı ile sayfanın GERÇEKTEN yüklendiği an arasında geçen
    // (paylaşımlı, sıralı çalışan suite'te dakikalar sürebilen) süre içinde slot tamponun İÇİNE
    // girip `available:false`'a düşebiliyor ve `role=checkbox` DEĞİL statik "Dolu" span'ı olarak
    // render ediliyordu (ara sıra gözlemlenen flaky "element(s) not found" hatası). En az 6 saat
    // ileride bir slot seçmek bu marjı ortadan kaldırır.
    const SAFE_MARGIN_MS = 6 * 60 * 60_000;
    const doctors = await listAllAdminDoctors(adminToken);
    const { from, to } = defaultSlotRangeISODates(30);
    for (const doctor of doctors) {
      const slotsRes = await getPublicDoctorSlotsRaw(doctor.slug, from, to);
      const safeSlot = (slotsRes.data ?? []).find(
        (s) => s.available && new Date(s.startsAt).getTime() - Date.now() > SAFE_MARGIN_MS
      );
      if (safeSlot) {
        timezoneDoctorSlug = doctor.slug;
        referenceSlotIso = safeSlot.startsAt;
        break;
      }
    }
    if (!timezoneDoctorSlug) throw new Error("Saat dilimi testi için güvenli marjlı, müsait bir slot bulunamadı.");
  });

  /** `availability-calendar.tsx::formatTime` İLE BİREBİR AYNI biçimlendirme — bağımsız doğrulama. */
  function expectedTimeLabel(timeZone: string): string {
    return new Intl.DateTimeFormat("tr-TR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
      new Date(referenceSlotIso)
    );
  }

  test.describe("ziyaretçi dilimi: America/New_York", () => {
    test.use({ timezoneId: "America/New_York" });

    test("rozet ziyaretçi dilimini gösterir + slot New York yerel saatinde etiketlenir", async ({ page }) => {
      await gotoAndWaitReady(page, `/doctors/${timezoneDoctorSlug}`, async () => {
        await expect(page.getByRole("heading", { name: "Müsaitlik ve Randevu" })).toBeVisible();
      });
      await page.waitForTimeout(500);

      // `exact: true` — doktorun KENDİ diliminin (paranteziçi "(doktorun yerel saat dilimi: ...)")
      // ZİYARETÇİ diliminin `<strong>` etiketiyle YANLIŞLIKLA eşleşmesini önler (bu doktorun kendi
      // `timeZone`'u bazen ziyaretçi diliminden FARKLI OLMAYABİLİR — bkz. `telehealth-rbac.spec.ts`
      // benzeri qa-agent bulgusu, iki metin de aynı dize İÇEREBİLİR).
      await expect(page.getByText("America/New_York", { exact: true })).toBeVisible({ timeout: 15_000 });
      const label = expectedTimeLabel("America/New_York");
      // `selectSpecificSlot` takvimi (gerekirse ay ileri sararak) referans slotun GÜNÜNE götürür
      // ve TARAYICININ KENDİ (test.use ile "America/New_York" olarak ayarlanmış) yerel dilimiyle
      // hesaplanmış saat etiketini arar — Node'daki `expectedTimeLabel`'in BAĞIMSIZ referansıyla
      // aşağıda karşılaştırılır.
      const targetRadio = await selectSpecificSlot(page, referenceSlotIso);
      await expect(targetRadio).toBeVisible({ timeout: 15_000 });
      await expect(targetRadio).toHaveAttribute("aria-label", new RegExp(`^${escapeRegExp(label)} —`));
    });
  });

  test.describe("ziyaretçi dilimi: Europe/Istanbul", () => {
    test.use({ timezoneId: "Europe/Istanbul" });

    test("AYNI slot Europe/Istanbul yerel saatinde FARKLI bir etiketle gösterilir", async ({ page }) => {
      await gotoAndWaitReady(page, `/doctors/${timezoneDoctorSlug}`, async () => {
        await expect(page.getByRole("heading", { name: "Müsaitlik ve Randevu" })).toBeVisible();
      });
      await page.waitForTimeout(500);

      // `exact: true` — bkz. yukarıdaki "America/New_York" bloğundaki AYNI gerekçe (bu ortamda
      // doktorun kendi `timeZone`'u tesadüfen "Europe/Istanbul" ile eşleşmiş, `exact:false` iki
      // ayrı elemanla — ziyaretçi rozeti VE doktorun kendi dilimi parantezi — çakışıyordu).
      await expect(page.getByText("Europe/Istanbul", { exact: true })).toBeVisible({ timeout: 15_000 });

      const istanbulLabel = expectedTimeLabel("Europe/Istanbul");
      const newYorkLabel = expectedTimeLabel("America/New_York");
      // Sağlık kontrolü — iki dilim arasındaki ofset (7-10 saat) etiketlerin FARKLI olmasını garanti eder;
      // aksi halde aşağıdaki DOM iddiası yanlışlıkla "aynı" bir etiketle geçebilirdi.
      expect(istanbulLabel).not.toBe(newYorkLabel);

      const targetRadio = await selectSpecificSlot(page, referenceSlotIso);
      await expect(targetRadio).toBeVisible({ timeout: 15_000 });
      await expect(targetRadio).toHaveAttribute("aria-label", new RegExp(`^${escapeRegExp(istanbulLabel)} —`));
    });
  });
});
