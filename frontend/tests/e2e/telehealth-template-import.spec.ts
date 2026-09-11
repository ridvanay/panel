import { test, expect } from "@playwright/test";
import { getCachedAdminSession, getSiteModules, patchSiteModule, API_BASE_URL } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";
import { getDemoTemplatesRaw, importDemoTemplateRaw, resetDemoTemplateImportRow } from "./support/demo-templates-fixtures";
import {
  TELEHEALTH_TEMPLATE_KEY,
  EXPECTED_TELEHEALTH_COUNTS,
  KNOWN_SPECIALTY_NAMES,
  KNOWN_DOCTOR_FULL_NAMES,
  listAllAdminDoctors,
  listAllAdminSpecialties,
  listAdminAppointmentsRaw,
  getPublicDoctorsRaw,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — `.claude/architect-scope-telehealth-template.md` §10 (QA kapsamı) madde 6/7/13.
 * Backend'in `tests/unit/telehealth-*.test.ts` + `tests/integration/telehealth.test.ts` +
 * `tests/integration/demo-templates-telehealth-clinic.test.ts` (89 test) ZATEN slot üretimi/DST/
 * rezervasyon yarışı/Zod-token doğrulamasını `app.inject` seviyesinde kapsıyor — BURADA YENİDEN
 * YAZILMAZ. Bu dosya yalnızca gerçek tarayıcı + gerçek backend + gerçek Postgres (`saas_e2e`)
 * üzerinden "admin panelde kartı gör → gerçekten uygula → veritabanına GERÇEKTEN yansıdı mı" zincirini
 * kapatır (§2.5/§3.6 kabul kriterleri dahil).
 *
 * Fixture stratejisi (bkz. `support/telehealth-fixtures.ts` başlığı) — bilinen içerik SİLİNMEZ
 * (`Appointment.doctor` `onDelete: Restrict` bunu güvenilmez kılar), bunun yerine `demo_template_
 * imports` işareti sıfırlanıp ÖNCE/SONRA küme farkı (diff) alınır — leftover satırlar test
 * doğruluğunu ETKİLEMEZ (importer'ın kanıtlanmış slug-benzersizleştirme davranışı sayesinde).
 */
test.describe.configure({ mode: "serial" });

let adminToken: string;
let initialTelehealthEnabled: boolean;

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;

  // Temiz zemin — bu testin KENDİ ihtiyacı için: idempotency işareti sıfırlanır (bu tablo İÇERİK
  // TUTMAZ, silme ucu yok — bkz. `demo-templates-fixtures.ts` başlığı) ve modül baştan KAPALI
  // duruma alınır (§2.4 `defaultEnabled: false` senaryosunu test edebilmek için).
  resetDemoTemplateImportRow(TELEHEALTH_TEMPLATE_KEY);
  await patchSiteModule(adminToken, "telehealth", false);
});

