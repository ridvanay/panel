import { test, expect } from "@playwright/test";
import { authenticator } from "otplib";
import { getCachedAdminSession, getSiteModules, patchSiteModule, getFixtureUserToken, setupAndEnableTwoFactorForSelf } from "./support/api";
import { resetFixtureUserToBaseline, adminGetUserByEmail } from "./support/admin-users-fixtures";
import { ensureTelehealthModuleWithDoctors, createAdminDoctorFixture, deleteAdminDoctorFixture, setDoctorAvailabilityRaw, linkDoctorUserRaw, type CreatedFixtureDoctor } from "./support/telehealth-fixtures";

/**
 * qa-agent — `.claude/architect-scope-doctor-subdomain.md` §7.4 senaryo 13 (geriye dönük
 * uyumluluk): `NEXT_PUBLIC_DOCTOR_URL` TANIMSIZKEN ana domain'de `/doctor` ESKİSİ GİBİ çalışmalı.
 *
 * BİLEREK AYRI BİR DOSYA (§3.4 gerekçesi): `NEXT_PUBLIC_DOCTOR_URL` bir dev-sunucu BAŞLANGICINDA
 * inline edilen sabittir (`lib/env.ts::DOCTOR_SITE_URL`) — `playwright.config.ts`'in paylaşılan
 * `webServer`'ı (3100) bu değişkeni ZATEN dolu başlatır (§6.4 matrisi, ana suite'in KENDİSİ
 * subdomain modunu test etmek İÇİN). Bu dosya o sunucuyu KULLANAMAZ; `doctor-panel-session-
 * lifecycle.spec.ts`'in `E2E_SKIP_WEBSERVER` deseniyle AYNI felsefeyle KENDİ, NEXT_PUBLIC_DOCTOR_URL
 * OLMAYAN bir `next dev` sürecine karşı manuel çalıştırılır.
 *
 * ÇALIŞTIRMA:
 *   1) Backend zaten `saas_e2e`'ye karşı 4001'de ayakta olmalı (bkz. `playwright.config.ts` başlığı
 *      — bu dosya, ana suite'in webServer'ı tarafından BAŞLATILAN backend'i DEĞİL, aynı şekilde
 *      elle/CI'da başlatılmış backend'i kullanır; `E2E_API_URL` ile override edilebilir).
 *   2) qa-agent bulgusu (bu tur): frontend'i FARKLI bir HOST/PORT'ta (ör. bare `localhost:3103`)
 *      başlatmak backend'in CORS allow-list'inde (`.env.e2e`'deki `FRONTEND_URL=http://
 *      siteadi.localhost:3100`) OLMAYAN bir origin üretir — login "Sunucuya ulaşılamadı" ile
 *      SESSİZCE başarısız olur (CORS bloğu, ağ hatası GİBİ görünür). Doğru desen: `NEXT_PUBLIC_
 *      DOCTOR_URL` OLMADAN, backend'in ZATEN allow-list'lediği AYNI origin'de (`siteadi.localhost:3100`)
 *      AYRI bir `next dev` süreci çalıştırmak — bu, ana suite'in `webServer`'ıyla AYNI PORTU
 *      kullanır (Next.js bir proje dizini için tek dev sürecine izin verir), bu yüzden ana suite'i
 *      ÇALIŞTIRMADAN ÖNCE/SONRA, ikisini AYNI ANDA DEĞİL, SIRAYLA çalıştırın:
 *        cd frontend && npx cross-env NEXT_PUBLIC_API_URL=http://siteadi.localhost:4001/api/v1 \
 *          NEXT_PUBLIC_SITE_URL=http://siteadi.localhost:3100 INTERNAL_API_URL=http://localhost:4001/api/v1 \
 *          next dev -p 3100
 *   3) Testi bu sunucuya karşı, ana suite'in `webServer`'ını atlayarak çalıştır:
 *        cd frontend && E2E_SKIP_WEBSERVER=1 E2E_FRONTEND_URL=http://siteadi.localhost:3100 \
 *          npx playwright test tests/e2e/doctor-subdomain-backward-compat.spec.ts --project=chromium --no-deps
 *
 * `--no-deps` — `auth.setup.ts`'in `saas_e2e`'ye karşı admin login'i bu dosyanın İHTİYACI DEĞİLDİR
 * (kendi doktor fixture'ını/2FA login'ini KENDİSİ kurar, `doctor-panel-session-lifecycle.spec.ts`
 * İLE AYNI izolasyon gerekçesi).
 */
