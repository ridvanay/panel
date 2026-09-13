import { test, expect, type Browser, type Page } from "@playwright/test";
import { authenticator } from "otplib";
import {
  API_BASE_URL,
  getCachedAdminSession,
  getFixtureUserToken,
  getSiteModules,
  patchSiteModule,
  setupAndEnableTwoFactorForSelf,
} from "./support/api";
import { createAuthenticatedPage, createAuthenticatedPageAs } from "./support/admin-session";
import { resetFixtureUserToBaseline, adminGetUserByEmail, adminUpdateRole } from "./support/admin-users-fixtures";
import {
  ensureTelehealthModuleWithDoctors,
  createAdminDoctorFixture,
  deleteAdminDoctorFixture,
  setDoctorAvailabilityRaw,
  linkDoctorUserRaw,
  createBookingRaw,
  getPublicDoctorSlotsRaw,
  defaultSlotRangeISODates,
  markBookingPaidDirectly,
  setAppointmentStatusDirectly,
  type CreatedFixtureDoctor,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — orkestratörün doğrudan görev talimatı: rol bazlı portal izolasyonu (Admin/Doktor/
 * Hasta) + `/admin/telehealth/overview` analitik paneli için e2e doğrulama. Backend-agent/
 * frontend-agent'ın kodu bu turda DEĞİŞTİRİLMEDİ — yalnızca doğrulama eklendi (bkz. proje kökü
 * CLAUDE.md "qa-agent: Bug'ı kendi düzeltme").
 *
 * Bu dosyanın GERÇEK davranışı yansıttığı (ticket'ın bazı YANLIŞ varsayımlarının AKSİNE)
 * mimari kararlar:
 * - `SiteRole.DOCTOR` YOKTUR — doktorluk `User.doctorProfileId !== null` ile belirlenir.
 * - Kanonik URL'ler: `/doctor` (randevu listesi, `/doctor/bookings` DEĞİL), `/patient/bookings`
 *   (`/patient/appointments` DEĞİL).
 * - `/admin/telehealth/doctors`/`specialties`: ADMIN+MANAGER+EDITOR okur (EDITOR salt-okunur).
 *   `/admin/telehealth/appointments` VE `overview`: SADECE ADMIN+MANAGER — EDITOR'e sidebar'da
 *   GÖRÜNMEZ ve backend BAĞIMSIZ olarak 403 döner (gizleme yalnızca kullanılabilirlik, güvenlik
 *   sınırı DEĞİL).
 *
 * Kendi, İZOLE fixture doktor/hasta/editor hesapları kurar — `telehealth-multi-slot-booking.spec.ts`
 * İLE AYNI desen (`createAdminDoctorFixture` + `setDoctorAvailabilityRaw`, haftanın HER günü geniş
 * pencere), paylaşımlı `telehealth-clinic` demo verisine BAĞIMLI DEĞİLDİR. Doktorun 2FA'sı,
 * `doctor-panel-session-lifecycle.spec.ts`'in ÖNCEDEN VAR OLAN bir UAT hesabı için kullandığı sabit
 * TOTP sırrının AKSİNE, GERÇEK kendi-kendine-servis akışıyla (`support/api.ts::
 * setupAndEnableTwoFactorForSelf` — `POST /2fa/setup` → `POST /2fa/enable`, `otplib` ile TAZE bir
 * fixture kullanıcı için uçtan uca) etkinleştirilir — DB'ye doğrudan secret YAZILMAZ.
 */
test.describe.configure({ mode: "serial" });

const FIXTURE_PASSWORD = "QaE2eTelehealthPortalIso12345!";
const RUN_SUFFIX = Date.now().toString(36);
const DOCTOR_USER_EMAIL = `qa-e2e-th-portaliso-doctor-${RUN_SUFFIX}@example.com`;
const PATIENT_USER_EMAIL = `qa-e2e-th-portaliso-patient-${RUN_SUFFIX}@example.com`;
const EDITOR_EMAIL = `qa-e2e-th-portaliso-editor-${RUN_SUFFIX}@example.com`;

let adminToken: string;
let initialTelehealthEnabled: boolean;
let doctorFixture: CreatedFixtureDoctor;
let doctorUserId: string;
let doctorUserToken: string;
let doctorTotpSecret: string;

let doctorOwnBooking: { bookingId: string; patientName: string };
let patientOwnBooking: { bookingId: string };
let historicalCompletedAppointmentId: string;

let adminPage: Page;
let closeAdminSession: () => Promise<void>;
let editorPage: Page;
let closeEditorSession: () => Promise<void>;
let editorApiToken: string;

async function pickAvailableSlotIso(doctorSlug: string): Promise<string> {
  const { from, to } = defaultSlotRangeISODates(14);
  const slotsRes = await getPublicDoctorSlotsRaw(doctorSlug, from, to);
  const slot = (slotsRes.data ?? []).find((s) => s.available);
  if (!slot) throw new Error(`qa-agent: ${doctorSlug} için müsait slot bulunamadı (portal izolasyonu fixture'ı).`);
  return slot.startsAt;
}

/** Doktor kullanıcısı için düz `/login`'den (next YOK) GERÇEK 2FA login akışı —
 * `doctor-panel-session-lifecycle.spec.ts::loginDoctorWithTwoFactor` İLE AYNI form/2FA deseni,
 * yalnızca ÖNCE `/doctor`'a gidip yönlendirme BEKLEMEK yerine doğrudan `/login`'den başlar (bu
 * dosyanın madde 1 senaryosu tam olarak "next OLMADAN doğrudan /login'den giriş" akışını test
 * eder). `admin-session.ts::createAuthenticatedPageAs` İLE AYNI "dosya başına ayrı context"
 * disiplini (refresh-token rotasyonu riski, bkz. o dosyanın başlığı).
 */
async function loginDoctorDirectlyWithTwoFactor(
  browser: Browser,
  email: string,
  password: string,
  totpSecret: string
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3100" });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();

  await expect(page.getByText("Kimlik doğrulama uygulamanızdaki 6 haneli kodu", { exact: false })).toBeVisible({ timeout: 15_000 });
  const code = authenticator.generate(totpSecret);
  await page.getByLabel("Doğrulama Kodu").fill(code);
  await page.getByRole("button", { name: "Doğrula" }).click();

  await page.waitForURL(/\/doctor$/, { timeout: 15_000 });
  return {
    page,
    close: async () => {
      await context.close();
    },
  };
}

async function cleanupFixtures() {
  await resetFixtureUserToBaseline(adminToken, DOCTOR_USER_EMAIL);
  await resetFixtureUserToBaseline(adminToken, PATIENT_USER_EMAIL);
  await resetFixtureUserToBaseline(adminToken, EDITOR_EMAIL);
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(180_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  await cleanupFixtures();

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);

  // ---- İzole fixture doktor (paylaşımlı telehealth-clinic demo verisine BAĞIMLI DEĞİL) ----
  doctorFixture = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `QA E2E Portal İzolasyon ${RUN_SUFFIX}`,
    bio: "qa-agent — portal izolasyonu e2e fixture doktoru.",
    languages: ["tr"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: 40000,
    currency: "TRY",
    isVerified: true,
    isActive: true,
  });
  await setDoctorAvailabilityRaw(
    adminToken,
    doctorFixture.id,
    ([1, 2, 3, 4, 5, 6, 7] as const).map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }))
  );

  // ---- Doktor hesabı: fixture kullanıcı → doktor profiline bağlanır → GERÇEK 2FA etkinleştirilir ----
  doctorUserToken = await getFixtureUserToken(DOCTOR_USER_EMAIL, FIXTURE_PASSWORD, "QA E2E Portal İzolasyon Doktoru");
  const doctorUser = await adminGetUserByEmail(adminToken, DOCTOR_USER_EMAIL);
  if (!doctorUser) throw new Error("qa-agent: doktor fixture kullanıcısı oluşturulamadı.");
  doctorUserId = doctorUser.id;
  await linkDoctorUserRaw(adminToken, doctorFixture.id, doctorUserId);
  const twoFactor = await setupAndEnableTwoFactorForSelf(doctorUserToken);
  doctorTotpSecret = twoFactor.secret;

  // ---- Doktorun KENDİ (gelecekteki, ödenmiş) randevusu — madde 1 izolasyon doğrulaması ----
  const doctorBookingPatientName = `QA Doktor İzo Hasta ${RUN_SUFFIX}`;
  const slot1 = await pickAvailableSlotIso(doctorFixture.slug);
  const booking1 = await createBookingRaw({
    doctorSlug: doctorFixture.slug,
    slots: [slot1],
    patientName: doctorBookingPatientName,
    patientEmail: `qa-e2e-th-portaliso-doctor-patient-${RUN_SUFFIX}@example.com`,
  });
  if (booking1.status !== 201 || !booking1.data) {
    throw new Error(`qa-agent: doktor izolasyonu fixture booking'i oluşturulamadı: ${booking1.status} ${JSON.stringify(booking1.error)}`);
  }
  markBookingPaidDirectly(booking1.data.bookingId);
  setAppointmentStatusDirectly(booking1.data.appointments[0]!.id, "SCHEDULED");
  doctorOwnBooking = { bookingId: booking1.data.bookingId, patientName: doctorBookingPatientName };

  // ---- Hasta hesabı (USER — telehealth hasta portalı SiteRole GEREKTİRMEZ) + KENDİ randevusu ----
  const patientToken = await getFixtureUserToken(PATIENT_USER_EMAIL, FIXTURE_PASSWORD, "QA E2E Portal İzolasyon Hastası");
  const slot2 = await pickAvailableSlotIso(doctorFixture.slug);
  const booking2 = await createBookingRaw(
    {
      doctorSlug: doctorFixture.slug,
      slots: [slot2],
      patientName: "QA E2E Portal İzolasyon Hastası",
      patientEmail: PATIENT_USER_EMAIL,
    },
    patientToken
  );
  if (booking2.status !== 201 || !booking2.data) {
    throw new Error(`qa-agent: hasta izolasyonu fixture booking'i oluşturulamadı: ${booking2.status} ${JSON.stringify(booking2.error)}`);
  }
  markBookingPaidDirectly(booking2.data.bookingId);
  setAppointmentStatusDirectly(booking2.data.appointments[0]!.id, "SCHEDULED");
  patientOwnBooking = { bookingId: booking2.data.bookingId };

  // ---- Geçmişte TAMAMLANMIŞ bir seans — `/admin/telehealth/overview`'un varsayılan aralığı
  // (son 30 gün) İÇİNDE en az bir gelir/tamamlanan-seans veri noktası garantiler (aksi halde
  // grafikler "Henüz gelir hareketi yok" boş durumuna düşer, SVG hiç render edilmez). ----
  const slot3 = await pickAvailableSlotIso(doctorFixture.slug);
  const booking3 = await createBookingRaw({
    doctorSlug: doctorFixture.slug,
    slots: [slot3],
    patientName: `QA Admin Analitik Fixture ${RUN_SUFFIX}`,
    patientEmail: `qa-e2e-th-portaliso-analytics-${RUN_SUFFIX}@example.com`,
  });
  if (booking3.status !== 201 || !booking3.data) {
    throw new Error(`qa-agent: admin analitik fixture booking'i oluşturulamadı: ${booking3.status} ${JSON.stringify(booking3.error)}`);
  }
  markBookingPaidDirectly(booking3.data.bookingId);
  historicalCompletedAppointmentId = booking3.data.appointments[0]!.id;
  setAppointmentStatusDirectly(historicalCompletedAppointmentId, "COMPLETED", { daysAgo: 3 });

  // ---- EDITOR fixture'ı (madde 4 — RBAC bloğu) ----
  const editorApiTokenLocal = await getFixtureUserToken(EDITOR_EMAIL, FIXTURE_PASSWORD, "QA E2E Portal İzolasyon Editor");
  editorApiToken = editorApiTokenLocal;
  const editorUser = await adminGetUserByEmail(adminToken, EDITOR_EMAIL);
  if (!editorUser) throw new Error("qa-agent: EDITOR fixture kullanıcısı oluşturulamadı.");
  await adminUpdateRole(adminToken, editorUser.id, "EDITOR");

  ({ page: adminPage, close: closeAdminSession } = await createAuthenticatedPage(browser));
  ({ page: editorPage, close: closeEditorSession } = await createAuthenticatedPageAs(browser, EDITOR_EMAIL, FIXTURE_PASSWORD));
});

