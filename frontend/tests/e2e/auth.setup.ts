import { test as setup, expect } from "@playwright/test";
import { ensureAdminSession } from "./support/api";

const ADMIN_STORAGE_STATE = "tests/e2e/.auth/admin.json";

// Paket AH — giriş sayfası Accept-Language'e göre dilleniyor ve Türkçe ziyaretçiye kapatıldı; alanlar dilden
// bağımsız seçicilerle (input type, submit) bulunur.

/**
 * Playwright "setup" projesi (bkz. `playwright.config.ts` — `chromium` projesi buna bağımlı).
 * Access token yalnızca bellekte tutulduğu için (`context/auth-context.tsx`) `storageState`'e
 * doğrudan token YAZAMAYIZ — gerçek login formunu doldurup httpOnly refresh cookie'sini
 * tarayıcı context'inde bırakıyoruz; sonraki testler bu cookie ile sayfa açılışında otomatik
 * oturum yeniler (`auth-context.tsx`'teki `authApi.refresh()` akışı).
 */
setup("admin olarak giriş yap ve oturumu kaydet", async ({ page }) => {
  const { email, password } = await ensureAdminSession();

  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();

  // qa-agent GÜNCELLEMESİ (2026-09-17, `/dashboard` emekliliği) — `ensureAdminSession()` ADMIN
  // rolüyle giriş yapar; `resolvePostLoginPath` artık panel rolleri (`ADMIN`/`MANAGER`/`EDITOR`)
  // için `/admin`'e (`/dashboard`'a DEĞİL) yönlendirir — `login-form.tsx::goToDestination` bu
  // hedefe DOĞRUDAN `router.replace` eder, `/dashboard` hiç ARA durak OLMAZ.
  await page.waitForURL(/\/admin/, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/admin/);

  await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});

export { ADMIN_STORAGE_STATE };
