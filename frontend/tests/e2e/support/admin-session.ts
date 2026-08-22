import type { Browser, Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./api";

/**
 * Backend refresh token'ları TEK KULLANIMLIK rotasyonla çalışır (bkz.
 * `backend/src/modules/auth/auth.service.ts` — `refreshTokens()`, eski token'ı `revoked: true`
 * yapar; reuse tespit edilirse KULLANICININ TÜM token'larını iptal eder — kasıtlı bir güvenlik
 * önlemi). `context/auth-context.tsx` HER tam sayfa yüklemesinde otomatik `refresh()` çağırır.
 *
 * Sonuçlar (qa-agent'ın bu suite'i yazarken gözlemlediği iki AYRI risk):
 * 1. Playwright'ın standart "storageState dosyasını HER teste/dosyaya yeniden yükle" deseni
 *    ÇALIŞMAZ — dosyadaki refresh cookie'si İLK kullanımda rotate olur, sonraki her YENİ
 *    context aynı (artık bayat) dosyayı okursa reuse-tespiti oturumu TAMAMEN iptal eder. Bu
 *    yüzden `auth.setup.ts`'in yazdığı `tests/e2e/.auth/admin.json` burada KULLANILMAZ —
 *    her dosya kendi GERÇEK UI login'ini yapar (bir kullanıcının tarayıcı açıp giriş yapması
 *    gibi — taze bir refresh-cookie zinciri başlatır).
 * 2. Tek bir tarayıcı context'ini ÇOK sayıda tam navigasyon için (birden fazla dosya/test
 *    boyunca) paylaşmak, `auth-context.tsx`'in mount-time `refresh()` çağrısı ile bir sayfa
 *    bileşeninin kendi ilk verisi 401 alırsa tetiklediği BAĞIMSIZ ikinci bir `refresh()`
 *    çağrısının (`lib/api/client.ts`) YARIŞA girme ihtimalini kümülatif olarak ARTIRIR — ağ
 *    izinde (trace) doğrulandı: TEK bir navigasyon bile bazen İKİ ayrı `POST /auth/refresh`
 *    üretiyor. Yeterince navigasyon birikince reuse-tespiti gerçek bir false-positive'e
 *    dönüşüp oturumu düşürebilir (bkz. qa-agent raporu — frontend-agent'a yönlendirildi).
 *
 * Azaltma (bu dosyanın amacı): context/login SADECE BİR DOSYA'nın testleri için, o dosyanın
 * `test.beforeAll`'ında BİR KEZ kurulur ve `test.afterAll`'da kapatılır — dosyalar arasında
 * PAYLAŞILMAZ, biriken navigasyon sayısı sınırlı kalır. Bu, kök nedeni GİDERMEZ (yalnızca
 * frontend-agent düzeltebilir), riski test tasarımında AZALTIR.
 */
export async function createAuthenticatedPage(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  return createAuthenticatedPageAs(browser, ADMIN_EMAIL, ADMIN_PASSWORD);
}

/**
 * `createAuthenticatedPage()`'in keyfi kimlik bilgileriyle genel hali (§10.20) — standart/gelişmiş
 * EDITOR ve ikinci bir ADMIN fixture kullanıcısı olarak GERÇEK UI login'i yapmak için
 * (`admin-page-editor-roles.spec.ts`). Yukarıdaki fonksiyonun başlığındaki İKİ risk (refresh-token
 * rotasyonu, biriken navigasyon) BURADA DA aynen geçerlidir — çağıran dosya AYNI "dosya başına bir
 * context, `beforeAll`/`afterAll`" disiplinini uygulamalıdır.
 */
export async function createAuthenticatedPageAs(
  browser: Browser,
  email: string,
  password: string
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3100" });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });

  return {
    page,
    close: async () => {
      await context.close();
    },
  };
}
