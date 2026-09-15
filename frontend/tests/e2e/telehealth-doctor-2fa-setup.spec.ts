import { test, expect, type Browser, type Page } from "@playwright/test";
import { authenticator } from "otplib";
import {
  getCachedAdminSession,
  getSiteModules,
  patchSiteModule,
  getFixtureUserToken,
  setupAndEnableTwoFactorForSelf,
} from "./support/api";
import { resetFixtureUserToBaseline, adminGetUserByEmail } from "./support/admin-users-fixtures";
import {
  ensureTelehealthModuleWithDoctors,
  createAdminDoctorFixture,
  deleteAdminDoctorFixture,
  setDoctorAvailabilityRaw,
  linkDoctorUserRaw,
  type CreatedFixtureDoctor,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — `.claude/architect-scope-doctor-subdomain.md` §5.6.2 "2FA'sız doktor kalıcı olarak
 * kilitleniyor" blocker'ının SON adımı. architect → frontend-agent → security-agent tamamlandı;
 * bu dosya `doctor-portal-shell.tsx`'in yeni satır-içi `TwoFactorSetupPanel`ını (`components/site/
 * security/two-factor-setup-panel.tsx`) ve guard'ın (`doctor-portal-route-guard.tsx`) bu turda
 * GENİŞLETİLMEDİĞİNİ doğrular.
 *
 * `telehealth-doctor-session-guard.spec.ts`/`telehealth-portal-isolation.spec.ts` İLE AYNI desen:
 * kendi, İZOLE fixture doktoru (`createAdminDoctorFixture` + `setDoctorAvailabilityRaw`) +
 * `getFixtureUserToken` (TAZE `/auth/register` — `User.twoFactorEnabled` VARSAYILAN `false`, bu
 * yüzden `setupAndEnableTwoFactorForSelf` BİLEREK ÇAĞRILMAZ; madde A tam olarak "2FA'sı HİÇ
 * kurulmamış doktor" senaryosunu ister). Madde B (regresyon) AYRI bir fixture doktor için
 * `setupAndEnableTwoFactorForSelf`'i KULLANIR (`telehealth-portal-isolation.spec.ts` İLE AYNI
 * gerçek kendi-kendine-servis 2FA deseni, DB'ye secret YAZILMAZ).
 */
test.describe.configure({ mode: "serial" });

const FIXTURE_PASSWORD = "QaE2eDoctor2faSetup12345!";
const RUN_SUFFIX = Date.now().toString(36);
const NO_2FA_DOCTOR_EMAIL = `qa-e2e-th-doctor-2fa-setup-${RUN_SUFFIX}@example.com`;
const WITH_2FA_DOCTOR_EMAIL = `qa-e2e-th-doctor-2fa-baseline-${RUN_SUFFIX}@example.com`;

let adminToken: string;
let initialTelehealthEnabled: boolean;

let noTwoFactorDoctorFixture: CreatedFixtureDoctor;
let noTwoFactorDoctorUserId: string;

let withTwoFactorDoctorFixture: CreatedFixtureDoctor;
let withTwoFactorDoctorUserId: string;
let withTwoFactorDoctorSecret: string;

async function cleanupFixtures() {
  await resetFixtureUserToBaseline(adminToken, NO_2FA_DOCTOR_EMAIL);
  await resetFixtureUserToBaseline(adminToken, WITH_2FA_DOCTOR_EMAIL);
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  await cleanupFixtures();

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);

  // --- Doktor A: 2FA HİÇ kurulmamış (madde 1'in ana senaryosu) ---
  noTwoFactorDoctorFixture = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `QA E2E Doktor 2FA Kurulum ${RUN_SUFFIX}`,
    bio: "qa-agent — /doctor içine gömülü 2FA kurulum paneli e2e fixture doktoru.",
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
    noTwoFactorDoctorFixture.id,
    ([1, 2, 3, 4, 5, 6, 7] as const).map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }))
  );
  const noTwoFactorToken = await getFixtureUserToken(NO_2FA_DOCTOR_EMAIL, FIXTURE_PASSWORD, "QA E2E Doktor 2FA Kurulum");
  void noTwoFactorToken; // yalnızca kullanıcıyı YARATMAK için — bilerek 2FA'ya DOKUNULMAZ.
  const noTwoFactorUser = await adminGetUserByEmail(adminToken, NO_2FA_DOCTOR_EMAIL);
  if (!noTwoFactorUser) throw new Error("qa-agent: 2FA'sız doktor fixture kullanıcısı oluşturulamadı.");
  noTwoFactorDoctorUserId = noTwoFactorUser.id;
  expect(noTwoFactorUser.twoFactorEnabled).toBe(false);
  await linkDoctorUserRaw(adminToken, noTwoFactorDoctorFixture.id, noTwoFactorDoctorUserId);

  // --- Doktor B: 2FA ZATEN etkin (madde 2 — guard regresyonu) ---
  withTwoFactorDoctorFixture = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `QA E2E Doktor 2FA Baseline ${RUN_SUFFIX}`,
    bio: "qa-agent — 2FA zaten etkin doktor için /doctor'a sorunsuz erişim regresyonu.",
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
    withTwoFactorDoctorFixture.id,
    ([1, 2, 3, 4, 5, 6, 7] as const).map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }))
  );
  const withTwoFactorToken = await getFixtureUserToken(WITH_2FA_DOCTOR_EMAIL, FIXTURE_PASSWORD, "QA E2E Doktor 2FA Baseline");
  const withTwoFactorUser = await adminGetUserByEmail(adminToken, WITH_2FA_DOCTOR_EMAIL);
  if (!withTwoFactorUser) throw new Error("qa-agent: 2FA'lı doktor fixture kullanıcısı oluşturulamadı.");
  withTwoFactorDoctorUserId = withTwoFactorUser.id;
  await linkDoctorUserRaw(adminToken, withTwoFactorDoctorFixture.id, withTwoFactorDoctorUserId);
  const enabled = await setupAndEnableTwoFactorForSelf(withTwoFactorToken);
  withTwoFactorDoctorSecret = enabled.secret;
});

test.afterAll(async () => {
  await cleanupFixtures();
  if (noTwoFactorDoctorFixture) await deleteAdminDoctorFixture(adminToken, noTwoFactorDoctorFixture.id).catch(() => undefined);
  if (withTwoFactorDoctorFixture) await deleteAdminDoctorFixture(adminToken, withTwoFactorDoctorFixture.id).catch(() => undefined);
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

/** Düz `/login`'den (2FA challenge YOK — hesabın `twoFactorEnabled=false` olduğu varsayılır)
 * giriş yapar; `resolvePostLoginPath` doktor hesabını doğrudan `/doctor`'a düşürür. */
async function loginDoctorWithoutTwoFactor(browser: Browser, email: string, password: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100" });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL(/\/doctor$/, { timeout: 15_000 });
  return { page, close: async () => context.close() };
}

async function loginDoctorWithTwoFactor(
  browser: Browser,
  email: string,
  password: string,
  totpSecret: string
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100" });
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
  return { page, close: async () => context.close() };
}

/** İki `boundingBox()` dikdörtgeninin GERÇEKTEN kesişip kesişmediğini (üst üste binme) kontrol
 * eder — önceki turdaki "sol nav çakışması" testinin AYNI dikdörtgen-kesişim mantığı. */
function boxesOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  const aRight = a.x + a.width;
  const aBottom = a.y + a.height;
  const bRight = b.x + b.width;
  const bBottom = b.y + b.height;
  return a.x < bRight && aRight > b.x && a.y < bBottom && aBottom > b.y;
}

// =============================================================================
// Madde 1 — ana senaryo: 2FA'sı olmayan doktor /doctor'un İÇİNDE 2FA kurar, hiç ayrılmaz
// =============================================================================

test("madde 1: 2FA'sı olmayan doktor /doctor uyarı ekranında 2FA'yı satır içi kurar, SAYFA YENİLEMEDEN doktor konsoluna geçer", async ({ browser }) => {
  const { page, close } = await loginDoctorWithoutTwoFactor(browser, NO_2FA_DOCTOR_EMAIL, FIXTURE_PASSWORD);
  try {
    await expect(page).toHaveURL(/\/doctor$/);

    // --- Uyarı ekranı satır içi render oluyor (HARİCİ /hesabim/profil'e YÖNLENDİRME YOK) ---
    await expect(page.getByText("Bu işlem için iki adımlı doğrulamanın (2FA) etkin olması gerekir.")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/doctor$/); // URL hâlâ /doctor — /hesabim/profil'e GİTMEDİ.

    // --- QR kod GERÇEKTEN render ediliyor (data: URI kaynağı) ---
    const qrImage = page.getByRole("img", { name: "QR kod" });
    await expect(qrImage).toBeVisible({ timeout: 10_000 });
    const qrSrc = await qrImage.getAttribute("src");
    expect(qrSrc).toBeTruthy();
    expect(qrSrc!.startsWith("data:")).toBe(true);

    // --- Manuel secret metni GERÇEKTEN render ediliyor ---
    await expect(page.getByText("QR kodu tarayamıyorsanız manuel giriş kodu:", { exact: false })).toBeVisible();
    const manualSecretLocator = page.locator("span.font-mono").first();
    await expect(manualSecretLocator).toBeVisible();
    const manualSecret = (await manualSecretLocator.textContent())?.trim();
    expect(manualSecret).toBeTruthy();
    expect(manualSecret!.length).toBeGreaterThanOrEqual(16); // base32 TOTP secret — kısa/boş DEĞİL.

    // --- Görsel regresyon: QR/metin/input/buton bounding box'ları ÇAKIŞMIYOR ---
    const codeInput = page.getByLabel("Doğrulama Kodu");
    const submitButton = page.getByRole("button", { name: "Doğrula ve Etkinleştir" });
    await expect(codeInput).toBeVisible();
    await expect(submitButton).toBeVisible();
    const qrBox = await qrImage.boundingBox();
    const secretBox = await manualSecretLocator.boundingBox();
    const inputBox = await codeInput.boundingBox();
    const buttonBox = await submitButton.boundingBox();
    expect(qrBox).toBeTruthy();
    expect(secretBox).toBeTruthy();
    expect(inputBox).toBeTruthy();
    expect(buttonBox).toBeTruthy();
    const boxes = [qrBox!, secretBox!, inputBox!, buttonBox!];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(boxesOverlap(boxes[i], boxes[j]), `panel elemanları çakışmamalı (${i} vs ${j})`).toBe(false);
      }
    }

    // --- GERÇEK bir TOTP kodu üret (otplib, backend'in otpauthUrl'sindeki secret'tan) ve doğrula ---
    const code = authenticator.generate(manualSecret!);
    await codeInput.fill(code);

    // Navigasyon YOK marker'ı — "Portala Gir" tıklamasının GERÇEKTEN sayfa yenilemediğini (tam
    // navigasyon değil) kanıtlamak için tarayıcı belleğine bir işaret koyulur; tam sayfa
    // yenileme/navigasyon olsaydı bu değer sıfırlanırdı.
    await page.evaluate(() => {
      (window as unknown as { __qaNoReloadMarker?: boolean }).__qaNoReloadMarker = true;
    });

    await submitButton.click();

    // --- Yedek kodlar GÖRÜNÜYOR ---
    await expect(page.getByText("Bu kodlar bir daha gösterilmeyecek, güvenli bir yere kaydedin.")).toBeVisible({ timeout: 15_000 });
    const portalGirButton = page.getByRole("button", { name: "Portala Gir" });
    await expect(portalGirButton).toBeVisible();
    // Yedek kod grid'i — `BackupCodesList` (`hesabim/profil/page.tsx`) `font-mono` sınıfını
    // KAPSAYICI `div.grid.grid-cols-2`e koyar (her `span` yalnızca `text-foreground/80` taşır).
    const backupCodeSpans = page.locator("div.grid.grid-cols-2.font-mono span");
    const backupCodeCount = await backupCodeSpans.count();
    expect(backupCodeCount).toBeGreaterThan(0);
    const backupCodes = await backupCodeSpans.allTextContents();
    expect(new Set(backupCodes).size).toBe(backupCodes.length); // her kod BENZERSİZ.

    // Hâlâ /doctor'dayız — yedek kodlar HARİCİ bir sayfada DEĞİL, aynı satır-içi panelde.
    await expect(page).toHaveURL(/\/doctor$/);

    // --- "Portala Gir" — SAYFA YENİLEMEDEN doktor konsoluna geçiş ---
    // İKİ ayrı `<nav>` aynı 3 bağlantıyı içerir: `doctor-portal-shell.tsx`'in sekme şeridi VE
    // dashboard grid'inin "Portal Akışı" kenar çubuğundaki `doctor-portal-quick-links-card.tsx`
    // (`.claude/architect-scope-doctor-subdomain.md` §5.4'ün grid görevi notu) — `getByText`
    // strict-mode ÇAKIŞMASINI önlemek için `.first()` ile herhangi birinin göründüğü doğrulanır.
    await portalGirButton.click();
    await expect(page.getByText("Randevularım").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Kazançlarım").first()).toBeVisible();
    await expect(page.getByText("Profilim").first()).toBeVisible();
    // Uyarı ekranı ARTIK yok.
    await expect(page.getByText("Bu işlem için iki adımlı doğrulamanın (2FA) etkin olması gerekir.")).toHaveCount(0);
    await expect(page).toHaveURL(/\/doctor$/);

    // Marker HÂLÂ mevcut → `window` nesnesi hiç sıfırlanmadı → tam sayfa navigasyonu/yenileme
    // GERÇEKLEŞMEDİ (yalnızca React state/context güncellemesiyle geçiş yapıldı).
    const markerStillPresent = await page.evaluate(() => (window as unknown as { __qaNoReloadMarker?: boolean }).__qaNoReloadMarker === true);
    expect(markerStillPresent).toBe(true);
  } finally {
    await close();
  }
});

// =============================================================================
// Madde 2 — regresyon: 2FA'sı ZATEN etkin doktor uyarı ekranı GÖRMEDEN /doctor'a erişir
// =============================================================================

test("madde 2 (regresyon): 2FA'sı zaten etkin doktor normal girişte uyarı ekranı GÖRMEDEN doğrudan doktor konsoluna erişir", async ({ browser }) => {
  const { page, close } = await loginDoctorWithTwoFactor(browser, WITH_2FA_DOCTOR_EMAIL, FIXTURE_PASSWORD, withTwoFactorDoctorSecret);
  try {
    await expect(page).toHaveURL(/\/doctor$/);
    // İKİ `<nav>` (sekme şeridi + "Portal Akışı" kenar çubuğu) AYNI 3 bağlantıyı içerir — `madde 1`
    // İLE AYNI `.first()` deseni.
    await expect(page.getByText("Randevularım").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Kazançlarım").first()).toBeVisible();
    await expect(page.getByText("Profilim").first()).toBeVisible();
    await expect(page.getByText("Bu işlem için iki adımlı doğrulamanın (2FA) etkin olması gerekir.")).toHaveCount(0);
    await expect(page.getByRole("img", { name: "QR kod" })).toHaveCount(0);
  } finally {
    await close();
  }
});
