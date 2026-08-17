import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";
import { cleanupBlogPostsByPrefix, createBlogPost, type AdminBlogPost } from "./support/blog-fixtures";

/**
 * qa-agent — regresyon: "blog yazısı yayınla → public URL'de görüntüle" akışı, ÖZELLİKLE Türkçe
 * "ı" (noktasız i, U+0131) içeren başlıklarla. Bugün düzeltilen iki KRİTİK bug'ın regresyonudur:
 *
 * 1. SSR fetch'lerin backend'e ulaşamaması (Docker'da `NEXT_PUBLIC_API_URL=http://localhost:4000`
 *    container İÇİNDEN kullanılırken backend'e erişememesi — düzeltme: `SERVER_API_BASE_URL`
 *    (`INTERNAL_API_URL`), bkz. `frontend/src/lib/env.ts`). BU ORTAMDA (bkz. bu dosyanın
 *    sonundaki NOT) reprodüklenemez — bilgi amaçlı sadece.
 * 2. `backend/src/lib/slug.ts::slugify()` Türkçe "ı" karakterini "-" ile değiştiriyordu (ör.
 *    "Yazısı" → "yaz-s") — düzeltme: `.replace(/ı/g, "i")`. Backend'de zaten birim testi var
 *    (`backend/tests/unit/slug.test.ts`, BURADA TEKRAR YAZILMADI) — bu dosya aynı düzeltmeyi
 *    GERÇEK admin UI akışı + gerçek public sayfa render'ı üzerinden e2e seviyesinde doğrular.
 *
 * NOT — Bug 1'in bu e2e ortamında kapsanma durumu: `playwright.config.ts` `webServer`, frontend'i
 * DOĞRUDAN `next dev` ile (Docker DIŞI) başlatır ve `NEXT_PUBLIC_API_URL=http://localhost:4001/api/v1`
 * verir; `INTERNAL_API_URL` HİÇ set edilmez. `SERVER_API_BASE_URL` (`lib/env.ts`) `INTERNAL_API_URL`
 * yoksa `API_BASE_URL`'e (yani `NEXT_PUBLIC_API_URL`'e) düşer — bu ortamda `localhost:4001` zaten
 * GERÇEK backend'e işaret eder (aynı host, ayrı process; Docker container network izolasyonu YOK).
 * Yani bu testler SSR fetch'in backend'e ulaştığını ve public sayfanın gerçekten içerik döndürdüğünü
 * DOĞRULAR (bu, Bug 1'in DÜZELTİLMEMİŞ haliyle de burada YEŞİL geçerdi, çünkü kök neden — container
 * network izolasyonu — bu ortamda hiç yok) — Docker-spesifik `INTERNAL_API_URL` yönlendirmesinin
 * KENDİSİ bu suite ile DOĞRULANAMAZ. Bunun için devops-agent'ın Docker Compose ortamında ayrı bir
 * doğrulama (ör. `docker compose up` + `curl` veya CI'da Docker tabanlı bir e2e job'ı) gerekir.
 */
test.describe.configure({ retries: 1 });

const POST_PREFIX = "QaE2ePublic";

let page: Page;
let closeSession: () => Promise<void>;
let token: string;

async function cleanupAll() {
  await cleanupBlogPostsByPrefix(token, POST_PREFIX);
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(60_000);
  const session = await getCachedAdminSession();
  token = session.accessToken;
  await cleanupAll(); // idempotent zemin — önceki başarısız bir koşumdan kalmış olabilir
  ({ page, close: closeSession } = await createAuthenticatedPage(browser));
});

test.afterAll(async () => {
  await cleanupAll();
  if (closeSession) await closeSession();
});

// bkz. `admin-blog-tags.spec.ts` başlığı — retry güvenliği: sabit başlıklı fixture'lar her
// testten sonra (başarı/başarısız fark etmeksizin) süpürülmeli, aksi halde retry 409'a çarpar.
test.afterEach(async () => {
  await cleanupAll();
});

async function openEditPage(target: Page, post: AdminBlogPost) {
  await target.goto(`/admin/blog/${post.id}`);
  await expect(target.getByRole("button", { name: "Kaydet" })).toBeVisible({ timeout: 15_000 });
  // bkz. `admin-blog-tags.spec.ts` bulgusu — `getByLabel("Başlık")` bu sayfada kararsız,
  // kararlı `#title` DOM id'sine (`Field id="title"`) güveniliyor.
  await expect(target.locator("#title")).toHaveValue(post.title, { timeout: 30_000 });
}

