import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession, getSiteModules, patchSiteModule, getFixtureUserToken, setupAndEnableTwoFactorForSelf, API_BASE_URL } from "./support/api";
import { resetFixtureUserToBaseline, adminGetUserByEmail, adminUpdateRole } from "./support/admin-users-fixtures";
import {
  ensureTelehealthModuleWithDoctors,
  createAdminDoctorFixture,
  deleteAdminDoctorFixture,
  setDoctorAvailabilityRaw,
  linkDoctorUserRaw,
  createBookingRaw,
  getBookingIdentityRaw,
  putBookingIdentityRaw,
  listAdminBookingsRaw,
  updateDoctorSelfProfileRaw,
  getDoctorOverviewRaw,
  getPublicDoctorSlotsRaw,
  defaultSlotRangeISODates,
  markBookingPaidDirectly,
  setAppointmentStatusDirectly,
  shiftAppointmentIntoJoinWindowDirectly,
  VALID_TEST_TR_IDENTITY,
  type CreatedFixtureDoctor,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — `.claude/architect-scope-doctor-portfolio-identity-console.md` (**[DPI]**) §6 madde
 * 10 (bağlayıcı, qa-agent'a özel talimat listesi). Kapsam BİREBİR (a)-(h):
 *   (a) kimlik adımı olmadan ödemeye geçilemez (modal atlanamaz + `identity` alanı olmadan `422`)
 *   (b) geçersiz TCKN/18 yaş altı reddedilir, hata gösterilir, slot TUTULMAZ ("ya hep ya hiç")
 *   (c) `MANAGER` booking'i görür ama `identity` `null`; `GET .../identity` `404`
 *   (d) booking'in AİT OLMADIĞI başka bir doktor `GET .../identity` → `404`
 *   (e) ödenmiş (`PAID`) booking'de `PUT .../identity` → `409 IDENTITY_LOCKED`
 *   (f) doktor `PUT /doctor/profile` ile kapsam dışı bir alanı (`title`/`sessionPriceCents`) → `422`
 *   (g) `GET /doctor/overview` — doktorun `timeZone`'unda "bugün" sınırı + `generatedAt`
 *   (h) kurumsal hekim profilinin üç sekmesi (Doktor Hakkında/Özgeçmiş/Bilimsel Yayınlar) doğru render olur
 *
 * `backend/tests/integration/telehealth-identity.test.ts` (backend-agent) BUNLARIN ÇOĞUNU zaten
 * `app.inject` seviyesinde (mock HTTP, gerçek tarayıcı YOK) kapsıyor — BU DOSYA YENİDEN YAZMAZ,
 * AYNI kontratı GERÇEK tarayıcı + GERÇEK HTTP + GERÇEK Postgres (`saas_e2e`) zincirinden geçirir
 * (qa-agent görevi: entegrasyon/birim testlerinin ÜSTÜNE eklenen e2e katmanı). Backend'in kendi
 * testinden BİLİNÇLİ OLARAK devralınan gerçekler (tekrar keşfedilmedi, doğrudan kullanıldı):
 * `"10000000146"` geçerli bir TCKN sağlama toplamıdır (`VALID_TEST_TR_IDENTITY`), maskesi
 * `"100******46"`dır.
 *
 * **qa-agent bulgusu (regresyon, bu turda tespit edilip DÜZELTİLDİ — kendi test kod tabanı,
 * uygulama kodu DEĞİL):** [DPI] §2.6 `identity`'i `POST /appointments/bookings` gövdesinde
 * ZORUNLU kıldığı ve booking formunun "Randevuyu Onayla"→"Randevu Oluştur" adı + KVKK onay
 * kutusunun `IdentityStepDialog`'un İÇİNE taşınması İLE SONUÇLANDIĞI için, bu turdan ÖNCE
 * yazılmış `telehealth-public-booking.spec.ts`/`telehealth-multi-slot-booking.spec.ts` YANLIŞ
 * varsayım taşıyordu — GÜNCELLENDİ (bkz. o dosyaların değişiklikleri +
 * `support/telehealth-identity-ui.ts` başlığı). `support/telehealth-fixtures.ts::createBookingRaw`
 * da AYNI nedenle `identity` için bir varsayılan (`VALID_TEST_TR_IDENTITY`) kazandı.
 *
 * **qa-agent bulgusu (İKİNCİ regresyon, bu turda — Grid görevi 2026-09-14 Görev 1):**
 * `IdentityStepDialog`'un KENDİSİ de KALDIRILDI — "Hasta & Kimlik" artık `/doctors/[slug]`
 * sihirbazının 3. adımı (`booking-identity-step.tsx`, `data-testid="booking-identity-step"`),
 * bir `role="dialog"` DEĞİL. Aşağıdaki "madde (a)/(b) UI" testi bu yüzden GÜNCELLENDİ — "Randevu
 * Oluştur" butonu/`page.getByRole("dialog", ...)` scope'u ARTIK YOK, yerine sağ panelin TEK
 * "Devam Et" butonu (adım 2→3 geçişi) + sayfa içi form kullanılır.
 *
 * Kendi, İZOLE fixture doktorları kurar (`telehealth-portal-isolation.spec.ts` İLE AYNI desen) —
 * paylaşımlı `telehealth-clinic` demo verisine BAĞIMLI DEĞİLDİR.
 *
 * **Bayatlık uyarısı** ([DPI] §6 madde 10, proje belleği): public doktor sayfası ISR'dir
 * (`next: { revalidate: 60 }`) — `gotoAndWaitReady()` (`telehealth-public-booking.spec.ts` İLE
 * BİREBİR AYNI desen) `toPass` + `page.goto` (yeniden istek) ile POLL eder, doğrudan assert
 * ETMEZ.
 *
 * `POST /appointments/bookings`'in 5/dk route-level hız sınırı (`BOOKING_CREATE_RATE_LIMIT`) —
 * bu dosyadaki booking-oluşturma çağrıları (~8 adet) BİLİNÇLİ OLARAK ayrı `test()` bloklarına
 * (aralarında sayfa navigasyonu/ISR polling/2FA kurulumu gibi gerçek zaman alan adımlar olan)
 * yayılmıştır — `telehealth-multi-slot-booking.spec.ts` dosya başlığındaki AYNI doğal-aralık
 * gerekçesi.
 */
test.describe.configure({ mode: "serial" });

const FIXTURE_PASSWORD = "QaE2eTelehealthIdentity12345!";
const RUN_SUFFIX = Date.now().toString(36);
const DOCTOR_USER_EMAIL = `qa-e2e-th-identity-doctor-${RUN_SUFFIX}@example.com`;
const OTHER_DOCTOR_USER_EMAIL = `qa-e2e-th-identity-other-doctor-${RUN_SUFFIX}@example.com`;
const MANAGER_EMAIL = `qa-e2e-th-identity-manager-${RUN_SUFFIX}@example.com`;

let adminToken: string;
let initialTelehealthEnabled: boolean;
/** madde (h)'nin içerik-zengin fixture doktoru — `afterAll`'da silinir (`richDoctor` DEĞİŞKENİNİN
 * KENDİSİ yalnızca kendi testinin İÇİNDE yerel `const`'tır, burada yalnızca `id`'si tutulur). */
let richDoctorId: string | undefined;

let fixtureDoctor: CreatedFixtureDoctor;
let doctorUserId: string;
let doctorUserToken: string;

let otherDoctorFixture: CreatedFixtureDoctor;
let otherDoctorUserToken: string;

let managerToken: string;

/** `telehealth-public-booking.spec.ts::gotoAndWaitReady` İLE BİREBİR AYNI 60sn ISR toleransı. */
async function gotoAndWaitReady(page: Page, url: string, ready: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await ready();
  }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });
}

