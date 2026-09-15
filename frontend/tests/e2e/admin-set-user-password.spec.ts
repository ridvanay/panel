import { test, expect, type Page } from "@playwright/test";
import { API_BASE_URL } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * qa-agent — 4-parçalı kritik hata paketi (2026-09-15), madde 4 — YENİ `PATCH
 * /admin/users/{userId}/password` ucu + `/admin/users` "Şifre Değiştir" dialog'unun CANLI round-trip
 * doğrulaması. `admin-user-management.spec.ts::rowFor()` İLE AYNI satır bulma deseni.
 *
 * **BİLİNÇLİ OLARAK paylaşımlı bir demo hesabı hedefler** (`aylin.kara@deneme.com`, doktor,
 * `saas_dev`/docker ortamında GERÇEK VAR OLAN bir kullanıcı — `saas_e2e`de YOKTUR, bu yüzden bu
 * dosya standart e2e ortamına karşı ANLAMSIZDIR). `afterAll` şifreyi HER KOŞULDA (test başarılı/
 * başarısız fark etmez) orijinal `Demo12345!`ye GERİ YAZAR — bu paylaşımlı hesabın sonraki turlar
 * için tutarlı kalması ZORUNLUDUR (görev talimatı).
 *
 * ÇALIŞTIRMA — docker yığınına (siteadi.localhost:3000/4000, `saas_dev`) karşı:
 *   E2E_SKIP_WEBSERVER=1 E2E_API_URL=http://localhost:4000/api/v1
 *   E2E_FRONTEND_URL=http://siteadi.localhost:3000 npx playwright test
 *   tests/e2e/admin-set-user-password.spec.ts --project=chromium --no-deps
 * (`--no-deps` — `getCachedAdminSession()`'ın KENDİ fallback'i, `telehealth-admin-demo-payment-
 * toggle.spec.ts` İLE AYNI felsefe; `qa-e2e-admin@example.com` bu ortamda qa-agent tarafından
 * `ADMIN`e terfi ettirilmiş bir fixture'dır, bkz. final rapor.)
 */
test.describe.configure({ mode: "serial" });

const TARGET_EMAIL = "aylin.kara@deneme.com";
const ORIGINAL_PASSWORD = "Demo12345!";
const TEMP_PASSWORD = "QaE2eTempRoundTrip12345!";

let page: Page;
let closeSession: () => Promise<void>;

async function rowFor(target: Page, email: string) {
  await target.getByLabel("İsim veya e-posta ara").fill(email);
  const row = target.getByRole("row", { name: new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
  await expect(row).toBeVisible({ timeout: 15_000 });
  return row;
}

async function setPasswordViaUI(target: Page, email: string, newPassword: string) {
  await target.goto("/admin/users");
  const row = await rowFor(target, email);
  await row.getByRole("button", { name: "Şifre Değiştir" }).click();

  const dialog = target.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByLabel("Yeni Şifre").fill(newPassword);
  await dialog.getByLabel("Şifreyi Onayla").fill(newPassword);
  await dialog.getByRole("button", { name: "Şifreyi Değiştir" }).click();

  await expect(target.getByLabel("Notifications alt+T").getByText("Şifre güncellendi.")).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toBeHidden({ timeout: 5_000 });
}

async function loginStatus(email: string, password: string): Promise<number> {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.status;
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(60_000);
  ({ page, close: closeSession } = await createAuthenticatedPage(browser));
});

test.afterAll(async () => {
  // KRİTİK — paylaşımlı demo hesabı HER KOŞULDA orijinal şifreye geri döner (görev talimatı).
  try {
    await setPasswordViaUI(page, TARGET_EMAIL, ORIGINAL_PASSWORD);
  } finally {
    if (closeSession) await closeSession();
  }
});

test("madde 4: admin '/admin/users' üzerinden hedef kullanıcının şifresini manuel değiştirir (toast.success), eski şifre ARTIK ÇALIŞMAZ (401), yeni şifre ÇALIŞIR (200)", async () => {
  // Ön koşul — hedef hesap ORİJİNAL şifreyle giriş yapabiliyor olmalı (görev talimatındaki
  // varsayımın canlı doğrulaması, değişiklik başlamadan ÖNCE).
  expect(await loginStatus(TARGET_EMAIL, ORIGINAL_PASSWORD), "qa-agent: ön koşul — orijinal şifre ÇALIŞMALI.").toBe(200);

  await setPasswordViaUI(page, TARGET_EMAIL, TEMP_PASSWORD);

  // Backend `PATCH .../password` hedef kullanıcının TÜM refresh token'larını iptal eder — burada
  // `access token` login akışını, `refreshToken` iptalini DOLAYLI olarak (eski şifreyle giriş
  // denemesi zaten şifre uyuşmazlığından 401'e düşer) doğruluyoruz; asıl round-trip iddiası
  // "eski şifre ARTIK GEÇERSİZ, yeni şifre GEÇERLİ"dir.
  expect(await loginStatus(TARGET_EMAIL, ORIGINAL_PASSWORD), "qa-agent: ESKİ şifreyle login ARTIK ÇALIŞMAMALI.").toBe(401);
  expect(await loginStatus(TARGET_EMAIL, TEMP_PASSWORD), "qa-agent: YENİ şifreyle login ÇALIŞMALI.").toBe(200);
});