test("yazı PUBLISHED oluşturulunca Türkçe 'ı' içeren başlığın slug'ı doğru üretilir ve /blog/{slug} + /tr/blog/{slug} gerçek içerik döndürür (404 DEĞİL)", async () => {
  const title = `${POST_PREFIX} Işıklı Kırık Yazı Testi`;
  const post = await createBlogPost(token, { title, status: "PUBLISHED" });

  // Bug 2 regresyonu — "ı" (U+0131) "-"ye DEĞİL "i"ye çevrilmeli (backend/src/lib/slug.ts).
  expect(post.slug).toBe("qae2epublic-isikli-kirik-yazi-testi");

  const response = await page.goto(`/blog/${post.slug}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByText("Sayfa bulunamadı", { exact: false })).toHaveCount(0);

  // `/tr/blog/{slug}` → proxy'nin prefix'siz kanonik URL'e 301 yönlendirmesi (bkz.
  // `routing-locale.spec.ts` "REGRESYON" testinin aynı deseni) — dolaylı olarak da doğrulanır.
  const trResponse = await page.goto(`/tr/blog/${post.slug}`);
  expect(new URL(page.url()).pathname).toBe(`/blog/${post.slug}`);
  expect(trResponse?.request().redirectedFrom()).not.toBeNull();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
});

test("admin UI'dan Durum: Yayında seçip Kaydet'e basılınca gerçek yayınlama akışı çalışır ve public URL'de görünür", async () => {
  // qa-agent bulgusu — bu test DRAFT→PUBLISHED geçişini AYNI slug üzerinde 404→200 olarak
  // doğruluyor; sabit bir slug kullanılırsa `proxy.ts`'in `revalidate: 60` fetch cache'i, ÖNCEKİ
  // bir koşumda (retry veya aynı dosyanın tekrar çalıştırılması) AYNI slug PUBLISHED edilmişse
  // "yayınlanmadan önce 404" beklentisini yanlışlıkla 200'e çeviriyor (kararsız/flaky —
  // dosyanın kendi test altyapısında bulundu, uygulama bug'ı DEĞİL). Düzeltme: her koşumda
  // TAZE, benzersiz bir slug üretecek küçük bir rastgele son ek — Türkçe "ı" dönüşümünün kendisi
  // yine de tam olarak (sabit kısım için) doğrulanıyor.
  const runSuffix = Math.random().toString(36).slice(2, 8);
  const title = `${POST_PREFIX} Işıklı Yayın UI Testi ${runSuffix}`;
  const post = await createBlogPost(token, { title, status: "DRAFT" });
  expect(post.slug).toBe(`qae2epublic-isikli-yayin-ui-testi-${runSuffix}`);

  // Yayınlanmadan ÖNCE public URL gerçekten 404 vermeli (aşağıdaki negatif testle aynı temel
  // davranış — burada ayrıca "yayınla → görünür hale gelir" geçişinin KENDİSİNİ de kanıtlıyoruz).
  const beforePublish = await page.goto(`/blog/${post.slug}`);
  expect(beforePublish?.status()).toBe(404);

  await openEditPage(page, post);

  const statusSelect = page.getByLabel("Durum", { exact: true });
  await expect(statusSelect).toBeVisible();
  await statusSelect.selectOption({ label: "Yayında" });

  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("Yazı kaydedildi.")).toBeVisible();

  const afterPublish = await page.goto(`/blog/${post.slug}`);
  expect(afterPublish?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
});

test("REGRESYON (korunması gereken doğru davranış) — DRAFT yazının public URL'i gerçekten 404 verir", async () => {
  // Yukarıdaki test ile AYNI gerekçe (kararlılık için benzersiz slug — bkz. o testteki not).
  const runSuffix = Math.random().toString(36).slice(2, 8);
  const title = `${POST_PREFIX} Işıklı Taslak Testi ${runSuffix}`;
  const post = await createBlogPost(token, { title, status: "DRAFT" });
  expect(post.slug).toBe(`qae2epublic-isikli-taslak-testi-${runSuffix}`);

  const response = await page.goto(`/blog/${post.slug}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Sayfa bulunamadı", { exact: false })).toBeVisible();
});
