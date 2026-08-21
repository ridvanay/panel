import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession, createPage as createPageFixture, deletePagePermanently, patchPageBlocks } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";
import {
  createBlogPost,
  createBlogCategory,
  deleteBlogCategory,
  deleteBlogPostPermanently,
  type AdminBlogPost,
} from "./support/blog-fixtures";

/**
 * Faz 4 "Dinamik & CMS İçerikleri" — Son Blog Yazıları, İletişim Formu, Özel HTML / Kod.
 * `admin-page-builder-marketing.spec.ts`teki AYNI iki-katmanlı desen: (1) admin editöründe
 * kategori/menü kaydının GERÇEKTEN çalıştığını doğrulayan hafif bir UI testi, (2)
 * `patchPageBlocks` ile kurulup GERÇEK backend+Postgres'e karşı public URL'de render kontrolü.
 *
 * Özel HTML bloğu için buradaki testler AYRICA bir GÜVENLİK REGRESYON KANITI taşır — `<script>`
 * enjeksiyonunun GERÇEKTEN çalışmadığını (yalnızca DOM'da bulunmadığını DEĞİL, tarayıcıda
 * ÇALIŞTIRILMADIĞINI) `window` üzerinde bir işaretçi kontrolüyle doğrular.
 */
test.describe.configure({ retries: 1 });

const PAGE_TITLE_PREFIX = "QaE2eDynamicPage";
const FRONTEND_URL = process.env.E2E_FRONTEND_URL ?? "http://localhost:3100";

let page: Page;
let closeSession: () => Promise<void>;
let token: string;

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(60_000);
  const session = await getCachedAdminSession();
  token = session.accessToken;
  ({ page, close: closeSession } = await createAuthenticatedPage(browser));
});

test.afterAll(async () => {
  if (closeSession) await closeSession();
});