test.describe.configure({ mode: "serial" });

const FIXTURE_PASSWORD = "QaE2eBackwardCompat12345!";
const RUN_SUFFIX = Date.now().toString(36);
const DOCTOR_USER_EMAIL = `qa-e2e-doctor-backcompat-${RUN_SUFFIX}@example.com`;

let adminToken: string;
let initialTelehealthEnabled: boolean;
let doctorFixture: CreatedFixtureDoctor;
let doctorTotpSecret: string;

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  await resetFixtureUserToBaseline(adminToken, DOCTOR_USER_EMAIL);

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);

  doctorFixture = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `QA E2E Doktor BackCompat ${RUN_SUFFIX}`,
    bio: "qa-agent — NEXT_PUBLIC_DOCTOR_URL tanımsızken geriye dönük uyumluluk e2e fixture doktoru.",
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

  const doctorUserToken = await getFixtureUserToken(DOCTOR_USER_EMAIL, FIXTURE_PASSWORD, "QA E2E Doktor BackCompat");
  const doctorUser = await adminGetUserByEmail(adminToken, DOCTOR_USER_EMAIL);
  if (!doctorUser) throw new Error("qa-agent: doktor fixture kullanıcısı oluşturulamadı.");
  await linkDoctorUserRaw(adminToken, doctorFixture.id, doctorUser.id);
  const twoFactor = await setupAndEnableTwoFactorForSelf(doctorUserToken);
  doctorTotpSecret = twoFactor.secret;
});

test.afterAll(async () => {
  await resetFixtureUserToBaseline(adminToken, DOCTOR_USER_EMAIL);
  if (doctorFixture) await deleteAdminDoctorFixture(adminToken, doctorFixture.id).catch(() => undefined);
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

test("senaryo 13a: NEXT_PUBLIC_DOCTOR_URL tanımsızken /doctor ziyaretçisi SAME-ORIGIN /login'e yönlendirilir (cross-origin assign YOK)", async ({
  page,
  baseURL,
}) => {
  await page.goto("/doctor");
  await page.waitForURL(/\/login\?next=/, { timeout: 15_000 });
  // Aynı origin'de kalmış olmalı — `window.location.assign` (cross-origin) TETİKLENMEMİŞ demektir.
  expect(new URL(page.url()).origin).toBe(new URL(baseURL ?? page.url()).origin);
});

test("senaryo 13b: NEXT_PUBLIC_DOCTOR_URL tanımsızken doktor girişi SAME-ORIGIN /doctor'a düşer (LoginForm cross-origin assign YAPMAZ)", async ({
  page,
  baseURL,
}) => {
  await page.goto("/doctor");
  await page.waitForURL(/\/login\?next=/, { timeout: 15_000 });

  await page.getByLabel("E-posta").fill(DOCTOR_USER_EMAIL);
  await page.getByLabel("Şifre").fill(FIXTURE_PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();

  await expect(page.getByText("Kimlik doğrulama uygulamanızdaki 6 haneli kodu", { exact: false })).toBeVisible({ timeout: 15_000 });
  const code = authenticator.generate(doctorTotpSecret);
  await page.getByLabel("Doğrulama Kodu").fill(code);
  await page.getByRole("button", { name: "Doğrula" }).click();

  await page.waitForURL(/\/doctor$/, { timeout: 15_000 });
  expect(new URL(page.url()).origin).toBe(new URL(baseURL ?? page.url()).origin);
  await expect(page.getByRole("heading", { name: "Doktor Konsolu" })).toBeVisible({ timeout: 15_000 });

  // `DoctorPortalRouteGuard` — ana siteye (`/`) gezinilince SAME-ORIGIN `/doctor`'a geri iter
  // (`router.replace`, `window.location.assign` DEĞİL — subdomain modu kapalıyken §5.6 dalı hiç
  // tetiklenmez).
  await page.goto("/");
  await page.waitForURL(/\/doctor$/, { timeout: 15_000 });
  expect(new URL(page.url()).origin).toBe(new URL(baseURL ?? page.url()).origin);
});