/** `telehealth-public-booking.spec.ts::selectAnyAvailableRadio` İLE AYNI ilke — bu dosyada belirli
 * bir slota İHTİYAÇ YOK, yalnızca "herhangi bir müsait" saat aranır. */
async function selectAnyAvailableSlot(page: Page): Promise<void> {
  let checkbox = page.getByRole("checkbox", { name: /— müsait$/ }).first();
  if (await checkbox.isVisible().catch(() => false)) {
    await checkbox.click();
    return;
  }
  const availableDays = page.getByRole("button", { name: /— müsait/ });
  const count = await availableDays.count();
  for (let i = 0; i < count; i++) {
    await availableDays.nth(i).click();
    checkbox = page.getByRole("checkbox", { name: /— müsait$/ }).first();
    if (await checkbox.isVisible().catch(() => false)) {
      await checkbox.click();
      return;
    }
  }
  throw new Error("Takvimde görünür hiçbir günde müsait bir saat slotu bulunamadı.");
}

async function pickAvailableSlotIso(doctorSlug: string): Promise<string> {
  const { from, to } = defaultSlotRangeISODates(14);
  const slotsRes = await getPublicDoctorSlotsRaw(doctorSlug, from, to);
  const slot = (slotsRes.data ?? []).find((s) => s.available);
  if (!slot) throw new Error(`qa-agent: ${doctorSlug} için müsait slot bulunamadı (kimlik e2e fixture'ı).`);
  return slot.startsAt;
}

function tenYearsAgoIsoDate(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 10);
  return d.toISOString().slice(0, 10);
}

/**
 * qa-agent bulgusu (bu turda, kendi testinde tespit edilip DÜZELTİLDİ — proje kökü CLAUDE.md
 * madde 3, "flaky kaynağını bul ve düzelt" — kaynak burada `BOOKING_CREATE_RATE_LIMIT`, 5/dk):
 * bu dosyadaki API-seviyeli testler (UI navigasyonu/ISR polling İÇERMEDİĞİ için)
 * `telehealth-multi-slot-booking.spec.ts` dosya başlığının varsaydığı "doğal aralık"tan ÇOK daha
 * hızlı art arda çalışır — dosyanın TAMAMI (8 `POST /appointments/bookings` çağrısı) birkaç
 * saniye içinde bitebilir ve 5/dk route-level hız sınırına GERÇEKTEN çarpar (ilk koşumda `429`
 * ile gözlemlendi). Sabit bekleme yerine (proje kökü CLAUDE.md madde 3'ün YASAKLADIĞI desen)
 * KAYAN bir pencere sayacı: son 65 saniyede (5/dk sınırına 5sn güvenlik payı) 4 çağrı BİRİKTİYSE
 * bir SONRAKİ çağrı, en eski çağrının penceresi GERÇEKTEN aşılana kadar bekler — sabit "5sn
 * uyu" yerine yalnızca GEREKTİĞİ kadar (genelde İLK 4 çağrı hiç beklemez).
 */
const bookingCreateCallTimestampsMs: number[] = [];
const BOOKING_CREATE_WINDOW_MS = 65_000;
const BOOKING_CREATE_MAX_PER_WINDOW = 4;

/** Bir `POST /appointments/bookings` denemesinden HEMEN ÖNCE çağrılır — YEREL kayan pencere
 * sayacı 5/dk sınırına yaklaşmışsa GEREKTİĞİ kadar bekler (bkz. bu bloğun üstündeki qa-agent
 * bulgusu). `pacedCreateBookingRaw()` VE ham `fetch()` çağıran testler (madde a-API) TARAFINDAN
 * PAYLAŞILIR — aksi hâlde ikinci bir yol sayaçtan HABERSİZ kalırdı. */
