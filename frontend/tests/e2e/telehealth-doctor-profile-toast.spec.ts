import { test, expect } from "@playwright/test";
import { authenticator } from "otplib";
import { getCachedAdminSession, getFixtureUserToken, getSiteModules, patchSiteModule, setupAndEnableTwoFactorForSelf } from "./support/api";
import { resetFixtureUserToBaseline, adminGetUserByEmail } from "./support/admin-users-fixtures";
import { ensureTelehealthModuleWithDoctors, createAdminDoctorFixture, deleteAdminDoctorFixture, linkDoctorUserRaw, type CreatedFixtureDoctor } from "./support/telehealth-fixtures";

/**
 * qa-agent — bug fix doğrulaması (backend-agent/frontend-agent, 2026-09-14):
 *   1) `DoctorPublicationSchema.doi` artık serbest biçimli metin kabul eder (`https://` şeması
 *      ZORUNLU DEĞİL, bkz. `backend/src/schemas/entities.ts`) — bu dosya GERÇEK bir tarayıcı
 *      oturumundan, serbest metin bir DOI ("1221321") ile kaydın `422` DEĞİL başarıyla geçtiğini
 *      doğrular.
 *   2) Başarı bildirimi artık sayfa üstünde sabit bir `Alert` DEĞİL, `sonner` ile sol-altta
 *      (`bottom-left`) 4sn'lik bir toast + manuel kapatma (X) butonu (`doctor-profile-panel.tsx`).
 *
 * Backend (`telehealth-identity.test.ts`) VE frontend (`doctor-profile-panel.test.tsx`) unit/
 * entegrasyon testleri BUNU ZATEN mock HTTP/jsdom seviyesinde kapsıyor — bu dosya AYNI kontratı
 * GERÇEK tarayıcı + GERÇEK HTTP + GERÇEK 2FA login zincirinden geçirir (`telehealth-doctor-
 * identity.spec.ts` madde (f)/(h) VE `telehealth-portal-isolation.spec.ts::
 * loginDoctorDirectlyWithTwoFactor` İLE AYNI, zaten kanıtlanmış desen — `/login` → e-posta/şifre →
 * TOTP kodu → `/doctor`). Kendi, İZOLE bir fixture doktoru kurar, paylaşımlı `telehealth-clinic`
 * demo verisine BAĞIMLI DEĞİLDİR.
 */
test.describe.configure({ mode: "serial" });

const FIXTURE_PASSWORD = "QaE2eDoctorProfileToast12345!";
const RUN_SUFFIX = Date.now().toString(36);
const DOCTOR_USER_EMAIL = `qa-e2e-th-profiletoast-doctor-${RUN_SUFFIX}@example.com`;

let adminToken: string;
let initialTelehealthEnabled: boolean;
let doctorFixture: CreatedFixtureDoctor;

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(60_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  await resetFixtureUserToBaseline(adminToken, DOCTOR_USER_EMAIL);

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);

  doctorFixture = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `QA E2E Profil Toast ${RUN_SUFFIX}`,
    bio: "qa-agent — profil toast e2e fixture doktoru.",
    languages: ["tr"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: 40000,
    currency: "TRY",
    isActive: true,
  });
});

test.afterAll(async () => {
  await deleteAdminDoctorFixture(adminToken, doctorFixture.id);
  await resetFixtureUserToBaseline(adminToken, DOCTOR_USER_EMAIL);
  if (!initialTelehealthEnabled) await patchSiteModule(adminToken, "telehealth", false);
});

test("doktor /doctor/profile'da serbest DOI ile yayın kaydeder; başarı toast'ı sol-altta çıkar, kapatma butonu taşır ve 4sn sonra DOM'dan kalkar", async ({
  page,
}) => {
  test.setTimeout(90_000);

  // ---- Fixture doktor hesabı → GERÇEK, kendi-kendine-servis 2FA (DB'ye doğrudan secret YAZILMAZ) ----
  const doctorUserToken = await getFixtureUserToken(DOCTOR_USER_EMAIL, FIXTURE_PASSWORD, "QA E2E Profil Toast Doktoru");
  const doctorUser = await adminGetUserByEmail(adminToken, DOCTOR_USER_EMAIL);
  if (!doctorUser) throw new Error("qa-agent: doktor fixture kullanıcısı oluşturulamadı.");
  await linkDoctorUserRaw(adminToken, doctorFixture.id, doctorUser.id);
  const { secret } = await setupAndEnableTwoFactorForSelf(doctorUserToken);

  // ---- GERÇEK tarayıcı login'i — e-posta/şifre + TOTP kodu (`otplib`, backend'in `lib/totp.ts`
  // sarmalayıcısının BEKLEDİĞİ AYNI RFC 6238 algoritması) ----
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(DOCTOR_USER_EMAIL);
  await page.getByLabel("Şifre").fill(FIXTURE_PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();

  await expect(page.getByText("İki adımlı doğrulama", { exact: false })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Authenticator Kodu").fill(authenticator.generate(secret));
  await page.getByRole("button", { name: "Doğrula" }).click();
  await page.waitForURL(/\/doctor$/, { timeout: 15_000 });

  await page.goto("/doctor/profile");
  await expect(page.getByRole("heading", { name: "Profilim" })).toBeVisible({ timeout: 15_000 });

  // ---- Bug fix 1: serbest biçimli DOI (https:// şemasız, düz sayı) artık 422 VERMEZ ----
  await page.getByRole("button", { name: "Yayın Ekle" }).click();
  // `{ exact: true }` — "Başlık" alt dizesi `DoctorAboutEditor`'ın (Tiptap) toolbar buton
  // etiketleriyle ("Başlık 2"/"Başlık 3", H2/H3) ÇAKIŞIR (qa-agent bulgusu, bu turda).
  await page.getByLabel("Başlık", { exact: true }).fill("QA E2E Test Makalesi");
  await page.getByLabel("Dergi/Kongre/Kitap Adı").fill("QA E2E Test Dergisi");
  await page.getByLabel("DOI (opsiyonel)").fill("1221321");

  await page.getByRole("button", { name: "Kaydet" }).click();

  // ---- Bug fix 2: eski sabit üst `Alert` YERİNE sol-alt (`data-x-position=left`/
  // `data-y-position=bottom`) bir `sonner` toast'ı, kapatma butonuyla birlikte ----
  const toast = page.locator('[data-sonner-toast][data-x-position="left"][data-y-position="bottom"]', {
    hasText: "Profiliniz güncellendi",
  });
  await expect(toast).toBeVisible({ timeout: 10_000 });
  await expect(toast.locator("[data-close-button]")).toBeVisible();
  // Eski davranışta bu istek şeması yüzünden `422` alır, sayfa üstünde sabit bir hata `Alert`i
  // kalırdı — artık NE hata NE de sabit üst banner var, yalnızca toast.
  await expect(page.getByText("Girdi doğrulama hatası.")).toHaveCount(0);

  // ---- 4sn `duration` + kısa kaldırma animasyonu sonrası toast DOM'dan TAMAMEN kalkar ----
  await expect(toast).toHaveCount(0, { timeout: 6_000 });
});
