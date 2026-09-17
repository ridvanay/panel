import path from "node:path";
import { execFileSync } from "node:child_process";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { authenticator } from "otplib";
import {
  API_BASE_URL,
  getSiteModules,
  patchSiteModule,
  getFixtureUserToken,
  setupAndEnableTwoFactorForSelf,
} from "./support/api";
import { adminGetUserByEmail } from "./support/admin-users-fixtures";
import {
  ensureTelehealthModuleWithDoctors,
  createAdminDoctorFixture,
  deleteAdminDoctorFixture,
  setDoctorAvailabilityRaw,
  linkDoctorUserRaw,
  createBookingRaw,
  getPublicDoctorSlotsRaw,
  defaultSlotRangeISODates,
  getDoctorOverviewRaw,
  shiftAppointmentIntoJoinWindowDirectly,
  type CreatedFixtureDoctor,
} from "./support/telehealth-fixtures";
import { submitBookingIdentityStep } from "./support/telehealth-identity-ui";

/**
 * qa-agent — `.claude/architect-scope-demo-payment-doctor-counters.md` (bağlayıcı) e2e doğrulaması.
 *
 * **BİLİNÇLİ OLARAK farklı ortam** (`doctor-panel-session-lifecycle.spec.ts` İLE AYNI felsefe):
 * bu dosya, projenin geri kalan e2e suite'inin (`saas_e2e` + backend `localhost:4001` + frontend
 * `localhost:3100`, `playwright.config.ts`'in kendi `webServer`'ı) KULLANDIĞI ortama karşı ÇALIŞMAZ
 * — çünkü demo ödeme ucu SADECE koordinatörün ayağa kaldırdığı geliştirme Docker Compose yığınında
 * (`docker-compose.yml` + `docker-compose.dev.yml`, backend `NODE_ENV=development` +
 * `ENABLE_DEMO_PAYMENTS=true`, frontend `NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS=true` build-arg'ıyla)
 * AÇIKTIR. Standart `saas_e2e`/`backend/.env.e2e` bu bayrağı TAŞIMAZ (bilerek — dokümantasyon-agent
 * `.env.example` uyarısı gereği demo ödemesi asla varsayılan olarak açık DEĞİLDİR).
 *
 * ÇALIŞTIRMA (host adları `*.siteadi.localhost` tarayıcı tarafından otomatik 127.0.0.1'e çözülür,
 * hosts dosyası GEREKMEZ — `doctor-subdomain-isolation.spec.ts` İLE AYNI gözlem):
 *   cd frontend
 *   E2E_SKIP_WEBSERVER=1 \
 *   E2E_FRONTEND_URL=http://siteadi.localhost:3000 \
 *   E2E_DOCTOR_FRONTEND_URL=http://doktor.siteadi.localhost:3000 \
 *   E2E_API_URL=http://localhost:4000/api/v1 \
 *   E2E_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/saas_dev?schema=public" \
 *   npx playwright test tests/e2e/telehealth-demo-payment-doctor-counters.spec.ts --project=chromium --no-deps
 *
 * `--no-deps` — `auth.setup.ts` `saas_e2e`'ye karşı bir ADMIN fixture login'i dener, bu dosyanın
 * İHTİYACI DEĞİLDİR (kendi admin bootstrap'ini KENDİSİ yapar, aşağıya bakın) ve atlanmazsa
 * ayakta olmayan `localhost:4001`'e istek atıp suite'i baştan düşürür.
 *
 * **Test sırası — BİLİNÇLİ:** senaryo 1-3 (backend demo-pay + doktor konsolu sayaçları/rozet/
 * "Odaya Katıl" + regresyon) `serial` modda İLK sırada koşar. Senaryo 4 (hasta tarafı GERÇEK
 * tarayıcı, adım 5'teki buton) EN SONA konuldu — bir zamanlar `frontend/Dockerfile`'daki eksik
 * `ARG`/`ENV NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS` yüzünden kırıktı (`e0653aa` ile giderildi, bkz.
 * senaryo 4'ün başlık yorumu), sıralama o dönem 1-3'ün bloklanmaması için seçildi ve o zamandan
 * beri KORUNDU (`serial` modda bir test FAIL olursa Playwright dosyanın kalanını atlar).
 *
 * **Admin bootstrap — neden `getCachedAdminSession()` KULLANILMAZ:** o yardımcı `saas_e2e`'ye
 * ÖNCEDEN TOHUMLANMIŞ (`qa-e2e-admin@example.com`) bir ADMIN fixture'ı varsayar; `saas_dev`'de
 * böyle bir fixture YOKTUR ve gerçek `ADMIN` hesabı (`ridvan.ay3@gmail.com`) — proje kuralı
 * gereği — kullanılmaz/değiştirilmez. Bunun yerine: taze bir kullanıcı `POST /auth/register` ile
 * (herkese açık, normal akış) oluşturulur, ardından `saas_dev`'e doğrudan tek bir SQL UPDATE ile
 * `role='ADMIN'` yazılır (`backend/src/middleware/authenticate.ts` rolü HER İSTEKTE DB'den taze
 * okur — JWT'ye gömmez, bu yüzden token'ı YENİDEN ALMAYA gerek YOK). Bu, `setUserTwoFactorEnabledDirectly`
 * (`telehealth-fixtures.ts`) İLE AYNI "gerçek kullanıcı, sahte olan yalnızca bayrak/rol" felsefesi.
 */