async function reserveBookingCreateSlot(): Promise<void> {
  while (bookingCreateCallTimestampsMs.length && Date.now() - bookingCreateCallTimestampsMs[0]! > BOOKING_CREATE_WINDOW_MS) {
    bookingCreateCallTimestampsMs.shift();
  }
  if (bookingCreateCallTimestampsMs.length >= BOOKING_CREATE_MAX_PER_WINDOW) {
    const waitMs = BOOKING_CREATE_WINDOW_MS - (Date.now() - bookingCreateCallTimestampsMs[0]!);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    while (bookingCreateCallTimestampsMs.length && Date.now() - bookingCreateCallTimestampsMs[0]! > BOOKING_CREATE_WINDOW_MS) {
      bookingCreateCallTimestampsMs.shift();
    }
  }
  bookingCreateCallTimestampsMs.push(Date.now());
}

/** Sunucunun GERÇEK `429`'u — bu backend süreci qa-agent'ın kendi manuel doğrulama `curl`
 * çağrılarıyla/BAŞKA bir Playwright koşumuyla AYNI 5/dk kovaya PAYLAŞILIYOR olabilir (bu turda
 * GERÇEKTEN gözlemlendi, yerel sayaç TEK BAŞINA yeterli değildi) — yakalanırsa pencerenin
 * TAMAMEN temizlenmesini bekleyip sayaç SIFIRLANIR. */
async function recoverFromRateLimit(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 62_000));
  bookingCreateCallTimestampsMs.length = 0;
  bookingCreateCallTimestampsMs.push(Date.now());
}

async function pacedCreateBookingRaw(
  ...args: Parameters<typeof createBookingRaw>
): ReturnType<typeof createBookingRaw> {
  await reserveBookingCreateSlot();
  const res = await createBookingRaw(...args);
  if (res.status === 429) {
    await recoverFromRateLimit();
    return createBookingRaw(...args);
  }
  return res;
}

async function cleanupFixtures() {
  await resetFixtureUserToBaseline(adminToken, DOCTOR_USER_EMAIL);
  await resetFixtureUserToBaseline(adminToken, OTHER_DOCTOR_USER_EMAIL);
  await resetFixtureUserToBaseline(adminToken, MANAGER_EMAIL);
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(180_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  await cleanupFixtures();

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);

  fixtureDoctor = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `QA E2E Kimlik Doktoru ${RUN_SUFFIX}`,
    bio: "qa-agent — [DPI] kimlik e2e fixture doktoru.",
    languages: ["tr"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: 45000,
    currency: "TRY",
    isVerified: true,
    isActive: true,
  });
  await setDoctorAvailabilityRaw(
    adminToken,
    fixtureDoctor.id,
    ([1, 2, 3, 4, 5, 6, 7] as const).map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }))
  );

  otherDoctorFixture = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `QA E2E Diğer Doktor ${RUN_SUFFIX}`,
    bio: "qa-agent — [DPI] madde (d)/(h) boş-durum fixture doktoru.",
    languages: ["en"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: 30000,
    currency: "TRY",
    isActive: true,
  });
  await setDoctorAvailabilityRaw(
    adminToken,
    otherDoctorFixture.id,
    ([1, 2, 3, 4, 5, 6, 7] as const).map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }))
  );

  // ---- doktor hesabı: fixture kullanıcı → doktor profiline bağlanır → GERÇEK 2FA etkinleştirilir
  // (`/doctor/profile`/`/doctor/overview` `requireDoctorPortalAccess` GEREKTİRİR — madde f/g) ----
  doctorUserToken = await getFixtureUserToken(DOCTOR_USER_EMAIL, FIXTURE_PASSWORD, "QA E2E Kimlik Doktoru");
  const doctorUser = await adminGetUserByEmail(adminToken, DOCTOR_USER_EMAIL);
  if (!doctorUser) throw new Error("qa-agent: doktor fixture kullanıcısı oluşturulamadı.");
  doctorUserId = doctorUser.id;
  await linkDoctorUserRaw(adminToken, fixtureDoctor.id, doctorUserId);
  await setupAndEnableTwoFactorForSelf(doctorUserToken);

  // ---- "başka doktor" hesabı (madde d) — `GET .../identity` `requireDoctorPortalAccess`
  // GEREKTİRMEZ (`telehealthIdentityRoutes` yalnızca `authenticateOptional` taşır), 2FA GEREKMEZ ----
  otherDoctorUserToken = await getFixtureUserToken(
    OTHER_DOCTOR_USER_EMAIL,
    FIXTURE_PASSWORD,
    "QA E2E Diğer Doktor"
  );
  const otherDoctorUser = await adminGetUserByEmail(adminToken, OTHER_DOCTOR_USER_EMAIL);
  if (!otherDoctorUser) throw new Error("qa-agent: diğer doktor fixture kullanıcısı oluşturulamadı.");
  await linkDoctorUserRaw(adminToken, otherDoctorFixture.id, otherDoctorUser.id);

  // ---- MANAGER hesabı (madde c) ----
  managerToken = await getFixtureUserToken(MANAGER_EMAIL, FIXTURE_PASSWORD, "QA E2E Kimlik Manager");
  const managerUser = await adminGetUserByEmail(adminToken, MANAGER_EMAIL);
  if (!managerUser) throw new Error("qa-agent: MANAGER fixture kullanıcısı oluşturulamadı.");
  await adminUpdateRole(adminToken, managerUser.id, "MANAGER");
});

