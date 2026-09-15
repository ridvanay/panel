import { test, expect } from "@playwright/test";
import { API_BASE_URL, getCachedAdminSession, getFixtureUserToken, getAdminSettings, patchSiteSettings, getSiteModules, patchSiteModule } from "./support/api";
import {
  ensureTelehealthModuleWithDoctors,
  listAllAdminDoctors,
  createBookingRaw,
  getPublicDoctorSlotsRaw,
  defaultSlotRangeISODates,
  type FixtureDoctor,
} from "./support/telehealth-fixtures";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * qa-agent — "Admin Kontrollü Demo Ödeme Modülü" görev talimatı madde 3.
 * `.claude/security-review-demo-payment-toggle.md` (bağlayıcı, security-agent/architect onaylı)
 * Madde 2/4/5'in fiilen doğru davrandığını e2e/tarayıcı seviyesinde doğrular.
 *
 * **BİLİNÇLİ OLARAK standart e2e ortamına karşı çalışır** (`saas_e2e` + backend `localhost:4001`
 * + frontend `localhost:3100`) — AMA `playwright.config.ts`'in kendi `webServer`'ı KULLANILMAZ,
 * çünkü demo ödeme "açık/desteklenen" mutlu yolu backend'de `ENABLE_DEMO_PAYMENTS=true`
 * (`backend/.env.e2e`e qa-agent tarafından bu turda eklendi — GÜVENLİ, `NODE_ENV=development`
 * zaten orada, fail-closed boot koruması yalnızca `NODE_ENV=production` ile bu bayrağın birlikte
 * `true` olmasını engeller) VE frontend'de `NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS=true` build/dev-time
 * enjeksiyonu gerektirir — `playwright.config.ts`'in varsayılan `webServer` komutu bu bayrağı
 * TAŞIMAZ (bilerek, dokümantasyon-agent `.env.example` uyarısı gereği demo ödeme asla varsayılan
 * olarak açık DEĞİLDİR).
 *
 * ÇALIŞTIRMA — backend + frontend'in AYRICA, aşağıdaki env'lerle elle ayakta olması gerekir
 * (qa-agent final raporunda tam komutlar var):
 *   1) Backend: `cd backend && DOTENV_CONFIG_PATH=.env.e2e npx tsx -r dotenv/config src/server.ts`
 *      (`.env.e2e` artık `ENABLE_DEMO_PAYMENTS=true` taşıyor).
 *   2) Frontend: `cd frontend && npx cross-env NEXT_PUBLIC_API_URL=http://siteadi.localhost:4001/api/v1
 *      NEXT_PUBLIC_SITE_URL=http://siteadi.localhost:3100 NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS=true
 *      REVALIDATE_SECRET=e2e-revalidate-secret next dev -p 3100`.
 *   3) `cd frontend && E2E_SKIP_WEBSERVER=1 npx playwright test
 *      tests/e2e/telehealth-admin-demo-payment-toggle.spec.ts --project=chromium --no-deps`
 *      (`--no-deps` — `auth.setup.ts` gerekmez, bu dosya `getCachedAdminSession()`'ın KENDİ
 *      fallback'iyle, `saas_e2e`'ye ÖNCEDEN TOHUMLANMIŞ `qa-e2e-admin@example.com` ile GERÇEK bir
 *      login yapar).
 *
 * Booking, hasta LOGIN'i GEREKMEDEN, misafir magic-link erişimiyle (`?t=`) doğrulanır —
 * `/patient/bookings/{id}?t=...` sayfası oturum GEREKTİRMEZ (§9.7.7 madde 4) — bu, testin ikinci
 * bir hasta hesabı/login akışı kurmasına gerek KALMADAN doğrudan `BookingPaymentStep`i hedeflemesini
 * sağlar (test kapsamı SADECE toggle'ın etkisi, hasta-portalı login akışı DEĞİL — o zaten
 * `telehealth-showcase-and-resume-payment.spec.ts`'te ayrıca kapsanıyor).
 */
test.describe.configure({ mode: "serial" });

const RUN_SUFFIX = Date.now().toString(36);
const PATIENT_EMAIL = `qa-e2e-demo-toggle-${RUN_SUFFIX}@example.com`;
const PATIENT_PASSWORD = "QaE2eDemoToggle12345!";
const PATIENT_NAME = `QA Demo Toggle Hasta ${RUN_SUFFIX}`;

let adminToken: string;
let initialTelehealthEnabled: boolean;
let initialDemoPaymentsEnabled: boolean;
let doctorFixture: FixtureDoctor;
let bookingId: string;
let bookingAccessToken: string;

async function demoPayBookingRaw(id: string, accessToken: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = new URL(`${API_BASE_URL}/appointments/bookings/${id}/demo-pay`);
  url.searchParams.set("t", accessToken);
  const res = await fetch(url, { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(90_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);
  const doctors = await listAllAdminDoctors(adminToken);
  if (doctors.length === 0) throw new Error("qa-agent: telehealth-clinic doktoru bulunamadı.");
  doctorFixture = doctors[0]!;

  const settings = await getAdminSettings(adminToken);
  initialDemoPaymentsEnabled = Boolean(settings.demoPaymentsEnabled);
  // Bu turun ön koşulu — backend `.env.e2e`de `ENABLE_DEMO_PAYMENTS=true` OLMALI (qa-agent bu
  // turda ekledi); değilse `demoPaymentsSupported=false` kalır ve aşağıdaki testler ANLAMSIZLAŞIR.
  expect(settings.demoPaymentsSupported, "qa-agent: backend/.env.e2e ENABLE_DEMO_PAYMENTS=true taşımalı (bu turda eklendi).").toBe(true);
  // Testin kendi kontrollü başlangıç durumu — DB bayrağı AÇIK başlar (idempotent, önceki bir koşum
  // KAPALI bırakmış olabilir).
  if (!initialDemoPaymentsEnabled) {
    await patchSiteSettings(adminToken, { demoPaymentsEnabled: true });
  }

  const patientToken = await getFixtureUserToken(PATIENT_EMAIL, PATIENT_PASSWORD, PATIENT_NAME);
  const { from, to } = defaultSlotRangeISODates(21);
  const slotsRes = await getPublicDoctorSlotsRaw(doctorFixture.slug, from, to);
  const slot = (slotsRes.data ?? []).find((s) => s.available);
  if (!slot) throw new Error("qa-agent: demo ödeme toggle testi için müsait slot bulunamadı.");

  const created = await createBookingRaw(
    { doctorSlug: doctorFixture.slug, slots: [slot.startsAt], patientName: PATIENT_NAME, patientEmail: PATIENT_EMAIL },
    patientToken
  );
  expect(created.status).toBe(201);
  expect(created.data!.paymentStatus).toBe("PENDING");
  bookingId = created.data!.bookingId;
  bookingAccessToken = created.data!.accessToken;
});

test.afterAll(async () => {
  await patchSiteSettings(adminToken, { demoPaymentsEnabled: initialDemoPaymentsEnabled }).catch(() => undefined);
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

test("madde 3a: env açıkken admin switch'i aktif/tıklanabilir, DB varsayılanı AÇIK gösterir", async ({ browser }) => {
  const { page, close } = await createAuthenticatedPage(browser);
  try {
    await page.goto("/admin/settings");
    const toggle = page.getByRole("switch", { name: "Demo / Test Ödeme Modu" });
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    // env desteklemiyor uyarısı GÖRÜNMEMELİ (§4'teki `demoPaymentsSupported=false` dalı).
    await expect(page.getByText("Bu ortamda demo ödeme altyapısı yapılandırılmamış", { exact: false })).toHaveCount(0);
  } finally {
    await close();
  }
});

test("madde 3b: admin toggle'ı KAPATIR + kaydeder → ödeme sayfasında demo buton (yeniden yüklemede) GİZLENİR; 403 API regresyonu", async ({ browser }) => {
  test.setTimeout(45_000);
  const { page, close } = await createAuthenticatedPage(browser);
  try {
    await page.goto("/admin/settings");
    const toggle = page.getByRole("switch", { name: "Demo / Test Ödeme Modu" });
    await expect(toggle).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(page.getByLabel("Notifications alt+T").getByText("Ayarlar kaydedildi.")).toBeVisible({ timeout: 10_000 });
  } finally {
    await close();
  }

  // Sunucu taze okuma — hemen doğrula (cache'siz, Madde 2).
  const afterOff = await getAdminSettings(adminToken);
  expect(afterOff.demoPaymentsEnabled).toBe(false);

  const { page: bookingPage, close: closeBookingPage } = await (async () => {
    const context = await browser.newContext();
    const p = await context.newPage();
    return { page: p, close: async () => context.close() };
  })();
  try {
    await bookingPage.goto(`/patient/bookings/${bookingId}?t=${encodeURIComponent(bookingAccessToken)}`);
    await expect(bookingPage.getByText("Ödenecek Tutar")).toBeVisible({ timeout: 15_000 });
    await expect(bookingPage.getByRole("button", { name: "Demo Ödemeyi Tamamla (Test)" })).toHaveCount(0);
    // Taze (cache'siz) kontrol — sayfa YENİLENEREK tekrar doğrulanır.
    await bookingPage.reload();
    await expect(bookingPage.getByText("Ödenecek Tutar")).toBeVisible({ timeout: 15_000 });
    await expect(bookingPage.getByRole("button", { name: "Demo Ödemeyi Tamamla (Test)" })).toHaveCount(0);
  } finally {
    await closeBookingPage();
  }

  // Regresyon — DB kapalıyken (env AÇIK olduğu halde) doğrudan API çağrısı 403 DEMO_PAYMENTS_DISABLED
  // döner (§Madde 5). Not: env KAPALIYKEN DB `true` olsa bile hâlâ 404 dönen katman
  // backend-agent'ın KENDİ vitest testlerinde zaten kapsanıyor — burada SADECE env-açık + DB-kapalı
  // 403 senaryosu e2e/tarayıcı seviyesinde doğrulanır (görev talimatı).
  const directCall = await demoPayBookingRaw(bookingId, bookingAccessToken);
  expect(directCall.status, `qa-agent: DB kapalıyken demo-pay 403 dönmeli, gövde: ${JSON.stringify(directCall.body)}`).toBe(403);
  expect((directCall.body as { error?: { code?: string } }).error?.code).toBe("DEMO_PAYMENTS_DISABLED");
});

test("madde 3c: admin toggle'ı TEKRAR AÇAR + kaydeder → ödeme sayfasında demo buton (yeniden yüklemede) TEKRAR GÖRÜNÜR", async ({ browser }) => {
  test.setTimeout(45_000);
  const { page, close } = await createAuthenticatedPage(browser);
  try {
    await page.goto("/admin/settings");
    const toggle = page.getByRole("switch", { name: "Demo / Test Ödeme Modu" });
    await expect(toggle).toHaveAttribute("aria-checked", "false", { timeout: 15_000 });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(page.getByLabel("Notifications alt+T").getByText("Ayarlar kaydedildi.")).toBeVisible({ timeout: 10_000 });
  } finally {
    await close();
  }

  const afterOn = await getAdminSettings(adminToken);
  expect(afterOn.demoPaymentsEnabled).toBe(true);

  const context = await browser.newContext();
  const bookingPage = await context.newPage();
  try {
    await bookingPage.goto(`/patient/bookings/${bookingId}?t=${encodeURIComponent(bookingAccessToken)}`);
    await bookingPage.reload();
    const demoButton = bookingPage.getByRole("button", { name: "Demo Ödemeyi Tamamla (Test)" });
    await expect(demoButton).toBeVisible({ timeout: 15_000 });
  } finally {
    await context.close();
  }

  const directCall = await demoPayBookingRaw(bookingId, bookingAccessToken);
  expect(directCall.status, `qa-agent: DB tekrar açıkken demo-pay 200 dönmeli, gövde: ${JSON.stringify(directCall.body)}`).toBe(200);
  const paid = (directCall.body as { data?: { paymentStatus?: string } }).data;
  expect(paid?.paymentStatus).toBe("PAID");
});