test.afterAll(async () => {
  if (closeAdminSession) await closeAdminSession();
  if (closeEditorSession) await closeEditorSession();
  await cleanupFixtures();
  // Doktorun GERÇEK randevuları var — `Appointment.doctor` `onDelete: Restrict` (schema.prisma),
  // silme isteği 409 ile başarısız olur (bkz. `telehealth-fixtures.ts` dosya başlığı, AYNI
  // `telehealth-multi-slot-booking.spec.ts::afterAll` deseni) — leftover satır sonraki koşumları
  // BOZMAZ (RUN_SUFFIX her koşumda benzersiz), bu yüzden hata SESSİZCE yutulur.
  if (doctorFixture) await deleteAdminDoctorFixture(adminToken, doctorFixture.id).catch(() => undefined);
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

// =============================================================================
// madde 1 — Doktor izolasyonu
// =============================================================================
test("madde 1: doktor 2FA ile düz /login'den giriş yapınca doğrudan /doctor'a yönlenir; header'da yalnızca 'Doktor Paneli' vardır; randevu listesi KENDİ randevusuyla sınırlıdır", async ({
  browser,
}) => {
  const { page, close } = await loginDoctorDirectlyWithTwoFactor(browser, DOCTOR_USER_EMAIL, FIXTURE_PASSWORD, doctorTotpSecret);
  try {
    // `?next=` YOK — düz `/login`'den giriş, `resolvePostLoginPath` doktor+telehealth-açık dalına
    // düşüp `/doctor`'a yönlendirmiş olmalı (404 YOK, `waitForURL` içinde zaten doğrulandı).
    await expect(page).toHaveURL(/\/doctor$/);

    // Çift-header regresyonu — `DoctorPortalShell` artık kendi `<header>`'ını render ETMEZ.
    await expect(page.locator("header")).toHaveCount(1);

    // Hesap menüsü — §K6 KESİN sıra: "Doktor Paneli" VAR, "Randevularım"(hasta varyantı)/
    // "Siparişlerim" YOK. Sepet/favori ikonları da (top-level, menü DIŞINDA) YOK.
    await page.getByRole("button", { name: /^Hesabım,/ }).click();
    await expect(page.getByRole("menuitem", { name: "Doktor Paneli" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("menuitem", { name: "Randevularım" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Siparişlerim" })).toHaveCount(0);
    // "Hesabım" HER İKİ durumda da menüde kalmalı (2FA erişimi için).
    await expect(page.getByRole("menuitem", { name: "Hesabım" })).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.getByLabel(/^Sepet,/)).toHaveCount(0);
    await expect(page.getByLabel("Favorilerim")).toHaveCount(0);

    // Randevu listesi — SADECE bu doktorun kendi randevusu (backend zaten `doctorId` sorgu
    // parametresi TAŞIMAZ, yalnızca oturumun KENDİ `DoctorProfile`'ı üzerinden filtreler —
    // `telehealth.portal.routes.ts::requireDoctorPortalAccess`; burada UI'da da yansımasını
    // doğrular). Bu fixture doktoru TAZE olduğundan (yalnızca bu turda ürettiğimiz 3 randevu:
    // bu booking + hasta izolasyonu fixture'ı + admin analitik fixture'ı, ÜÇÜ DE aynı doktora ait)
    // tablo satır sayısı da DOLAYLI bir sızıntı kontrolüdür — BAŞKA bir doktorun randevusu asla
    // görünmemelidir.
    await expect(page.getByRole("heading", { name: "Randevularım" })).toBeVisible({ timeout: 15_000 });
    const row = page.locator("tr", { hasText: doctorOwnBooking.patientName });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("tbody tr")).toHaveCount(3);
  } finally {
    await close();
  }
});

// =============================================================================
// madde 2 — Hasta izolasyonu
// =============================================================================
test("madde 2: hasta girişinde header 'Randevularım' linki /patient/bookings'e gider; listede SADECE kendi randevusu görünür", async ({
  browser,
}) => {
  const { page, close } = await createAuthenticatedPageAs(browser, PATIENT_USER_EMAIL, FIXTURE_PASSWORD);
  try {
    // `createAuthenticatedPageAs` `/dashboard`'a yönlendirilmeyi bekler (doktor OLMAYAN hesap için
    // mevcut/değişmeyen davranış) — header'ı görmek için site sayfasına geçilir.
    await page.goto("/");

    await page.getByRole("button", { name: /^Hesabım,/ }).click();
    await expect(page.getByRole("menuitem", { name: "Doktor Paneli" })).toHaveCount(0);
    const patientLink = page.getByRole("menuitem", { name: "Randevularım" });
    await expect(patientLink).toBeVisible({ timeout: 10_000 });
    await patientLink.click();
    await expect(page).toHaveURL(/\/patient\/bookings$/);

    await expect(page.getByRole("heading", { name: "Randevularım" })).toBeVisible({ timeout: 15_000 });
    const row = page.locator("tr", { hasText: `${doctorFixture.title} ${doctorFixture.fullName}` });
    await expect(row).toBeVisible({ timeout: 15_000 });
    // Bu hasta hesabı YALNIZCA 1 randevu oluşturdu — backend `patientUserId: request.user!.id`
    // ile filtreler (`telehealth.portal.routes.ts::telehealthPatientPortalRoutes`); doktorun KENDİ
    // diğer randevuları (doktor izolasyonu/admin analitik fixture'ları) burada SIZMAMALIDIR.
    await expect(page.locator("tbody tr")).toHaveCount(1);
  } finally {
    await close();
  }
});

// =============================================================================
// madde 3 — Admin analitik paneli + kullanıcılar sayfasında doktor rozeti
// =============================================================================
test("madde 3a: ADMIN /admin/telehealth/overview — KPI kartları, Recharts grafikleri ve doktor kırılım tablosu render olur", async () => {
  await adminPage.goto("/admin/telehealth/overview");
  await expect(adminPage.getByRole("heading", { name: "Tele-Sağlık Özeti" })).toBeVisible({ timeout: 15_000 });

  // KPI kartları (5 adet, `StatCard`).
  for (const label of ["Tamamlanan Seans", "Yaklaşan Randevu", "İptal / Gelmedi", "Ödeme Bekleyen", "Komisyon Geliri"]) {
    await expect(adminPage.getByText(label, { exact: true })).toBeVisible({ timeout: 15_000 });
  }

  // Recharts SVG'leri — `historicalCompletedAppointmentId` (3 gün önce, COMPLETED) varsayılan
  // 30 günlük aralık İÇİNDE olduğundan her iki grafik de boş-durum yerine GERÇEKTEN render olur.
  // qa-agent bulgusu: Recharts `ResponsiveContainer` her grafik İÇİN birden fazla `.recharts-surface`
  // (ana çizim + iç katmanlar) üretir — TAM sayı yerine "en az 2 farklı grafiğin ürettiği kadar" alt sınır kontrol edilir.
  await expect(adminPage.locator(".recharts-surface").first()).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => adminPage.locator(".recharts-surface").count(), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(2);

  // Doktor bazlı kırılım — bu fixture doktoru TAZE (yalnızca bizim ürettiğimiz randevular)
  // olduğundan brüt/net rakamları DETERMİNİSTİK olarak hesaplanabilir (%15 varsayılan komisyon —
  // `backend/.env.e2e`'de override EDİLMEZ, bkz. `config/env.ts` varsayılanı).
  await expect(adminPage.getByRole("heading", { name: "Doktor Bazlı Kırılım" })).toBeVisible();
  const doctorRow = adminPage.locator("tr", { hasText: doctorFixture.fullName });
  await expect(doctorRow).toBeVisible({ timeout: 15_000 });
  const grossFmt = new Intl.NumberFormat("tr-TR", { style: "currency", currency: doctorFixture.currency }).format(
    doctorFixture.sessionPriceCents / 100
  );
  const commissionCents = Math.round((doctorFixture.sessionPriceCents * 15) / 100);
  const netFmt = new Intl.NumberFormat("tr-TR", { style: "currency", currency: doctorFixture.currency }).format(
    (doctorFixture.sessionPriceCents - commissionCents) / 100
  );
  await expect(doctorRow.getByText(grossFmt, { exact: true })).toBeVisible();
  await expect(doctorRow.getByText(netFmt, { exact: true })).toBeVisible();
});

test("madde 3b: ADMIN /admin/users — doktor profiline bağlı en az bir kullanıcının yanında 'Doktor' rozeti görünür", async () => {
  // qa-agent bulgusu (bu turda, frontend-agent'a raporlandı — bkz. final rapor): `GET /admin/users`
  // `GET /admin/telehealth/doctors`'ın AKSİNE gerçek bir `search` sorgu parametresi TAŞIMAZ VE
  // `admin/users/page.tsx::load()` yalnızca TEK bir sayfa (`limit: 100`, cursor'suz, `seq asc`)
  // çeker — arama kutusu (`useFilteredList`) SADECE bu ÖNCEDEN YÜKLENMİŞ 100 kaydı istemci
  // tarafında filtreler. Paylaşımlı/kalıcı `saas_e2e` bu turda 100 kullanıcıyı AŞTIĞINDAN (qa-agent
  // bu turda gözlemledi) bu dosyanın TAZE oluşturduğu doktor fixture kullanıcısı (en YÜKSEK `seq`)
  // ilk sayfada HİÇ görünmeyebilir — arama kutusu onu asla BULAMAZ. Bu yüzden test, sayfanın
  // GERÇEKTEN çektiği sorguyla (`limit=100`, cursor'suz) BİREBİR aynı isteği önce API'den yapıp
  // "ilk sayfada doktor profiline bağlı HERHANGİ bir kullanıcı" arar (görev tanımının kendisi de
  // "en az bir kullanıcı" diyor, belirli bir kullanıcı DEĞİL) — bu hem paylaşımlı DB'nin büyüklüğünden
  // BAĞIMSIZ hem de sayfanın GERÇEKTEN render ettiği veriyle tutarlıdır.
  const listRes = await fetch(`${API_BASE_URL}/admin/users?limit=100`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const listBody = (await listRes.json()) as {
    data: Array<{ email: string; doctorProfileId: string | null; status: string }>;
  };
  const linkedUser = listBody.data.find((u) => u.doctorProfileId !== null && u.status !== "DELETED");
  expect(
    linkedUser,
    "ilk 100 kullanıcı içinde doktor profiline bağlı hiçbir kullanıcı bulunamadı — /admin/users sayfalama/arama sınırlaması (bkz. qa-agent raporu)"
  ).toBeTruthy();

  await adminPage.goto("/admin/users");
  // qa-agent bulgusu (bu turda EK): sayfanın KENDİ istemci-taraflı görüntüleme sayfalaması
  // (`useFilteredList`, varsayılan küçük `pageSize`) yüklenen 100 kaydın TAMAMINI aynı anda
  // GÖSTERMEZ — arama kutusu (aksine) filtrelemeyi TÜM yüklenen diziye uygular (`pageSize`'tan
  // BAĞIMSIZ), bu yüzden hedef kullanıcı yalnızca arama kutusuyla GÜVENİLİR şekilde görünür hale
  // gelir (rastgele bir görüntüleme sayfasında olup olmadığına bakılmaksızın).
  await adminPage.getByLabel("İsim veya e-posta ara").fill(linkedUser!.email);
  const row = adminPage.locator("tr", { hasText: linkedUser!.email });
  await expect(row).toBeVisible({ timeout: 15_000 });
  const badge = row.getByText("Doktor", { exact: true });
  await expect(badge).toBeVisible();
  await expect(badge.locator("xpath=ancestor::a[1]")).toHaveAttribute("href", `/admin/telehealth/doctors/${linkedUser!.doctorProfileId}`);
});

// =============================================================================
// madde 4 — EDITOR RBAC bloğu (`/admin/telehealth/overview` + `appointments` SADECE ADMIN+MANAGER;
// `doctors`/`specialties` EDITOR'e salt-okunur AÇIK — ticket'ın "tamamen gizle" varsayımı YANLIŞ)
// =============================================================================
test("madde 4a: EDITOR sidebar'da 'Tele-Sağlık Özeti' ve 'Randevular' GÖRÜNMEZ; 'Uzmanlıklar'/'Tele-Sağlık' (doktorlar) GÖRÜNÜR", async () => {
  await editorPage.goto("/admin/telehealth/doctors");
  const sidebarButtons = editorPage.locator('[data-slot="sidebar-menu-button"]');

  await expect(sidebarButtons.filter({ hasText: "Tele-Sağlık Özeti" })).toHaveCount(0);
  await expect(sidebarButtons.filter({ hasText: "Randevular" })).toHaveCount(0);
  await expect(sidebarButtons.filter({ hasText: "Uzmanlıklar" })).toBeVisible();
  // "Tele-Sağlık" tek başına hem doktorlar HEM "Tele-Sağlık Özeti" öğesiyle alt-dize eşleşir —
  // yalnızca doktorlar öğesinin (TAM "Tele-Sağlık" metni) var olduğunu regex ile kesinleştirir.
  await expect(sidebarButtons.filter({ hasText: /^Tele-Sağlık$/ })).toBeVisible();
});

test("madde 4b: EDITOR — doğrudan URL ile /admin/telehealth/overview'a gidince backend BAĞIMSIZ olarak 403 verir", async () => {
  await editorPage.goto("/admin/telehealth/overview");
  await expect(editorPage.getByRole("heading", { name: "Tele-Sağlık Özeti" })).toBeVisible({ timeout: 15_000 });
  await expect(editorPage.getByText("Bu işlem için yetkiniz yok.", { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(editorPage.locator(".recharts-surface")).toHaveCount(0);

  const apiRes = await fetch(`${API_BASE_URL}/admin/telehealth/analytics/overview`, {
    headers: { Authorization: `Bearer ${editorApiToken}` },
  });
  expect(apiRes.status).toBe(403);
});

test("madde 4c: EDITOR — doğrudan URL ile /admin/telehealth/appointments'a gidince backend BAĞIMSIZ olarak 403 verir", async () => {
  await editorPage.goto("/admin/telehealth/appointments");
  await expect(editorPage.getByRole("heading", { name: "Randevular" })).toBeVisible({ timeout: 15_000 });
  await expect(editorPage.getByText("Bu işlem için yetkiniz yok.", { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(editorPage.locator("table")).toHaveCount(0);
});

test("madde 4d: EDITOR — 'doctors'/'specialties' sayfaları GÖRÜNÜR ve erişilebilir kalır (bilinçli mimari karar, tamamen gizleme YOK)", async () => {
  await editorPage.goto("/admin/telehealth/doctors");
  await expect(editorPage.getByText("Bu işlem için yetkiniz yok.", { exact: false })).toHaveCount(0);
  // Liste sunucu tarafında `search` destekler (`listAdminDoctors({ search, limit: 100 })`) — bu
  // fixture doktoru (TAZE, en yüksek `seq`) paylaşımlı/kalıcı dev veritabanında ilk 100 kayıt
  // İÇİNDE olmayabilir (`admin-users-fixtures.ts::adminGetUserByEmail` başlığındaki AYNI sayfalama
  // bulgusu) — arama kutusuyla DARALTILIR.
  await editorPage.getByLabel("Doktor ara").fill(doctorFixture.fullName);
  await expect(editorPage.locator("tr", { hasText: doctorFixture.fullName })).toBeVisible({ timeout: 15_000 });

  await editorPage.goto("/admin/telehealth/specialties");
  await expect(editorPage.getByText("Bu işlem için yetkiniz yok.", { exact: false })).toHaveCount(0);
});