async function createHostPage(prefix: string, status: "PUBLISHED" | "DRAFT" = "DRAFT") {
  const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 46_656).toString(36)}`;
  const slug = `qa-dyn-${prefix}-${unique}`;
  const created = await createPageFixture(token, {
    title: `${PAGE_TITLE_PREFIX} ${prefix} ${unique}`,
    slug,
    html: "<p>başlangıç fixture içeriği</p>",
    status,
  });
  return { pageId: created.id as string, slug: created.slug as string };
}

async function openEditorAndRemoveDefaultBlock(pageId: string) {
  await page.goto(`/admin/pages/${pageId}`);
  await expect(page.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500); // bkz. `admin-page-builder-gallery.spec.ts` başlığındaki AYNI güvenlik payı notu
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(2);
  await page.locator('button[aria-label="Konteyneri sil"]').first().click();
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(0);
}

test.describe("Dinamik & CMS blokları — admin editörü (kategori/menü kaydı)", () => {
  test("Son Blog Yazıları, İletişim Formu ve Özel HTML 'Dinamik & CMS' sekmesinden eklenir ve varsayılan içerikle render olur", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("category-wiring");
    try {
      await openEditorAndRemoveDefaultBlock(pageId);
      await page.getByRole("button", { name: "Tek Sütun" }).click();
      await page.getByRole("button", { name: "Konteynere blok ekle" }).click();
      await page.getByRole("tab", { name: "Dinamik & CMS" }).click();

      await page.getByRole("menuitem", { name: "Son Blog Yazıları", exact: true }).click();
      // `.last()` — sayfanın KENDİ başlık alanı ("Başlık", sayfanın üstünde) de AYNI erişilebilir
      // adı taşıyor; blok editörünün "Başlık" alanı DOM'da SONRA gelir.
      await expect(page.getByRole("textbox", { name: "Başlık" }).last()).toHaveValue("Son Yazılar");
      await expect(page.getByRole("spinbutton", { name: "Yazı sayısı" })).toHaveValue("3");

      await page.getByRole("button", { name: "Konteynere daha fazla blok ekle" }).click();
      await page.getByRole("tab", { name: "Dinamik & CMS" }).click();
      await page.getByRole("menuitem", { name: "İletişim Formu", exact: true }).click();
      // `.last()` — sol kenar çubuğunda AYNI erişilebilir adla ("İletişim") bir gezinme
      // bağlantısı zaten var; blok editörünün bilgi kutusundaki bağlantı DOM'da SONRA gelir.
      await expect(page.getByRole("link", { name: "İletişim" }).last()).toBeVisible();
      // `.last()` — sayfanın KENDİ "Hukuki belge" anahtarı da bir `switch`; blok editörününki
      // DOM'da SONRA gelir.
      await expect(page.getByRole("switch").last()).toBeChecked();

      await page.getByRole("button", { name: "Konteynere daha fazla blok ekle" }).click();
      await page.getByRole("tab", { name: "Dinamik & CMS" }).click();
      await page.getByRole("menuitem", { name: "Özel HTML / Kod", exact: true }).click();
      await expect(page.getByText("20000 karakter kaldı.")).toBeVisible();

      await page.getByRole("button", { name: "Kaydet", exact: true }).click();
      await expect(page.getByText("Sayfa kaydedildi.").last()).toBeVisible({ timeout: 10_000 });
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});

test.describe("Dinamik & CMS blokları — public site render (gerçek public URL, admin DIŞINDA)", () => {
  test("Son Blog Yazıları — kategori filtresi + yeniden-eskiye sıralama + adet sınırı birlikte doğru çalışır", async () => {
    // `revalidate: 60` önbellek penceresini bekleyen `toPass` döngüsü nedeniyle standart 30sn
    // varsayılanı (bkz. `playwright.config.ts`) yetersiz kalabilir.
    test.setTimeout(150_000);
    const unique = Date.now();
    const category = await createBlogCategory(token, `QaDynCat${unique}`);
    const posts: AdminBlogPost[] = [];
    try {
      // Sırayla oluşturulur — `publishedAt` doğal olarak artan, "en yeni" = SON oluşturulan.
      posts.push(await createBlogPost(token, { title: `QaDynOutside ${unique}` })); // kategori DIŞI — filtreye takılıp GÖRÜNMEMELİ
      posts.push(await createBlogPost(token, { title: `QaDynOlder ${unique}`, categoryId: category.id }));
      posts.push(await createBlogPost(token, { title: `QaDynNewest ${unique}`, categoryId: category.id }));

      const { pageId, slug } = await createHostPage("latest-posts", "PUBLISHED");
      try {
        await patchPageBlocks(token, pageId, [
          { id: "qa-latest-posts", type: "latest-posts", data: { limit: 1, categoryId: category.id } },
        ]);

        const publicContext = await page.context().browser()!.newContext();
        const publicPage = await publicContext.newPage();
        try {
          await publicPage.goto(`${FRONTEND_URL}/${slug}`);
          // `fetchBlogPostsServer` `next: { revalidate: 60 }` ile önbelleklenir (bkz.
          // `lib/api/server-blog.ts`) — bu turda YENİ oluşturulan yazılar Next.js'in "stale-
          // while-revalidate" penceresi kapanana KADAR görünmeyebilir. `toPass` ile ~90 sn
          // boyunca periyodik `reload` DENENIR (gerçek prod davranışı, flake DEĞİL).
          await expect(async () => {
            await publicPage.reload();
            await expect(publicPage.getByRole("heading", { name: `QaDynNewest ${unique}` })).toBeVisible({ timeout: 5_000 });
          }).toPass({ timeout: 90_000, intervals: [5_000, 10_000] });
          // limit=1 → yalnızca kategori İÇİNDEKİ EN YENİ yazı (`QaDynNewest`) görünür.
          await expect(publicPage.getByRole("heading", { name: `QaDynOlder ${unique}` })).toHaveCount(0);
          await expect(publicPage.getByRole("heading", { name: `QaDynOutside ${unique}` })).toHaveCount(0);
        } finally {
          await publicContext.close();
        }
      } finally {
        await deletePagePermanently(token, pageId);
      }
    } finally {
      for (const post of posts) await deleteBlogPostPermanently(token, post.id);
      await deleteBlogCategory(token, category.id);
    }
  });

  test("İletişim Formu — site geneli TEK formu (başlık + sistem alanları + gönder butonu) gömer", async () => {
    const { pageId, slug } = await createHostPage("contact-form", "PUBLISHED");
    try {
      await patchPageBlocks(token, pageId, [{ id: "qa-contact-form", type: "contact-form", data: { showTitle: true } }]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        // Seed'deki singleton form: title="İletişim", sistem alanları name/email/message.
        await expect(publicPage.getByRole("heading", { name: "İletişim" })).toBeVisible({ timeout: 15_000 });
        await expect(publicPage.getByLabel("Ad Soyad")).toBeVisible();
        await expect(publicPage.getByLabel("E-posta")).toBeVisible();
        await expect(publicPage.getByLabel("Mesajınız")).toBeVisible();
        await expect(publicPage.getByRole("button", { name: "Gönder" })).toBeVisible();
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("Özel HTML — GÜVENLİK: <script> enjeksiyonu ÇALIŞMAZ (yalnızca DOM'da yok değil, tarayıcıda hiç ÇALIŞMAZ), güvenli iframe render olur", async () => {
    const { pageId, slug } = await createHostPage("custom-html-xss", "PUBLISHED");
    try {
      await patchPageBlocks(token, pageId, [
        {
          id: "qa-custom-html",
          type: "custom-html",
          data: {
            html:
              '<p id="qa-safe-marker">güvenli içerik</p>' +
              '<script>window.__qaXssMarker = true;<\/script>' +
              '<iframe src="https://example.com/qa-e2e-embed" title="QA embed"></iframe>',
          },
        },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        await expect(publicPage.locator("#qa-safe-marker")).toBeVisible({ timeout: 15_000 });

        // GÜVENLİK KANITI — script HİÇ ÇALIŞMADI (backend sanitizer'ı `<script>` etiketini
        // baştan attığı için `window.__qaXssMarker` ASLA tanımlanmaz).
        const marker = await publicPage.evaluate(() => (window as unknown as Record<string, unknown>).__qaXssMarker);
        expect(marker).toBeUndefined();
        await expect(publicPage.locator("script", { hasText: "__qaXssMarker" })).toHaveCount(0);

        // Meşru iframe (harici widget/harita) GEÇER — `sandbox` zorla eklenir (bkz. backend).
        const iframe = publicPage.locator('iframe[src="https://example.com/qa-e2e-embed"]');
        await expect(iframe).toHaveCount(1);
        await expect(iframe).toHaveAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms");
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});
