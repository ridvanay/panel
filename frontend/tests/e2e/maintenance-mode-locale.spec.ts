import { test, expect } from "@playwright/test";
import { getCachedAdminSession, setMaintenanceMode } from "./support/api";

/**
 * `.claude/architect-scope-i18n.md` §9 qa-agent madde 4 — EN YÜKSEK RİSKLİ E2E: bakım modu +
 * locale birlikte. `frontend/src/proxy.ts` zaten bir vitest birim testiyle (mocked `fetch`,
 * bkz. `tests/unit/proxy-maintenance-mode.test.ts`) doğrulanıyor — bu dosya AYNI davranışı
 * GERÇEK backend + gerçek tarayıcı ile doğrular (mock'ların gizleyebileceği "wiring" hatalarını
 * — yanlış alan adı, yanlış header, gerçek Retry-After değeri — yakalamak için).
 *
 * NOT: bu testler SİTE GENELİNİ etkiler (bakım modu tüm ziyaretçi rotalarını kapatır) — bu
 * yüzden `test.describe.serial` ve her testten sonra `afterEach`'te bakım modu KAPATILIR.
 */
test.describe.serial("Bakım modu + locale (§9 madde 4 — geçiş şartı)", () => {
  let token: string;

  test.beforeAll(async () => {
    const admin = await getCachedAdminSession();
    token = admin.accessToken;
  });

  test.afterEach(async () => {
    await setMaintenanceMode(token, false);
  });

  test("bakım modu KAPALIYKEN /en/... normal şekilde açılır (503 DÖNMEZ)", async ({ page }) => {
    await setMaintenanceMode(token, false);
    const response = await page.goto("/en");
    expect(response?.status()).toBe(200);
  });

  test("bakım modu AÇIKKEN /en/... 503 + Retry-After döner (locale mantığı bakımı BYPASS ETMEZ)", async ({
    page,
  }) => {
    await setMaintenanceMode(token, true, "QA E2E bakım mesajı.");

    const response = await page.goto("/en");
    expect(response?.status()).toBe(503);
    expect(response?.headers()["retry-after"]).toBe("3600");
    await expect(page.locator("body")).toContainText("QA E2E bakım mesajı.");
  });

  test("bakım modu AÇIKKEN prefix'siz TR rotası da 503 döner (varsayılan dil de kapsanır)", async ({ page }) => {
    await setMaintenanceMode(token, true, "QA E2E bakım mesajı.");
    const response = await page.goto("/");
    expect(response?.status()).toBe(503);
  });

  test("bakım modu AÇIKKEN /admin ETKİLENMEZ (yönetici kendini kilitleyemez)", async ({ page }) => {
    await setMaintenanceMode(token, true, "QA E2E bakım mesajı.");
    // `/admin` proxy matcher'ının negatif lookahead'iyle tamamen HARİÇ — bakım HTML'i DEĞİL,
    // normal admin auth-guard akışı (giriş yapılmamışsa /login'e client-side redirect) çalışır.
    const response = await page.goto("/admin");
    expect(response?.status()).not.toBe(503);
  });
});