test.describe.configure({ mode: "serial" });

const SITE_ORIGIN = process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3000";
const DOCTOR_ORIGIN = process.env.E2E_DOCTOR_FRONTEND_URL ?? "http://doktor.siteadi.localhost:3000";
const DEV_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/saas_dev?schema=public";
const BACKEND_DIR = path.resolve(process.cwd(), "..", "backend");

function runSqlDirectly(sql: string): void {
  execFileSync("npx", ["prisma", "db", "execute", "--stdin", `--url=${DEV_DATABASE_URL}`], {
    cwd: BACKEND_DIR,
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
}

function promoteUserToAdminDirectly(email: string): void {
  const esc = (v: string) => v.replace(/'/g, "''");
  runSqlDirectly(`UPDATE "users" SET "role" = 'ADMIN' WHERE email = '${esc(email)}';`);
}

function deleteUserDirectly(email: string): void {
  const esc = (v: string) => v.replace(/'/g, "''");
  runSqlDirectly(`DELETE FROM "users" WHERE email = '${esc(email)}';`);
}

const RUN_SUFFIX = Date.now().toString(36);
const QA_ADMIN_EMAIL = `qa-e2e-demo-pay-admin-${RUN_SUFFIX}@example.com`;
const QA_ADMIN_PASSWORD = "QaE2eDemoPayAdmin12345!";
const DOCTOR_USER_EMAIL = `qa-e2e-demo-pay-doctor-${RUN_SUFFIX}@example.com`;
const FIXTURE_PASSWORD = "QaE2eDemoPayDoctor12345!";
const PATIENT_PAID_NAME = `QA Demo Pay Hasta ${RUN_SUFFIX}`;
const PATIENT_UNPAID_NAME = `QA Demo Pay Odenmemis Hasta ${RUN_SUFFIX}`;

async function createQaAdminToken(): Promise<string> {
  const token = await getFixtureUserToken(QA_ADMIN_EMAIL, QA_ADMIN_PASSWORD, "QA E2E Demo Pay Admin");
  promoteUserToAdminDirectly(QA_ADMIN_EMAIL);
  return token;
}

let adminToken: string;
let initialTelehealthEnabled: boolean;
let doctorFixture: CreatedFixtureDoctor;
let doctorUserToken: string;
let doctorTotpSecret: string;
let overviewBaseline: { upcomingBookingTotal: number; allBookingTotal: number };
let paidBookingId: string;
let paidAppointmentId: string;

async function gotoAndWaitReady(page: Page, url: string, ready: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await ready();
  }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });
}

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
  throw new Error("qa-agent: takvimde görünür hiçbir günde müsait bir saat slotu bulunamadı.");
}

