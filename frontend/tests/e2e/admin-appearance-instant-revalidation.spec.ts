import { test, expect, type Page } from "@playwright/test";
import { API_BASE_URL, getAdminAppearance, getCachedAdminSession, patchAppearance } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * qa-agent — bu turda backend'e eklenen `triggerGlobalRevalidation()` (bkz.
 * `backend/src/lib/revalidate.ts`, `PATCH /admin/appearance` başarılı yazmalarından SONRA
 * `{ paths: ["/"], type: "layout" }` ile `POST /api/revalidate`i tetikler) için e2e kapsamı.
 * `admin-appearance-theme-tokens.spec.ts`/`admin-appearance-studio.spec.ts`teki mevcut testler
 * public yansımayı `expect.poll(..., { timeout: 90_000 })` ile (`next: { revalidate: 60 }`
 * eventual-consistency toleransı) doğruluyordu — bu dosya BİLEREK farklı bir iddiada bulunur:
 * kayıttan SONRA public sitede TEK bir `page.reload()` yeterli olmalı (poll/60sn bekleme YOK).
 * Eğer bu test poll'suz geçiyorsa on-demand revalidation ÇALIŞIYOR demektir; ÖNCEDEN (bu turdan
 * önce) bu uç hiç revalidation tetiklemediğinden aynı test o zaman ~60sn'ye kadar STALE veri
 * görüp FAIL ederdi.
 *
 * NOT (auth): `admin-appearance-theme-tokens.spec.ts` başlığındaki AYNI gerekçeyle bu dosya kendi
 * `browser`/context'ini kurar.
 */
test.describe.configure({ timeout: 90_000, retries: 1 });

// Diğer appearance e2e dosyalarında (`admin-appearance-studio.spec.ts`teki "Zümrüt Kurumsal"
// `#065f46`, `admin-appearance-theme-tokens.spec.ts`teki `#0ea5e9`) KULLANILMAYAN, belirgin bir
// hex — tesadüfi eşleşme riskini ortadan kaldırır.
const INSTANT_TEST_PRIMARY_COLOR = "#ff2d78";

let page: Page;
let closeSession: () => Promise<void>;
let token: string;
let originalPrimaryColor: string;

test.beforeAll(async ({ browser }) => {
  ({ page, close: closeSession } = await createAuthenticatedPage(browser));
  const admin = await getCachedAdminSession();
  token = admin.accessToken;
  originalPrimaryColor = (await getAdminAppearance(token)).primaryColor as string;
  expect(originalPrimaryColor).not.toBe(INSTANT_TEST_PRIMARY_COLOR);
});

test.afterAll(async () => {
  await patchAppearance(token, { primaryColor: originalPrimaryColor });
  await closeSession();
});

test("panelde Birincil Renk değiştirip kaydettikten SONRA public site'a TEK page.reload() ile anlık yansır", async ({
  page: publicPage,
}) => {
  // 1) Public sitede önce ORİJİNAL rengi servis eden bir görüntüleme ile Next.js'in `next: {
  // revalidate: 60 }` veri önbelleğini (Data Cache, bkz. `lib/api/server-appearance.ts`) ISITIRIZ
  // — aksi halde "tek reload'da yeni renk görünüyor" iddiası, önbellek hiç doldurulmamış (ilk
  // istek zaten fresh render) olduğu için YANLIŞ POZİTİF olurdu.
  await publicPage.goto("/");
  const siteScope = publicPage.locator(".site-scope");
  await expect(siteScope).toBeVisible();
  const primaryBefore = await siteScope.evaluate((el) => getComputedStyle(el).getPropertyValue("--site-primary").trim());
  expect(primaryBefore).toBe(originalPrimaryColor);

  // 2) Panelde rengi değiştir + kaydet — gerçek `PATCH /admin/appearance` → backend
  // `triggerGlobalRevalidation()` → gerçek `POST /api/revalidate` (`type: "layout"`).
  await page.goto("/admin/appearance");
  await page.getByRole("tab", { name: "Stil / Renk" }).click();
  const hexInput = page.getByLabel("Birincil Renk — hex kod");
  await expect(hexInput).toBeVisible();
  await hexInput.fill(INSTANT_TEST_PRIMARY_COLOR);
  await page.getByRole("button", { name: "Bu bölümü kaydet" }).click();
  await expect(page.getByText("Değişiklikler kaydedildi.")).toBeVisible();

  // Sunucuda kalıcı olduğunu doğrula — kısa `poll` yalnızca DB yazma/okuma turu için, cache
  // eventual-consistency'si İÇİN DEĞİL (diğer appearance dosyalarındaki 90sn'lik poll'un AKSİNE).
  await expect.poll(async () => (await getAdminAppearance(token)).primaryColor, { timeout: 5_000 }).toBe(INSTANT_TEST_PRIMARY_COLOR);

  // 3) TEK bir `page.reload()` — `expect.poll`/60sn bekleme YOK. On-demand revalidation
  // ÇALIŞIYORSA bu tek yenileme yeterli olmalı (Next.js "How Revalidation Works" dokümanı:
  // "The next request to that content triggers a fresh render" — bkz.
  // `node_modules/next/dist/docs/01-app/02-guides/how-revalidation-works.md`).
  await publicPage.reload();
  await expect(siteScope).toBeVisible();
  const primaryAfter = await siteScope.evaluate((el) => getComputedStyle(el).getPropertyValue("--site-primary").trim());
  expect(primaryAfter).toBe(INSTANT_TEST_PRIMARY_COLOR);

  // Public API sözleşmesi de aynı değeri yansıtıyor mu — regresyon tripwire'ı (diğer appearance
  // dosyalarındaki AYNI desen, `admin-appearance-studio.spec.ts` "public GET /appearance..." testi).
  const publicApiRes = await fetch(`${API_BASE_URL}/appearance`);
  const publicApiData = (await publicApiRes.json()).data as Record<string, unknown>;
  expect(publicApiData.primaryColor).toBe(INSTANT_TEST_PRIMARY_COLOR);
});
