import { test as setup, expect } from "@playwright/test";
import { ensureAdminSession } from "./support/api";

const ADMIN_STORAGE_STATE = "tests/e2e/.auth/admin.json";

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
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();

  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/dashboard/);

  await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});

export { ADMIN_STORAGE_STATE };