test.afterAll(async () => {
  await cleanupFixtures();
  // `Appointment.doctor` `onDelete: Restrict` — bu dosyanın ürettiği GERÇEK randevular yüzünden
  // silme `409` ile başarısız olabilir; leftover satır sonraki koşumları BOZMAZ (RUN_SUFFIX
  // benzersiz, `telehealth-portal-isolation.spec.ts::afterAll` İLE AYNI tolerans).
  if (fixtureDoctor) await deleteAdminDoctorFixture(adminToken, fixtureDoctor.id).catch(() => undefined);
  if (otherDoctorFixture) await deleteAdminDoctorFixture(adminToken, otherDoctorFixture.id).catch(() => undefined);
  if (richDoctorId) await deleteAdminDoctorFixture(adminToken, richDoctorId).catch(() => undefined);
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

// =============================================================================
// madde (a) + (b, UI kısmı) — booking widget'ında kimlik adımı ATLANAMAZ + geçersiz TCKN
// istemcide "Geçersiz" rozetiyle işaretlenir (sunucuya HİÇ gitmeden "Devam Et" devre dışı kalır)
// =============================================================================
test("madde (a)/(b) UI: adım 2→3 geçişi 'Hasta & Kimlik' adımını AÇAR ama booking'i OLUŞTURMAZ; geçersiz TCKN girilince 'Devam Et' devre dışı kalır", async ({
  page,
}) => {
  test.setTimeout(90_000);

  let capturedBookingPost = false;
  await page.route("**/appointments/bookings", async (route) => {
    if (route.request().method() === "POST") capturedBookingPost = true;
    await route.continue();
  });

  await gotoAndWaitReady(page, `/doctors/${fixtureDoctor.slug}`, async () => {
    await expect(page.getByRole("heading", { name: "Müsaitlik ve Randevu" })).toBeVisible();
  });
  await page.waitForTimeout(500);
  await selectAnyAvailableSlot(page);

  // Grid görevi (2026-09-14) Görev 1 (bağlayıcı) — qa-agent GÜNCELLEMESİ: eski `IdentityStepDialog`
  // (bir `role="dialog"`) TAMAMEN KALDIRILDI. Sağ "Hizmet Özeti" panelinin TEK "Devam Et" butonu
  // (adım 2→3) artık booking'i DOĞRUDAN oluşturmaz, yalnızca "Hasta & Kimlik" adımını (sayfanın
  // KENDİ akışında, `data-testid="booking-identity-step"`) AÇAR.
  const continueButton = page.getByRole("button", { name: "Devam Et" }).first();
  await continueButton.click();

  const identityStep = page.getByTestId("booking-identity-step");
  await expect(identityStep).toBeVisible({ timeout: 15_000 });
  await expect(continueButton).toBeDisabled();

  // Adım AÇIK ama HİÇBİR alan doldurulmadı — kısa bir bekleme sonrası GERÇEK bir
  // `POST /appointments/bookings` isteğinin GİTMEDİĞİNİ doğrula (adım "atlanamıyor").
  await page.waitForTimeout(1_500);
  expect(capturedBookingPost, "kimlik adımı hiçbir alan doldurulmadan AÇIKKEN sunucuya bir booking isteği gitmemeli").toBe(false);

  // madde (b), UI kısmı — checksum HATALI bir TCKN (backend'in KENDİ testindeki `10000000145` İLE
  // AYNI, `10000000146`'nın son hanesi değiştirilmiş) istemci kopyası (`lib/telehealth-identity.ts`)
  // tarafından da REDDEDİLİR — "Geçersiz" rozeti GÖRÜNÜR, "Devam Et" HÂLÂ devre dışı.
  // Çapalanmış regex KULLANILIR (`exact: true` DEĞİL) — bkz.
  // `support/telehealth-identity-ui.ts::fillBookingIdentityStep` başlığındaki qa-agent bulgusu:
  // `required` `Field`'ların `label`'ı `aria-hidden` bir "*" içerir, Playwright'ın `getByLabel`
  // eşleştirmesi bunu YOK SAYMAZ (gerçek metin "Ad soyad*"/"E-posta*"), `exact: true` bu yüzden HİÇ
  // eşleşmez (0 eleman, sessizce zaman aşımına düşer).
  await identityStep.getByLabel(/^Ad soyad/).fill("QA E2E Kimlik Adımı Testi");
  await identityStep.getByLabel(/^E-posta/).fill(`qa-e2e-identity-step-${Date.now()}@example.com`);
  await identityStep.getByLabel("T.C. Kimlik Numarası").fill("10000000145");
  await expect(identityStep.getByText("Geçersiz", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(continueButton).toBeDisabled();
  expect(capturedBookingPost, "geçersiz TCKN girildiğinde de sunucuya bir booking isteği GİTMEMELİ").toBe(false);
});

// =============================================================================
// madde (a), API kısmı — `identity` alanı OLMADAN `POST /appointments/bookings` → 422
// =============================================================================
test("madde (a) API: `identity` alanı olmadan POST /appointments/bookings 422 döner", async () => {
  test.setTimeout(90_000);
  const slotIso = await pickAvailableSlotIso(fixtureDoctor.slug);
  async function attempt(): Promise<Response> {
    await reserveBookingCreateSlot();
    return fetch(`${API_BASE_URL}/appointments/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        doctorSlug: fixtureDoctor.slug,
        slots: [slotIso],
        patientName: "QA E2E Kimliksiz Deneme",
        patientEmail: `qa-e2e-no-identity-${Date.now()}@example.com`,
        consent: true,
        // `identity` KASITLI OLARAK gönderilmiyor.
      }),
    });
  }
  let res = await attempt();
  if (res.status === 429) {
    await recoverFromRateLimit();
    res = await attempt();
  }
  expect(res.status).toBe(422);
});

// =============================================================================
// madde (b), API kısmı — geçersiz TCKN / 18 yaş altı reddedilir VE slot TUTULMAZ
// =============================================================================
test("madde (b) API: geçersiz TCKN → 422 + slot TUTULMAZ (başka biri aynı slotu alabilir); 18 yaş altı → 422 IDENTITY_MINOR_NOT_SUPPORTED", async () => {
  // `pacedCreateBookingRaw` 5/dk hız sınırına çarpmamak için GEREKİRSE bekler (bkz. tanımının
  // başlığı) — varsayılan 30sn test zaman aşımı bu bekleme + 3 booking çağrısı için YETERSİZ olabilir.
  test.setTimeout(120_000);
  // ---- geçersiz TCKN — "ya hep ya hiç": reddedilen denemeden SONRA aynı slot HÂLÂ alınabilir ----
  const slot1 = await pickAvailableSlotIso(fixtureDoctor.slug);
  const invalidTcknRes = await pacedCreateBookingRaw({
    doctorSlug: fixtureDoctor.slug,
    slots: [slot1],
    patientName: "QA E2E Geçersiz TCKN",
    patientEmail: `qa-e2e-invalid-tckn-${Date.now()}@example.com`,
    identity: { ...VALID_TEST_TR_IDENTITY, identityNumber: "10000000145" },
  });
  expect(invalidTcknRes.status).toBe(422);
  expect(invalidTcknRes.error?.code).toBe("VALIDATION_ERROR");

  const secondBookerRes = await pacedCreateBookingRaw({
    doctorSlug: fixtureDoctor.slug,
    slots: [slot1],
    patientName: "QA E2E Aynı Slotu Alan İkinci Hasta",
    patientEmail: `qa-e2e-slot-still-free-${Date.now()}@example.com`,
    // varsayılan `VALID_TEST_TR_IDENTITY` kullanılır.
  });
  expect(
    secondBookerRes.status,
    "reddedilen geçersiz-TCKN denemesinden SONRA AYNI slot başka bir hasta tarafından hâlâ alınabilir olmalı"
  ).toBe(201);

  // ---- 18 yaş altı — ayrı bir slotta, DB'ye dokunmadan "hâlâ müsait" görünürlüğünü doğrula
  // (rate-limit'i ikinci bir booking denemesiyle GEREKSİZ yere tüketmemek için `GET /slots` yeterli). ----
  const slot2 = await pickAvailableSlotIso(fixtureDoctor.slug);
  const minorRes = await pacedCreateBookingRaw({
    doctorSlug: fixtureDoctor.slug,
    slots: [slot2],
    patientName: "QA E2E 18 Yaş Altı",
    patientEmail: `qa-e2e-minor-${Date.now()}@example.com`,
    identity: { ...VALID_TEST_TR_IDENTITY, birthDate: tenYearsAgoIsoDate() },
  });
  expect(minorRes.status).toBe(422);
  expect(minorRes.error?.code).toBe("IDENTITY_MINOR_NOT_SUPPORTED");

  const { from, to } = defaultSlotRangeISODates(14);
  const slotsAfterMinorAttempt = await getPublicDoctorSlotsRaw(fixtureDoctor.slug, from, to);
  const stillAvailable = (slotsAfterMinorAttempt.data ?? []).find((s) => s.startsAt === slot2)?.available;
  expect(stillAvailable, "reddedilen 18-yaş-altı denemesinden SONRA slot HÂLÂ müsait görünmeli (tutulmamalı)").toBe(true);
});

// =============================================================================
// madde (c) — MANAGER booking'i GÖRÜR ama `identity` `null`; `GET .../identity` → 404
// =============================================================================
let bookingCD: { id: string };

test("madde (c): MANAGER booking'i görür (`identity: null`); GET .../identity → 404. ADMIN'de identity DOLU + doğru maskeli.", async () => {
  // `pacedCreateBookingRaw` bu testten ÖNCEKİ testlerin (a-API/b) TÜKETTİĞİ 5/dk kotası yüzünden
  // GEREKİRSE ~65sn'ye kadar bekleyebilir (bkz. `reserveBookingCreateSlot` tanımı) — varsayılan
  // 30sn test zaman aşımı bunun için YETERSİZ (ilk koşumda GÖZLEMLENDİ: `Test timeout of 30000ms
  // exceeded`, kök neden buydu — proje kökü CLAUDE.md madde 3 "flaky kaynağını bul ve düzelt").
  test.setTimeout(120_000);
  const slotIso = await pickAvailableSlotIso(fixtureDoctor.slug);
  const created = await pacedCreateBookingRaw({
    doctorSlug: fixtureDoctor.slug,
    slots: [slotIso],
    patientName: "QA E2E Manager/Doktor Erişim Testi",
    patientEmail: `qa-e2e-manager-access-${Date.now()}@example.com`,
  });
  expect(created.status).toBe(201);
  bookingCD = { id: created.data!.bookingId };

  // Admin panelindeki booking listesi (`GET /admin/telehealth/bookings`, ADMIN+MANAGER) — MANAGER
  // booking'i GÖRÜR ama `identity` `null`; ADMIN aynı satırda `identity` DOLU + doğru maskeli.
  const managerList = await listAdminBookingsRaw(managerToken, { doctorId: fixtureDoctor.id });
  expect(managerList.status).toBe(200);
  const managerRow = managerList.data?.find((row) => row.id === bookingCD.id);
  expect(managerRow, "MANAGER'ın booking listesinde fixture booking'i görünmeli").toBeTruthy();
  expect(managerRow?.identity, "MANAGER için `identity` HER ZAMAN `null` olmalı").toBeNull();

  const adminList = await listAdminBookingsRaw(adminToken, { doctorId: fixtureDoctor.id });
  const adminRow = adminList.data?.find((row) => row.id === bookingCD.id);
  expect(adminRow?.identity, "ADMIN için `identity` DOLU olmalı").not.toBeNull();
  expect((adminRow?.identity as Record<string, unknown> | null)?.maskedNumber).toBe("100******46");

  // Dedike `GET .../identity` ucu — MANAGER için `404` (varlık sızdırılmaz).
  const managerIdentityRes = await getBookingIdentityRaw(bookingCD.id, { bearerToken: managerToken });
  expect(managerIdentityRes.status).toBe(404);
});

// =============================================================================
// madde (d) — booking'in AİT OLMADIĞI başka bir doktor GET .../identity → 404 (KENDİ doktoru 200)
// =============================================================================
test("madde (d): başka bir doktor GET .../identity → 404; booking'in KENDİ doktoru 200 ile açık numarayı okur", async () => {
  const otherDoctorRes = await getBookingIdentityRaw(bookingCD.id, { bearerToken: otherDoctorUserToken });
  expect(otherDoctorRes.status).toBe(404);

  const ownDoctorRes = await getBookingIdentityRaw(bookingCD.id, { bearerToken: doctorUserToken });
  expect(ownDoctorRes.status).toBe(200);
  expect(ownDoctorRes.data?.identityNumber).toBe(VALID_TEST_TR_IDENTITY.identityNumber);
});

// =============================================================================
// madde (e) — ödenmiş (PAID) booking'de PUT .../identity → 409 IDENTITY_LOCKED
// (kontrol: HÂLÂ PENDING iken PUT .../identity BAŞARIYLA günceller)
// =============================================================================
test("madde (e): PAID booking'de PUT .../identity → 409 IDENTITY_LOCKED; PENDING booking'de AYNI istek 200 ile günceller", async () => {
  test.setTimeout(120_000);
  // ---- kontrol grubu: PENDING iken düzeltme penceresi AÇIK ----
  const slotPending = await pickAvailableSlotIso(fixtureDoctor.slug);
  const pendingBooking = await pacedCreateBookingRaw({
    doctorSlug: fixtureDoctor.slug,
    slots: [slotPending],
    patientName: "QA E2E Kilit Öncesi Düzeltme",
    patientEmail: `qa-e2e-identity-unlocked-${Date.now()}@example.com`,
  });
  expect(pendingBooking.status).toBe(201);

  const correctionRes = await putBookingIdentityRaw(
    pendingBooking.data!.bookingId,
    { citizenshipType: "FOREIGN", identityNumber: "AB123456", countryCode: "DE", birthDate: "1985-05-05" },
    { magicLinkToken: pendingBooking.data!.accessToken }
  );
  expect(correctionRes.status, "PENDING iken PUT .../identity BAŞARILI olmalı").toBe(200);
  const updatedIdentity = correctionRes.data?.identity as Record<string, unknown> | undefined;
  expect(updatedIdentity?.citizenshipType).toBe("FOREIGN");
  expect(updatedIdentity?.countryCode).toBe("DE");

  // ---- asıl senaryo: PAID sonrası kilit ----
  const slotPaid = await pickAvailableSlotIso(fixtureDoctor.slug);
  const paidBooking = await pacedCreateBookingRaw({
    doctorSlug: fixtureDoctor.slug,
    slots: [slotPaid],
    patientName: "QA E2E Kilit Sonrası Deneme",
    patientEmail: `qa-e2e-identity-locked-${Date.now()}@example.com`,
  });
  expect(paidBooking.status).toBe(201);
  markBookingPaidDirectly(paidBooking.data!.bookingId);

  const lockedRes = await putBookingIdentityRaw(
    paidBooking.data!.bookingId,
    { citizenshipType: "FOREIGN", identityNumber: "CD987654", countryCode: "FR", birthDate: "1988-03-03" },
    { magicLinkToken: paidBooking.data!.accessToken }
  );
  expect(lockedRes.status).toBe(409);
  expect(lockedRes.error?.code).toBe("IDENTITY_LOCKED");
});

// =============================================================================
// madde (f) — doktor `PUT /doctor/profile` ile KAPSAM DIŞI bir alanı (title/sessionPriceCents)
// değiştiremez (`422`, Zod `.strict()`); İZİN VERİLEN alanlar (kontrol grubu) 200 ile güncellenir
// =============================================================================
test("madde (f): doktor PUT /doctor/profile ile `title`/`sessionPriceCents` değiştiremez (422); izin verilen `subSpecialty` 200 ile güncellenir", async () => {
  const titleRes = await updateDoctorSelfProfileRaw(doctorUserToken, { title: "Prof. Dr. Hacklenmiş" });
  expect(titleRes.status).toBe(422);

  const priceRes = await updateDoctorSelfProfileRaw(doctorUserToken, { sessionPriceCents: 999_999 });
  expect(priceRes.status).toBe(422);

  // Kontrol grubu — İZİN VERİLEN dar yazma yüzeyi GERÇEKTEN çalışır (yalnızca negatif testler
  // yanıltıcı olabilirdi; bu doğru davranışın regresyona uğramadığını da kanıtlar).
  const allowedRes = await updateDoctorSelfProfileRaw(doctorUserToken, {
    subSpecialty: `QA Alt Branş ${RUN_SUFFIX}`,
    bio: "QA E2E — profil güncellemesi sonrası kısa özet.",
  });
  expect(allowedRes.status).toBe(200);
  const updatedProfile = (allowedRes.data?.doctorProfile ?? allowedRes.data) as Record<string, unknown> | undefined;
  expect(updatedProfile?.subSpecialty).toBe(`QA Alt Branş ${RUN_SUFFIX}`);
  // `title` bu isteklerin HİÇBİRİNDEN etkilenmemiş olmalı.
  expect(updatedProfile?.title).toBe("Dr.");
});

// =============================================================================
// madde (g) — GET /doctor/overview: doktorun `timeZone`'unda "bugün" sınırı + `generatedAt`
// =============================================================================
test("madde (g): GET /doctor/overview — 'bugünkü seans' sayacı doktorun timeZone'unda doğru hesaplanır; generatedAt sunucu saatidir", async () => {
  test.setTimeout(90_000);
  const before = await getDoctorOverviewRaw(doctorUserToken);
  expect(before.status).toBe(200);
  expect(before.data?.timeZone).toBe(fixtureDoctor.timeZone);
  const beforeTotal = before.data!.today.total;

  // Gerçek bir rezervasyon akışından geçmiş (§4.3 randevu tamponu ile UYUMLU, en az birkaç saat
  // ileri) bir randevunun zamanlamasını "şimdi" pencereye kaydır — `shiftAppointmentIntoJoinWindowDirectly`
  // İLE AYNI "gerçek varlık, sahte olan yalnızca zamanlama" felsefesi (bkz. o fonksiyonun başlığı).
  const slotIso = await pickAvailableSlotIso(fixtureDoctor.slug);
  const todayBooking = await pacedCreateBookingRaw({
    doctorSlug: fixtureDoctor.slug,
    slots: [slotIso],
    patientName: "QA E2E Bugünkü Seans",
    patientEmail: `qa-e2e-today-session-${Date.now()}@example.com`,
  });
  expect(todayBooking.status).toBe(201);
  markBookingPaidDirectly(todayBooking.data!.bookingId);
  setAppointmentStatusDirectly(todayBooking.data!.appointments[0]!.id, "SCHEDULED");
  // `now() + 120sn` — doktorun `timeZone`'u ("Europe/Istanbul") gece yarısına ÇOK yakın OLMADIĞI
  // sürece bu HER ZAMAN "bugün"dür (aşırı uç durumun ihmal edilebilir kalıntı riski, projedeki
  // `shiftAppointmentIntoJoinWindowDirectly` kullanan diğer testlerle AYNI kabul edilen risk).
  shiftAppointmentIntoJoinWindowDirectly(todayBooking.data!.appointments[0]!.id, 120, 30);

  const after = await getDoctorOverviewRaw(doctorUserToken);
  expect(after.status).toBe(200);
  expect(after.data?.generatedAt, "generatedAt ISO bir zaman damgası olmalı").toBeTruthy();
  const generatedAtMs = new Date(after.data!.generatedAt).getTime();
  expect(Math.abs(Date.now() - generatedAtMs), "generatedAt sunucu 'şu an'ına yakın olmalı").toBeLessThan(60_000);

  // Bağımsız, Node tarafında hesaplanan "bugün" (doktorun `timeZone`'unda, `en-CA` locale'i
  // DOĞRUDAN `YYYY-MM-DD` üretir) — backend'in `formatCalendarDateKey`'i İLE AYNI biçim.
  const expectedTodayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: fixtureDoctor.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  expect(after.data?.today.date).toBe(expectedTodayKey);

  // Öncesi/sonrası KÜME FARKI — paylaşımlı doktor üzerinde başka "bugün" randevusu olsa bile
  // (bu dosyanın ÖNCEKİ testlerinden sızmış olabilir) sayaç EN AZ 1 ARTMIŞ olmalı.
  expect(after.data!.today.total).toBeGreaterThanOrEqual(beforeTotal + 1);
  expect(after.data!.today.scheduled).toBeGreaterThanOrEqual(1);
});

// =============================================================================
// madde (h) — kurumsal hekim profil sayfası: üç sekme (Doktor Hakkında/Özgeçmiş/Bilimsel
// Yayınlar) doğru render olur; boş içerik nötr "henüz paylaşılmamış" notuyla gösterilir
// =============================================================================
test("madde (h): kurumsal profil sayfasının üç sekmesi (aboutHtml/cvEntries sırası KORUNUR, publications kind'a göre GRUPLANIR) doğru render olur", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const ABOUT_HTML_MARKER = "QA_ABOUT_HTML_MARKER";
  const richDoctor: CreatedFixtureDoctor = await createAdminDoctorFixture(adminToken, {
    title: "Prof. Dr.",
    fullName: `QA E2E Sekme İçerik Doktoru ${RUN_SUFFIX}`,
    bio: "qa-agent — [DPI] madde (h) kısa özet (bio).",
    aboutHtml: `<h2>Klinik Deneyim</h2><p>${ABOUT_HTML_MARKER} — uzun biyografi metni buradadır.</p>`,
    languages: ["tr"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: 50000,
    currency: "TRY",
    isActive: true,
    // [DPI] §1.3 kural 5 — dizi SIRASI doktorundur, sunucu YENİDEN SIRALAMAZ: EXPERIENCE (2015-)
    // BİLİNÇLİ OLARAK EDUCATION'DAN (2005-2011) ÖNCE verildi — zaman çizelgesi bu SIRAYLA render
    // etmeli (kronolojik olarak SIRALANMIŞ OLSAYDI EDUCATION önce gelirdi).
    cvEntries: [
      {
        kind: "EXPERIENCE",
        title: "QA Kıdemli Hekim Ünvanı",
        organization: "QA ABC Hastanesi",
        startYear: 2015,
        endYear: null,
        description: "QA e2e deneyim açıklaması.",
      },
      { kind: "EDUCATION", title: "QA Tıp Fakültesi Diploması", organization: "QA XYZ Üniversitesi", startYear: 2005, endYear: 2011 },
    ],
    // Girdi SIRASI kasıtlı olarak KARIŞIK (OTHER → NATIONAL → INTERNATIONAL) — render sırası
    // `PUBLICATION_GROUP_ORDER`e göre SABİT olmalı: Uluslararası → Ulusal → Diğer.
    publications: [
      { kind: "OTHER", title: "QA Diğer Yayın Başlığı", venue: "QA Dergi", year: 2020 },
      { kind: "NATIONAL_ARTICLE", title: "QA Ulusal Makale Başlığı", venue: "QA Ulusal Dergi", year: 2019 },
      { kind: "INTERNATIONAL_ARTICLE", title: "QA Uluslararası Makale Başlığı", venue: "QA Int J", year: 2021 },
    ],
  });
  richDoctorId = richDoctor.id;

  await gotoAndWaitReady(page, `/doctors/${richDoctor.slug}`, async () => {
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(richDoctor.fullName) })).toBeVisible();
  });

  // ---- "Doktor Hakkında" (varsayılan aktif sekme) — `bio` + `aboutHtml` DİKEY, İKİSİ DE görünür ----
  await expect(page.getByRole("tab", { name: "Doktor Hakkında" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("qa-agent — [DPI] madde (h) kısa özet (bio).", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Klinik Deneyim" })).toBeVisible();
  await expect(page.getByText(ABOUT_HTML_MARKER, { exact: false })).toBeVisible();

  // ---- "Özgeçmiş" — SIRA korunur (EXPERIENCE ÖNCE, EDUCATION SONRA — kronolojik DEĞİL) ----
  await page.getByRole("tab", { name: "Özgeçmiş" }).click();
  const cvPanel = page.getByRole("tabpanel", { name: "Özgeçmiş" });
  await expect(cvPanel.getByText("QA Kıdemli Hekim Ünvanı")).toBeVisible();
  await expect(cvPanel.getByText("QA Tıp Fakültesi Diploması")).toBeVisible();
  await expect(cvPanel.getByText("Devam ediyor", { exact: false })).toBeVisible(); // `endYear: null`
  const cvText = (await cvPanel.textContent()) ?? "";
  expect(
    cvText.indexOf("QA Kıdemli Hekim Ünvanı"),
    "cvEntries doktorun VERDİĞİ SIRAYLA render edilmeli (EXPERIENCE, EDUCATION'dan ÖNCE)"
  ).toBeLessThan(cvText.indexOf("QA Tıp Fakültesi Diploması"));

  // ---- "Bilimsel Yayınlar" — GRUP SIRASI sabit (Uluslararası → Ulusal → Diğer), girdi SIRASINDAN BAĞIMSIZ ----
  await page.getByRole("tab", { name: "Bilimsel Yayınlar" }).click();
  const pubPanel = page.getByRole("tabpanel", { name: "Bilimsel Yayınlar" });
  await expect(pubPanel.getByText("Uluslararası Makaleler")).toBeVisible();
  await expect(pubPanel.getByText("Ulusal Makaleler")).toBeVisible();
  await expect(pubPanel.getByText("Diğer Yayınlar")).toBeVisible();
  // qa-agent bulgusu (kendi testinde, düzeltildi) — grup başlıkları `uppercase` CSS sınıfı taşır
  // (`doctor-profile-tabs.tsx`); `innerText()` GÖRSEL/render edilmiş metni döndürür (CSS
  // `text-transform` dahil, ör. "ULUSLARARASI MAKALELER"), `textContent()` ise DOM'daki HAM metni
  // (JSX'te yazıldığı gibi, `text-transform`'dan ETKİLENMEZ) — sıralama karşılaştırması için
  // `textContent()` kullanılır, aksi hâlde `indexOf` karışık-büyük/küçük harf arama dizesiyle HİÇ
  // eşleşmezdi (ilk koşumda GÖZLEMLENDİ, kök neden bu — bug DEĞİL, CSS'in beklenen bir sonucu).
  const pubText = (await pubPanel.textContent()) ?? "";
  const intlIdx = pubText.indexOf("Uluslararası Makaleler");
  const natIdx = pubText.indexOf("Ulusal Makaleler");
  const otherIdx = pubText.indexOf("Diğer Yayınlar");
  expect(intlIdx, "'Uluslararası Makaleler' grubu İLK sırada render edilmeli").toBeGreaterThanOrEqual(0);
  expect(intlIdx, "grup sırası [Uluslararası, Ulusal, Diğer] SABİTTİR, girdi sırasından BAĞIMSIZ").toBeLessThan(natIdx);
  expect(natIdx).toBeLessThan(otherIdx);

  // ---- boş içerik — `otherDoctorFixture`'ın (madde d) `aboutHtml`/`cvEntries`/`publications`'ı
  // YOK — nötr "henüz paylaşılmamış" notu, sekme YİNE DE GÖRÜNÜR (tıklanabilir) kalmalı. ----
  await gotoAndWaitReady(page, `/doctors/${otherDoctorFixture.slug}`, async () => {
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(otherDoctorFixture.fullName) })).toBeVisible();
  });
  await page.getByRole("tab", { name: "Özgeçmiş" }).click();
  await expect(page.getByText("Bu doktor için henüz özgeçmiş bilgisi paylaşılmamış.")).toBeVisible();
  await page.getByRole("tab", { name: "Bilimsel Yayınlar" }).click();
  await expect(page.getByText("Bu doktor için henüz bilimsel yayın paylaşılmamış.")).toBeVisible();
});