async function loginDoctorWithTwoFactor(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: DOCTOR_ORIGIN, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${DOCTOR_ORIGIN}/login`);
  await page.getByLabel("E-posta").fill(DOCTOR_USER_EMAIL);
  await page.getByLabel("Şifre").fill(FIXTURE_PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();

  await expect(page.getByText("İki adımlı doğrulama", { exact: false })).toBeVisible({ timeout: 15_000 });
  const code = authenticator.generate(doctorTotpSecret);
  await page.getByLabel("Authenticator Kodu").fill(code);
  await page.getByRole("button", { name: "Doğrula" }).click();

  await page.waitForURL(/\/doctor$/, { timeout: 15_000 });
  return { page, close: async () => context.close() };
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(180_000);
  adminToken = await createQaAdminToken();

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);

  doctorFixture = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `QA E2E Demo Pay Doktoru ${RUN_SUFFIX}`,
    bio: "qa-agent — demo ödeme + doktor konsolu sayaçları e2e fixture doktoru (docker dev yığını, saas_dev).",
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

  doctorUserToken = await getFixtureUserToken(DOCTOR_USER_EMAIL, FIXTURE_PASSWORD, "QA E2E Demo Pay Doktoru");
  const doctorUser = await adminGetUserByEmail(adminToken, DOCTOR_USER_EMAIL);
  if (!doctorUser) throw new Error("qa-agent: doktor fixture kullanıcısı oluşturulamadı.");
  await linkDoctorUserRaw(adminToken, doctorFixture.id, doctorUser.id);
  const twoFactor = await setupAndEnableTwoFactorForSelf(doctorUserToken);
  doctorTotpSecret = twoFactor.secret;

  // Sayaçların "önce" değeri — taze fixture doktorda 0/0 olmalı, ama sabit varsayılmaz (gerçek
  // API'den okunur), böylece assertion'lar mutlak değere DEĞİL, GÖZLEMLENEN farka dayanır.
  const overviewRes = await getDoctorOverviewRaw(doctorUserToken);
  expect(overviewRes.status, `qa-agent: /doctor/overview başlangıç okuması başarısız: ${JSON.stringify(overviewRes.error)}`).toBe(200);
  overviewBaseline = {
    upcomingBookingTotal: (overviewRes.data as unknown as { upcomingBookingTotal: number }).upcomingBookingTotal,
    allBookingTotal: (overviewRes.data as unknown as { allBookingTotal: number }).allBookingTotal,
  };
});

test.afterAll(async () => {
  if (doctorFixture) await deleteAdminDoctorFixture(adminToken, doctorFixture.id).catch(() => undefined);
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
  // Kendi ürettiğimiz fixture kullanıcıları kalıcı olarak temizlenir (görev talimatı — "iş bitince
  // temizle"), GERÇEK hesaplara (`ridvan.ay3@gmail.com`) HİÇ DOKUNULMADI.
  deleteUserDirectly(DOCTOR_USER_EMAIL);
  deleteUserDirectly(QA_ADMIN_EMAIL);
});

/** `frontend/src/lib/api/telehealth.ts::demoPayBooking` İLE AYNI istek şekli — UI'nin `fetch`
 * sarmalayıcısını (`apiFetch`) İÇE AKTARMADAN, `support/telehealth-fixtures.ts::createBookingRaw`
 * İLE AYNI "ham `fetch`" deseninde. Senaryo 2/3'ün `paidBookingId` bağımlılığını Senaryo 1'in
 * TARAYICI/buton görünürlüğünden AYRIŞTIRMAK için — bkz. senaryo 1b başlığı. */
async function demoPayBookingRaw(bookingId: string, accessToken?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = new URL(`${API_BASE_URL}/appointments/bookings/${bookingId}/demo-pay`);
  if (accessToken) url.searchParams.set("t", accessToken);
  const res = await fetch(url, { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

// =============================================================================
// Senaryo 1 — BACKEND seviyesinde doğrulama (bilerek İLK, çünkü `serial` modda bir test
// FAILED olursa Playwright dosyanın KALANINI atlar — aşağıdaki, BİLİNEN bir frontend build
// bug'ı yüzünden ŞİMDİLİK BAŞARISIZ olan senaryo 1-UI en SONA alındı, bkz. dosya sonu). Booking
// GERÇEK herkese açık `POST /appointments/bookings` ile oluşturulur (sahte veri YOK), yalnızca
// demo-pay ÇAĞRISI UI butonu yerine doğrudan `fetch` ile yapılır — `POST /appointments/bookings/
// {id}/demo-pay` ucunun kendisi (backend-agent'ın implementasyonu) dosya sonundaki Dockerfile
// bug'ından ETKİLENMEZ (backend bayrağı `docker-compose.dev.yml`'in `environment:` override'ıyla
// RUNTIME'da okunur, bir build-time inlining sorunu YOK — zaten görev talimatındaki ortam
// doğrulamasında 200/404 ile TEYİT edildi). Senaryo 2/3'ün `paidBookingId`/`paidAppointmentId`
// ihtiyacı BURADAN karşılanır.
// =============================================================================
test("senaryo 1 [backend, UI butonundan bağımsız]: POST demo-pay 200 döner, booking PAID + randevu SCHEDULED olur", async () => {
  test.setTimeout(30_000);

  const { from, to } = defaultSlotRangeISODates(14);
  const slotsRes = await getPublicDoctorSlotsRaw(doctorFixture.slug, from, to);
  const slot = (slotsRes.data ?? []).find((s) => s.available);
  if (!slot) throw new Error("qa-agent: senaryo 1b için müsait slot bulunamadı.");

  const created = await createBookingRaw({
    doctorSlug: doctorFixture.slug,
    slots: [slot.startsAt],
    patientName: PATIENT_PAID_NAME,
    patientEmail: `qa-e2e-demo-pay-api-${RUN_SUFFIX}@example.com`,
  });
  expect(created.status).toBe(201);
  expect(created.data!.paymentStatus).toBe("PENDING");

  const paid = await demoPayBookingRaw(created.data!.bookingId, created.data!.accessToken);
  expect(paid.status, `qa-agent: POST .../demo-pay 200 dönmeli, gövde: ${JSON.stringify(paid.body)}`).toBe(200);
  const data = (paid.body as { data: { id: string; paymentStatus: string; appointments: { id: string; status: string }[] } }).data;
  expect(data.paymentStatus).toBe("PAID");
  expect(data.appointments[0]?.status).toBe("SCHEDULED");

  paidBookingId = data.id;
  paidAppointmentId = data.appointments[0]!.id;
});

// =============================================================================
// Senaryo 2 — doktor konsolu: sayaçlar `upcomingBookingTotal`/`allBookingTotal`'dan BİRER artar,
// "Ödeme Bekliyor" rozeti kalkar, "Odaya Katıl" katılım penceresine girince AKTİF olur.
// =============================================================================
test("senaryo 2: doktor konsolu — Gelecek Randevular/Tümü sayaçları 1 artar, Ödeme Bekliyor rozeti kalkar, Odaya Katıl aktifleşir", async ({ browser }) => {
  test.setTimeout(60_000);

  const overviewAfterPayRes = await getDoctorOverviewRaw(doctorUserToken);
  expect(overviewAfterPayRes.status).toBe(200);
  const overviewAfterPay = overviewAfterPayRes.data as unknown as { upcomingBookingTotal: number; allBookingTotal: number };
  expect(overviewAfterPay.upcomingBookingTotal, "upcomingBookingTotal demo ödeme sonrası TAM 1 artmalı").toBe(overviewBaseline.upcomingBookingTotal + 1);
  expect(overviewAfterPay.allBookingTotal, "allBookingTotal demo ödeme sonrası TAM 1 artmalı (booking oluşturulduğunda zaten sayılıyordu)").toBe(
    overviewBaseline.allBookingTotal + 1
  );

  const { page, close } = await loginDoctorWithTwoFactor(browser);
  try {
    const upcomingTab = page.getByRole("tab", { name: "Gelecek Randevular" });
    await expect(upcomingTab).toContainText(String(overviewAfterPay.upcomingBookingTotal), { timeout: 15_000 });
    const allTab = page.getByRole("tab", { name: "Tümü" });
    await expect(allTab).toContainText(String(overviewAfterPay.allBookingTotal));

    await upcomingTab.click();
    const patientNameText = page.getByText(PATIENT_PAID_NAME, { exact: true });
    await expect(patientNameText).toBeVisible({ timeout: 15_000 });
    const card = patientNameText.locator("xpath=ancestor::div[contains(@class,'shadow-sm')][1]");

    // "Ödeme Bekliyor" rozeti ARTIK YOK (appointment SCHEDULED'a geçti).
    await expect(card.getByText("Ödeme Bekliyor")).toHaveCount(0);

    // Katılım penceresi henüz açılmadı (randevu >2 saat ileride) — buton şimdilik disabled/tooltip
    // VEYA bekleme etiketi olabilir, "önce ödeme tamamlanmalı" gerekçesi KESİNLİKLE GÖRÜNMEMELİ.
    const joinDisabled = card.getByRole("button", { name: "Odaya Katıl" });
    if (await joinDisabled.isVisible().catch(() => false)) {
      await joinDisabled.hover();
      await expect(page.getByText("Görüşmeye katılmak için önce ödeme tamamlanmalıdır.")).toHaveCount(0);
    }

    // Randevuyu katılım penceresine kaydır (`shiftAppointmentIntoJoinWindowDirectly` — gerçek
    // randevu, sahte olan yalnızca zamanlama, dosya başlığı ile AYNI ilke) ve yeniden yükle.
    shiftAppointmentIntoJoinWindowDirectly(paidAppointmentId, 60, 30);
    await page.reload();
    await upcomingTab.click();
    const cardAfterShift = page.getByText(PATIENT_PAID_NAME, { exact: true }).locator("xpath=ancestor::div[contains(@class,'shadow-sm')][1]");
    const joinActive = cardAfterShift.getByRole("link", { name: "Odaya Katıl" });
    await expect(joinActive).toBeVisible({ timeout: 15_000 });
    await expect(joinActive).not.toHaveAttribute("aria-disabled", "true");
  } finally {
    await close();
  }
});

// =============================================================================
// Senaryo 3 — regresyon: demo-pay uygulanmamış (hâlâ PENDING) bir booking "Tümü"nde görünür,
// "Gelecek Randevular"da GÖRÜNMEZ — [DPI] §3.2 kasıtlı davranışı DEĞİŞMEMİŞ.
// =============================================================================
test("senaryo 3 [regresyon]: ödenmemiş booking Tümü'nde görünür, Gelecek Randevular'da görünmez; sayaçlar buna göre ayrışır", async ({ browser }) => {
  test.setTimeout(60_000);

  const { from, to } = defaultSlotRangeISODates(14);
  const slotsRes = await getPublicDoctorSlotsRaw(doctorFixture.slug, from, to);
  const slot = (slotsRes.data ?? []).find((s) => s.available);
  if (!slot) throw new Error("qa-agent: regresyon testi için müsait slot bulunamadı.");

  const unpaidBooking = await createBookingRaw({
    doctorSlug: doctorFixture.slug,
    slots: [slot.startsAt],
    patientName: PATIENT_UNPAID_NAME,
    patientEmail: `qa-e2e-demo-pay-unpaid-${RUN_SUFFIX}@example.com`,
  });
  expect(unpaidBooking.status).toBe(201);
  expect(unpaidBooking.data!.paymentStatus).toBe("PENDING");

  const overviewRes = await getDoctorOverviewRaw(doctorUserToken);
  expect(overviewRes.status).toBe(200);
  const overview = overviewRes.data as unknown as { upcomingBookingTotal: number; allBookingTotal: number };
  // "all" +1 (appointments var, sayılır); "upcoming" DEĞİŞMEZ (PENDING_PAYMENT kasıtlı hariç).
  expect(overview.allBookingTotal).toBe(overviewBaseline.allBookingTotal + 2);
  expect(overview.upcomingBookingTotal).toBe(overviewBaseline.upcomingBookingTotal + 1);

  const { page, close } = await loginDoctorWithTwoFactor(browser);
  try {
    const allTab = page.getByRole("tab", { name: "Tümü" });
    await allTab.click();
    await expect(page.getByText(PATIENT_UNPAID_NAME, { exact: true })).toBeVisible({ timeout: 15_000 });

    const upcomingTab = page.getByRole("tab", { name: "Gelecek Randevular" });
    await upcomingTab.click();
    await expect(page.getByText(PATIENT_UNPAID_NAME, { exact: true })).toHaveCount(0);
    await expect(page.getByText(PATIENT_PAID_NAME, { exact: true })).toBeVisible({ timeout: 15_000 });
  } finally {
    await close();
  }
});

// =============================================================================
// Senaryo 4 — hasta tarafı: GERÇEK tarayıcı, booking sihirbazı baştan sona, adım 5'te "Demo
// Ödemeyi Tamamla (Test)" butonunun GÖRÜNÜRLÜĞÜ. BİLİNÇLİ OLARAK DOSYA SONUNA ALINDI: `serial`
// modda bir test FAILED olursa Playwright dosyanın KALANINI SKIP eder — senaryo 1-3'ün (backend +
// doktor konsolu) bir üstteki senaryodaki başarısızlıktan ETKİLENMEMESİ için EN SONA konuldu.
//
// GÜNCELLEME (2026-09-17, qa-agent): aşağıda anlatılan `frontend/Dockerfile`
// `ARG`/`ENV NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS` eksikliği `e0653aa fix(telehealth): demo odeme
// bayragini Dockerfile build-arg'ina bagla` ile GİDERİLDİ — bu test GÜNCEL docker dev yığınına
// (`docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d`) karşı hem
// gerçek tarayıcıda (manuel doğrulama) hem bu otomasyonla YEŞİLDİR. Artık "bilinen bug" DEĞİL —
// regresyona karşı bir regresyon testi olarak KALIR.
// =============================================================================
test("senaryo 4: booking sihirbazı adım 5'te demo ödeme butonu görünür", async ({ page }) => {
  test.setTimeout(90_000);

  await gotoAndWaitReady(page, `${SITE_ORIGIN}/doctors/${doctorFixture.slug}`, async () => {
    await expect(page.getByRole("heading", { name: "Müsaitlik ve Randevu" })).toBeVisible();
  });
  await page.waitForTimeout(500);

  await selectAnyAvailableSlot(page);
  await page.getByRole("button", { name: "Devam Et" }).first().click();

  const patientEmail = `qa-e2e-demo-pay-ui-${RUN_SUFFIX}@example.com`;
  await submitBookingIdentityStep(page, { patientName: `${PATIENT_PAID_NAME} UI`, patientEmail });
  await expect(page.getByText(/Rezervasyonunuz oluşturuldu \(BKG-/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Bu adımı atla" }).click();
  await expect(page.getByText("Ödenecek Tutar")).toBeVisible({ timeout: 15_000 });

  // Stripe yapılandırılmadığı için gerçek "Ödemeye Geç" akışı 503 döner; demo butonu BUNDAN
  // BAĞIMSIZ, `paymentsConfigured`'a bakmaksızın HER ZAMAN görünür olmalı (§1.5, bağlayıcı).
  const demoButton = page.getByRole("button", { name: "Demo Ödemeyi Tamamla (Test)" });
  await expect(demoButton).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Yalnızca geliştirme ortamı — gerçek tahsilat yapılmaz.")).toBeVisible();

  const responsePromise = page.waitForResponse((res) => res.url().includes("/demo-pay") && res.request().method() === "POST");
  await demoButton.click();
  const response = await responsePromise;
  expect(response.status(), "qa-agent: POST .../demo-pay 200 dönmeli").toBe(200);

  const body = (await response.json()) as { data: { id: string; paymentStatus: string } };
  expect(body.data.paymentStatus).toBe("PAID");

  // Başarı akışı — sihirbaz `?payment=success` dönüşüyle AYNI hedefe yönlendirir (§1.5).
  await page.waitForURL(new RegExp(`/patient/bookings/${body.data.id}\\?payment=success`), { timeout: 15_000 });
  await expect(page.getByText("Ödemeniz alındı, randevunuz onaylandı.")).toBeVisible({ timeout: 15_000 });
});