test.afterAll(async () => {
  // Yalnızca bu testin DEĞİŞTİRDİĞİ tek global durumu (modül aç/kapa) BAŞLANGIÇ değerine geri
  // yazar — `customer-portal-module-toggle.spec.ts::initialProductsModuleEnabled` İLE AYNI ilke.
  // İçerik (doktor/uzmanlık/sayfa) KASITLI OLARAK silinmez (bkz. dosya başlığı).
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

test("madde 6: ADMIN /admin/demo-templates'te kart görünür + GERÇEK UI akışıyla uygulanır → 6 uzmanlık+4 doktor oluşur, hiçbir userId dolu değil, appointments BOŞ, modül kapalı kalır", async ({
  browser,
}) => {
  // qa-agent bulgusu — bu dosya artık `telehealth-public-booking.spec.ts`/`telehealth-
  // consultation.spec.ts`/`telehealth-rbac.spec.ts`'ten (hepsi `ensureTelehealthModuleWithDoctors()`
  // ile GERÇEK importer'ı kullanır, bkz. `support/telehealth-fixtures.ts`) TAMAMEN BAĞIMSIZ ve
  // herhangi bir sırada koşabilir hâle getirildi — bu, bu testin KENDİ importunun ÖNÜNDE zaten bir
  // "telehealth-clinic" içeriği bulabileceği ve importer'ın slug benzersizleştirme (`-2`/`-3`...
  // soneki) dalına düşüp NORMALDEN ÇOK DAHA FAZLA "zaten kullanılıyordu" uyarısı üreteceği anlamına
  // gelir (GERÇEK, doğru bir davranış — dosya başlığındaki "leftover satırlar sonraki koşumları
  // BOZMAZ" ilkesi).
  //
  // KRİTİK BULGU (frontend-agent'a ESKALE EDİLDİ, qa-agent KENDİSİ DÜZELTMEDİ — proje kökü
  // CLAUDE.md madde 6): bu durumda "Şablon uygulandı" sonuç diyaloğunun (`demo-templates-view.tsx`)
  // "Uyarılar" listesi standart 1280×720 görünüm alanını taşıyor VE diyalog kendi İÇİNDE
  // KAYDIRILAMIYOR (`overflow-y-auto`/`max-h-*` YOK görünüyor) — ne sayfa ne diyalog kaydığı için
  // alt kısımdaki "Tamam"/"Close" düğmeleri GERÇEKTEN ULAŞILAMAZ hâle geliyor (Playwright'ın kendi
  // `scrollIntoViewIfNeeded` + retry mekanizması bile "element is outside of the viewport" ile
  // SÜRESİZ başarısız oluyor — sabit bekleme/timeout sorunu DEĞİL, gerçek bir a11y/UX kusuru: aynı
  // pencere boyutundaki GERÇEK bir kullanıcı da bu düğmeye ASLA tıklayamaz). Aşağıdaki
  // `page.setViewportSize` GEÇİCİ bir test uyarlamasıdır (hatayı GİZLEMEZ — ayrıca raporlanır),
  // kalıcı çözüm frontend-agent'ın diyalog içeriğine `max-h-[…] overflow-y-auto` eklemesidir.
  test.setTimeout(90_000);

  // qa-agent bulgusu (KRİTİK, bu test dosyasının KENDİ ÖNCEKİ hâlinde zaten mevcuttu, qa-agent
  // tarafından bulunup düzeltildi) — `GET /admin/telehealth/{doctors,specialties,appointments}`
  // `requireModuleEnabled("telehealth")` ile korunur (§8 madde 6, bağlayıcı: "modül kapalıyken
  // TÜM public/admin tele-sağlık uçları 404 döner" — `telehealth.admin.routes.ts` her üç route
  // grubunda da AYNI hook'u taşır, backend DOĞRU davranıyor). Bu testin `beforeAll`'ı modülü
  // BİLİNÇLİ olarak KAPALI bırakır (§2.4 senaryosu) — yani BEFORE/AFTER doktor/uzmanlık
  // anlık görüntüleri bu uçlarla modül kapalıyken alınırsa HER İKİSİ DE sessizce boş dizi döner
  // (`safeJson` + `body.data ?? []`) ve fark HER ZAMAN 0 çıkar — assertion hatası DEĞİL, testin
  // KENDİSİ hiçbir şeyi ASLA doğrulayamaz hâle gelirdi. Çözüm: yalnızca BU DOĞRULAMA sorguları
  // için modül GEÇİCİ olarak açılır, hemen ardından KAPATILIR — testin "modül kapalı kalır"
  // iddiası (satır sonundaki public `/doctors` 404 kontrolü) bu yüzden ZAYIFLAMAZ, ölçüm aracının
  // (fixture sorgusu) kendisi doğru çalışır hâle gelir.
  await patchSiteModule(adminToken, "telehealth", true);
  const doctorsBefore = await listAllAdminDoctors(adminToken);
  const specialtiesBefore = await listAllAdminSpecialties(adminToken);
  const doctorIdsBefore = new Set(doctorsBefore.map((d) => d.id));
  const specialtyIdsBefore = new Set(specialtiesBefore.map((s) => s.id));
  await patchSiteModule(adminToken, "telehealth", false);

  const { page, close } = await createAuthenticatedPage(browser);
  try {
    // Bkz. yukarıdaki KRİTİK BULGU — çok sayıda benzersizleştirme uyarısı üretildiğinde sonuç
    // diyaloğu standart görünüm alanına SIĞMIYOR ve kendi içinde kaydırılamıyor.
    await page.setViewportSize({ width: 1280, height: 2400 });
    await page.goto("/admin/demo-templates");

    const heading = page.getByRole("heading", { name: "Global TeleHealth & Clinic" });
    await expect(heading).toBeVisible();

    // `Card` bileşeni HER ZAMAN `rounded-xl` taşır (`components/ui/card.tsx`); bu başlığı içeren
    // EN İÇTEKİ (ve TEK) böyle div, şablonun kendi Card'ıdır — sayfadaki diğer şablon kartlarıyla
    // (modern-architecture/ecommerce-pro) KARIŞMAZ.
    const card = page.locator("div.rounded-xl").filter({ has: heading });
    await expect(card.locator(`img[src="/demo-templates/telehealth-clinic/preview.svg"]`)).toBeVisible();
    await expect(card.getByText("telehealth", { exact: true })).toBeVisible();
    await expect(card.getByText("randevu", { exact: true })).toBeVisible();
    // `exact: true` — uygulandıktan SONRA görünecek olan "... tarafından uygulandı." tarih
    // paragrafıyla (Playwright `getByText` varsayılan olarak BÜYÜK/küçük harf duyarsız alt-dize
    // eşleşir) "Uygulandı" rozetinin ÇAKIŞMASINI önler (qa-agent bulgusu, aşağıdaki satır 129'daki
    // AYNI çakışma).
    await expect(card.getByText("Uygulandı", { exact: true })).toHaveCount(0);

    await card.getByRole("button", { name: "Uygula" }).click();

    const dialog = page.getByRole("dialog").filter({ hasText: "Global TeleHealth & Clinic" });
    await expect(dialog).toBeVisible();
    // §2.6 — modül şu an KAPALI, bu yüzden opt-in anahtarı GÖRÜNÜR olmalı; bilinçli olarak
    // AÇILMAZ (bu test modül-kapalı-kalır senaryosunu doğrular; enableRequiredModules:true
        // senaryosu ayrı bir API-seviyesi testte, aşağıda).
    const enableModulesSwitch = dialog.getByRole("switch", { name: "Gerekli modülleri otomatik aç" });
    await expect(enableModulesSwitch).toBeVisible();
    await expect(enableModulesSwitch).toHaveAttribute("aria-checked", "false");

    await dialog.getByRole("button", { name: "Uygula" }).click();

    const resultDialog = page.getByRole("dialog").filter({ hasText: "Şablon uygulandı" });
    await expect(resultDialog).toBeVisible({ timeout: 20_000 });
    await expect(resultDialog.getByText("Tele-Sağlık modülü kapalı olduğu için doktorlar ve randevu sayfaları sitede görünmeyecek.", { exact: false })).toBeVisible();
    await expect(
      resultDialog.getByText("4 örnek doktor profili ve 6 uzmanlık oluşturuldu; yayına almadan önce gerçek bilgilerinizle değiştirin veya silin.")
    ).toBeVisible();
    await expect(resultDialog.getByText("4 yasal sayfa YER TUTUCU olarak oluşturuldu", { exact: false })).toBeVisible();

    await resultDialog.getByRole("button", { name: "Tamam" }).click();
    await expect(resultDialog).not.toBeVisible({ timeout: 10_000 });

    // qa-agent bulgusu — `exact: true` GEREKLİ: uygulama sonrası card İÇİNDE hem "Uygulandı" rozeti
    // (`<span>...Uygulandı</span>`) HEM "... tarafından uygulandı." tarih paragrafı birlikte var
    // olur; `exact: false` (varsayılan, büyük/küçük harf duyarsız alt-dize) İKİSİYLE de eşleşip
    // strict-mode ihlaline düşüyordu.
    await expect(card.getByText("Uygulandı", { exact: true })).toBeVisible({ timeout: 15_000 });
  } finally {
    await close();
  }

  // ---- API seviyesi doğrulama (§3.6/§2.5 kabul kriterleri) ------------------------------------
  // Yukarıdaki qa-agent bulgusuyla AYNI gerekçe — bu uçlar da `requireModuleEnabled` ile korunur,
  // doğrulama için modül GEÇİCİ olarak açılır.
  await patchSiteModule(adminToken, "telehealth", true);
  const doctorsAfter = await listAllAdminDoctors(adminToken);
  const specialtiesAfter = await listAllAdminSpecialties(adminToken);
  const newDoctors = doctorsAfter.filter((d) => !doctorIdsBefore.has(d.id));
  const newSpecialties = specialtiesAfter.filter((s) => !specialtyIdsBefore.has(s.id));

  expect(newDoctors).toHaveLength(EXPECTED_TELEHEALTH_COUNTS.doctors);
  expect(newSpecialties).toHaveLength(EXPECTED_TELEHEALTH_COUNTS.specialties);

  expect(new Set(newDoctors.map((d) => d.fullName))).toEqual(new Set(KNOWN_DOCTOR_FULL_NAMES));
  expect(new Set(newSpecialties.map((s) => s.name))).toEqual(new Set(KNOWN_SPECIALTY_NAMES));

  // §2.5 bağlayıcı kabul kriteri — şablon HİÇBİR `User` satırı üretmez; dolaylı kanıtı: her yeni
  // doktorun `userId`'si null'dır (importer'da `prisma.user.create/upsert` çağrısı YOKTUR).
  for (const doctor of newDoctors) {
    expect(doctor.userId, `doktor "${doctor.fullName}" userId taşımamalı (§2.5)`).toBeNull();
  }

  // §3.6 bağlayıcı kabul kriteri — `appointments` tablosu bu yeni doktorlar için BOŞ kalmalı.
  for (const doctor of newDoctors) {
    const appts = await listAdminAppointmentsRaw(adminToken, { doctorId: doctor.id });
    expect(appts.status).toBe(200);
    expect(appts.data, `doktor "${doctor.fullName}" için randevu OLMAMALI`).toEqual([]);
  }

  // Doğrulama bitti — modül GERÇEKTEN tekrar kapatılır (testin başlığındaki "modül kapalı kalır"
  // iddiası burada henüz ZAYIFLATILMADI: aşağıdaki public `/doctors` 404 kontrolü modül YENİDEN
  // kapatıldıktan SONRA çalışır).
  await patchSiteModule(adminToken, "telehealth", false);

  // Modül HÂLÂ (gerçekten) kapalı — public `/doctors` 404 döner (§8.6).
  const publicDoctors = await getPublicDoctorsRaw();
  expect(publicDoctors.status).toBe(404);
});

test("madde 13 (miras, yalnızca yeni templateKey ile parametrize): force olmadan ikinci import → 409 (idempotency)", async () => {
  const res = await importDemoTemplateRaw(adminToken, TELEHEALTH_TEMPLATE_KEY, { confirm: true, force: false });
  expect(res.status).toBe(409);
  expect(res.error?.code).toBe("CONFLICT");
});

test("madde 7: enableRequiredModules:true + force:true → 201, telehealth modülü GERÇEKTEN açılıyor, /doctors artık 200 (öncesinde 404 idi)", async () => {
  test.setTimeout(60_000);

  // Önceki testte modül hâlâ kapalı bırakılmıştı — burada AÇIKÇA doğrulanır (regresyon bekçisi).
  const before = await getPublicDoctorsRaw();
  expect(before.status).toBe(404);

  const res = await importDemoTemplateRaw(adminToken, TELEHEALTH_TEMPLATE_KEY, { confirm: true, force: true, enableRequiredModules: true });
  expect(res.status).toBe(201);
  const result = res.data as { enabledModules: string[]; warnings: string[]; counts: Record<string, number> };
  expect(result.enabledModules).toContain("telehealth");
  // §2.6 madde 3 — enableRequiredModules:true iken modül-kapalı uyarısı hiç ÜRETİLMEZ.
  expect(result.warnings.some((w) => w.includes("Tele-Sağlık modülü kapalı"))).toBe(false);
  expect(result.counts.specialties).toBe(EXPECTED_TELEHEALTH_COUNTS.specialties);
  expect(result.counts.doctors).toBe(EXPECTED_TELEHEALTH_COUNTS.doctors);
  expect(result.counts.availabilityWindows).toBe(EXPECTED_TELEHEALTH_COUNTS.availabilityWindows);

  const modules = await getSiteModules(adminToken);
  expect(modules.find((m) => m.key === "telehealth")?.enabled).toBe(true);

  const after = await getPublicDoctorsRaw();
  expect(after.status).toBe(200);
  expect((after.data ?? []).length).toBeGreaterThanOrEqual(EXPECTED_TELEHEALTH_COUNTS.doctors);
});

test("GET /admin/demo-templates özet — telehealth-clinic requiredModules/contents/replaces §12 ile BİREBİR", async () => {
  const list = await getDemoTemplatesRaw(adminToken);
  const summary = list.data?.find((t) => t.key === TELEHEALTH_TEMPLATE_KEY);
  expect(summary).toBeTruthy();
  expect(summary?.requiredModules).toEqual(["telehealth"]);
  expect(summary?.contents.specialties).toBe(EXPECTED_TELEHEALTH_COUNTS.specialties);
  expect(summary?.contents.doctors).toBe(EXPECTED_TELEHEALTH_COUNTS.doctors);
  expect(summary?.contents.availabilityWindows).toBe(EXPECTED_TELEHEALTH_COUNTS.availabilityWindows);
  expect((summary?.replaces as unknown as string[] | undefined)).toContain("siteModules");
  expect(summary?.appliedAt).not.toBeNull();
});
