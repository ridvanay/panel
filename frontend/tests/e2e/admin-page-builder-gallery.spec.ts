import { test, expect, type Page } from "@playwright/test";
import {
  getCachedAdminSession,
  createPage as createPageFixture,
  deletePagePermanently,
  uploadTestMedia,
  deleteTestMedia,
  setTestMediaAltText,
  patchPageBlocks,
} from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * Galeri bloğu — eski "tek-görsel taklidi" halinden gerçek çoklu-görsel, sürükle-sıralanabilir,
 * 3 stil varyantlı (Grid/Carousel/Masonry) bir WordPress-tarzı galeriye dönüştürüldü (bkz.
 * `.claude/design-notes-page-builder-gallery.md`, `lib/page-builder/types.ts::GalleryBlock`).
 * Bu dosya frontend-agent'ın component-seviyesindeki değişikliklerinin (`gallery-block.tsx` admin
 * editörü + site render'ı) GERÇEK backend + Postgres'e (`saas_e2e`) karşı, gerçek tarayıcıda uçtan
 * uca çalıştığını doğrular — `TEST_COVERAGE.md`'deki önceki "Kapsam dışı bırakılan — Öncelik 3
 * (galeri bloğu e2e)" notunu bu turda kapatır.
 *
 * 30 görsel limiti KASITLI OLARAK burada test EDİLMEDİ — 30 gerçek dosya yüklemek/seçmek bu
 * suite'i önemli ölçüde yavaşlatır/kırılganlaştırırdı. Bunun yerine `frontend/tests/unit/
 * gallery-block-editor-limit.test.tsx`'te `GalleryBlockEditor`'a doğrudan 30 öğelik bir
 * `images` state'i verilerek (component-seviyesinde, gerçek dosya yükleme YOK) "Görsel Ekle"
 * butonunun disabled olduğu ve `MediaPicker`'ın `maxSelection`'ının doğru hesaplandığı doğrulanır.
 */
test.describe.configure({ retries: 1 });

const PAGE_TITLE_PREFIX = "QaE2eGalleryPage";
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

/**
 * Boş bir sayfa oluşturur — fixture'ın varsayılan tek Metin bloğu admin editör testleri içinde
 * silinir; public-render testleri `status: "PUBLISHED"` ile çağırır (public URL için ZORUNLU,
 * bkz. `blog-publish-public-url.spec.ts` "REGRESYON — DRAFT yazının public URL'i 404 verir").
 *
 * BUG BULGUSU (backend-agent'a yönlendirilecek, qa-agent DÜZELTMEDİ, bkz. dosya sonundaki not) —
 * `backend/src/modules/pages/pages.routes.ts` (`POST /admin/pages`, `slug: slug ? slugify(slug)
 * : slugify(title)`) İSTEMCİNİN AÇIKÇA GÖNDERDİĞİ, zaten geçerli/URL-güvenli bir `slug`'ı BİLE
 * `slugify()`'dan geçirir — bu fonksiyon (`backend/src/lib/slug.ts` satır 14) `.slice(0, 48)` ile
 * SESSİZCE 48 karaktere KIRPAR. Sonuç: 48 karakterden uzun bir slug ile sayfa oluşturulunca,
 * DÖNEN `Page.slug` istemcinin GÖNDERDİĞİNDEN FARKLI (kırpılmış) olur — `GET /pages/{orijinal-
 * istenen-slug}` 404 döner, yalnızca kırpılmış hâli çalışır. HİÇBİR hata/uyarı YOK (422 DEĞİL,
 * sessiz veri değişikliği). qa-agent bunu bu galeri testleri hazırlanırken kendi 49+ karakterlik
 * fixture slug'larıyla YANLIŞLIKLA tetikledi (bkz. aşağıdaki `createHostPage`'in `created.slug`'ı
 * — kendi ÜRETTİĞİ `slug` DEĞİL — döndürmesinin nedeni budur, kendi testini bu davranışa karşı
 * SAĞLAM hale getirir). Bu galeri özelliğine ÖZGÜ değil, TÜM `Page`/muhtemelen `slugify()`'ı
 * kullanan diğer içerik tiplerini (blog, portföy, ürün) etkileyen GENEL bir davranış — kısa
 * vadede iki olası düzeltme: (a) istemci `slug` GÖNDERDİYSE `slugify()` yeniden UYGULANMASIN
 * (yalnızca `title`'dan TÜRETİLİYORSA uygulanmalı), (b) 48 karakteri aşan bir `slug` 422 ile
 * REDDEDİLSİN (sessiz kırpma YERİNE). Ayrıca aynı 48-karakterlik kırpılmış ÖNEK'e sahip iki
 * FARKLI uzun slug, `slugWithSuffix` YOLU kullanılmıyorsa aynı DEĞERE kırpılıp `409 CONFLICT`'e
 * (veya daha kötüsü sessiz bir çakışmaya) yol açabilir — kullanıcıya NEDEN anlaşılmaz kalır.
 */
async function createHostPage(prefix: string, status: "PUBLISHED" | "DRAFT" = "DRAFT") {
  // Kısa/kompakt üretim (Date.now() taban-36 + kısa rastgele son ek) — yukarıdaki bug'ı bu testler
  // için PRATİKTE devre dışı bırakır (48 karakter sınırının epey altında kalır), `created.slug`'ın
  // yine de kaynak-doğruluk (`slug` DEĞİL) olarak kullanılması ise SAVUNMA DERİNLİĞİ sağlar.
  const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 46_656).toString(36)}`;
  const slug = `qa-gal-${prefix}-${unique}`;
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
  await page.waitForTimeout(500); // bkz. `admin-page-builder-columns.spec.ts` başlığındaki AYNI güvenlik payı notu
  // Fixture'ın çıplak kök `text` bloğu ("b1") artık editör YÜKLENİRKEN otomatik olarak kendi
  // tek-sütunlu konteynerine sarılıyor (bkz. `containers.ts::wrapBareRootBlocks`) — bu yüzden 2
  // sürükle tutamacı (Konteyner + Metin) bekleniyor; konteyneri (içeriğiyle BİRLİKTE) silmek
  // temiz/boş bir sayfa bırakır.
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(2);
  // DİKKAT: `getByRole("button", { name: "Konteyneri sil" })` (substring/varsayılan) KULLANILMAZ
  // — `admin-page-builder-containers.spec.ts`teki AYNI not — `ContainerCard`'ın seçim div'i de
  // `role="button"` taşır ve aria adı olmadığı için TÜM iç metni/aria-label'ları (bu düğme dahil)
  // birleştirip ad-içerikten hesaplıyor; `.first()` o zaman İÇ düğme yerine DIŞ seçim div'ini
  // yakalar (tıklama hiçbir şeyi SİLMEZ, yalnızca seçer) — `[aria-label="..."]` öz-nitelik
  // seçicisine geçilir.
  await page.locator('button[aria-label="Konteyneri sil"]').first().click();
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(0);
}

/**
 * qa-agent GÜNCELLEMESİ — page-builder UI revizyonu içerik bloklarının doğrudan sayfa köküne
 * eklenmesini KALDIRDI (bkz. `block-list.tsx`/`builder-canvas.tsx`): artık kökte yalnızca "Düzen"
 * (Layout Picker) var, eski kök-seviyesi "+ Galeri" düğmesi ARTIK YOK. Galeri bloğu, diğer tüm
 * içerik blokları gibi ÖNCE bir konteynere (burada "Tek Sütun") ihtiyaç duyar, SONRA o konteynerin
 * kendi in-container ekleyicisi ("Konteynere blok ekle" → "Galeri" menü öğesi) üzerinden eklenir —
 * bkz. `admin-page-builder-containers.spec.ts` senaryo 5'teki AYNI desen.
 */
async function addGalleryBlock() {
  await page.getByRole("button", { name: "Tek Sütun" }).click();
  await page.getByRole("button", { name: "Konteynere blok ekle" }).click();
  // "Galeri" "Medya & İnteraktif" kategorisinde, popover varsayılan olarak "Temel Elemanlar"
  // sekmesini gösterir (bkz. `add-content-menu.tsx`) — önce kategori sekmesine geçilir.
  await page.getByRole("tab", { name: "Medya & İnteraktif" }).click();
  await page.getByRole("menuitem", { name: "Galeri", exact: true }).click();
  await expect(page.getByText("Henüz görsel eklenmedi")).toBeVisible();
}

async function saveAndExpectSuccess() {
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Sayfa kaydedildi.").last()).toBeVisible({ timeout: 10_000 });
}

function altInput(index: number) {
  return page.getByRole("textbox", { name: `Görsel ${index + 1} alt metni` });
}

test.describe("Galeri bloğu — admin editörü", () => {
  test("boş durum → 'Görsel Ekle' → MediaPicker çoklu seçim → birden fazla görsel thumbnail grid'inde görünür", async () => {
    test.setTimeout(60_000);
    const media1 = await uploadTestMedia(token, `qa-gallery-multi-a-${Date.now()}.png`);
    const media2 = await uploadTestMedia(token, `qa-gallery-multi-b-${Date.now()}.png`);
    const { pageId } = await createHostPage("multi-add");

    try {
      await openEditorAndRemoveDefaultBlock(pageId);
      await addGalleryBlock();

      // EmptyState'in KENDİ "Görsel Ekle" butonu (henüz thumbnail toolbar'ı YOK).
      await page.getByRole("button", { name: "Görsel Ekle" }).click();

      // MediaPicker çoklu seçim modunda açılır (bkz. `media-picker.tsx` §10.15.3).
      await expect(page.getByRole("heading", { name: "Görsel Seç" })).toBeVisible();
      await expect(page.getByText(/Kütüphaneden birden çok görsel seçin/)).toBeVisible();

      await page.getByRole("button", { name: `${media1.filename} seç` }).click();
      await page.getByRole("button", { name: `${media2.filename} seç` }).click();
      await page.getByRole("button", { name: "Seç (2)" }).click();

      // Modal kapandı, thumbnail grid'inde İKİ görsel var.
      await expect(page.getByRole("heading", { name: "Görsel Seç" })).toHaveCount(0);
      await expect(page.locator('button[aria-label^="Sürükle: Görsel "]')).toHaveCount(2);
      await expect(altInput(0)).toBeVisible();
      await expect(altInput(1)).toBeVisible();
      await expect(page.getByText("2 / 30")).toBeVisible();

      await saveAndExpectSuccess();
    } finally {
      await deletePagePermanently(token, pageId);
      await deleteTestMedia(token, media1.id);
      await deleteTestMedia(token, media2.id);
    }
  });

  test("klavye ile sürükle-sıralama (dnd-kit KeyboardSensor) — sıra değişir ve kaydedilip kalıcı olur", async () => {
    test.setTimeout(60_000);
    const unique = Date.now();
    const mediaA = await uploadTestMedia(token, `qa-gallery-order-a-${unique}.png`);
    const mediaB = await uploadTestMedia(token, `qa-gallery-order-b-${unique}.png`);
    const mediaC = await uploadTestMedia(token, `qa-gallery-order-c-${unique}.png`);
    await setTestMediaAltText(token, mediaA.id, "QA Gallery Alt A");
    await setTestMediaAltText(token, mediaB.id, "QA Gallery Alt B");
    await setTestMediaAltText(token, mediaC.id, "QA Gallery Alt C");
    const { pageId } = await createHostPage("reorder");

    try {
      await openEditorAndRemoveDefaultBlock(pageId);
      await addGalleryBlock();
      await page.getByRole("button", { name: "Görsel Ekle" }).click();
      await expect(page.getByRole("heading", { name: "Görsel Seç" })).toBeVisible();
      // Sırayla A, B, C tıklanır — `MediaPicker`'ın `onSelect` çağrısı seçim (tıklama) SIRASINI korur
      // (bkz. `media-picker.tsx::selectedMedia` — `Map` insertion-order).
      await page.getByRole("button", { name: `${mediaA.filename} seç` }).click();
      await page.getByRole("button", { name: `${mediaB.filename} seç` }).click();
      await page.getByRole("button", { name: `${mediaC.filename} seç` }).click();
      await page.getByRole("button", { name: "Seç (3)" }).click();

      await expect(page.locator('button[aria-label^="Sürükle: Görsel "]')).toHaveCount(3);
      await expect(altInput(0)).toHaveValue("QA Gallery Alt A");
      await expect(altInput(1)).toHaveValue("QA Gallery Alt B");
      await expect(altInput(2)).toHaveValue("QA Gallery Alt C");

      // Klavye ile sürükleme: dnd-kit `KeyboardSensor` — tutamaca odaklan, Space ile "kaldır",
      // yön tuşuyla hedefe taşı, Space ile "bırak" (resmi dnd-kit klavye etkileşim deseni).
      //
      // qa-agent gözlemi — `KeyboardSensor.attach()` (bkz. `node_modules/@dnd-kit/core/dist/
      // core.esm.js`) "kaldır" (Space) tuşundaki AYNI keydown olayında sensörü başlatır ama
      // hareket/"bırak" tuşlarını işleyecek asıl `handleKeyDown` dinleyicisini `setTimeout(() =>
      // this.listeners.add(...))` İLE (bir sonraki mikro/makro görev turunda) ekler — art arda,
      // ARAYA HİÇ BEKLEME KOYMADAN gönderilen tuş basışları (`Space` hemen ardından `ArrowRight`)
      // bu dinleyici henüz TAKILMADAN gelip SESSİZCE YUTULABİLİYOR (doğrulandı: standalone bir
      // Playwright betiğinde aradaki beklemeler kaldırılınca sıralama HİÇ değişmiyordu, 200ms
      // eklenince HER SEFERİNDE değişti). Bu, dosyanın geneldeki `dragUntil`/`dragByHandle`
      // başlığındaki "sentetik pointer olayı zamanlaması" bulgusuyla AYNI kategoriden bir test-
      // ortamı sınırlamasıdır (uygulama kodu DEĞİL) — düzeltme, `admin-page-builder-columns.spec.ts`
      // ile AYNI ruhta, tuş basışları arasına gerçek kullanıcı hızını taklit eden kısa bir bekleme
      // eklemektir.
      const handle1 = page.locator('button[aria-label="Sürükle: Görsel 1"]');
      await handle1.focus();
      await page.keyboard.press("Space");
      await page.waitForTimeout(150);
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(150);
      await page.keyboard.press("Space");

      // A ve B yer değiştirmiş olmalı (1. görsel artık B, 2.si artık A) — C etkilenmemeli.
      await expect(altInput(0)).toHaveValue("QA Gallery Alt B", { timeout: 5_000 });
      await expect(altInput(1)).toHaveValue("QA Gallery Alt A");
      await expect(altInput(2)).toHaveValue("QA Gallery Alt C");

      await saveAndExpectSuccess();

      // Kalıcılık doğrulaması — sayfa YENİDEN açıldığında (taze bir GET, state'ten DEĞİL) sıra korunur.
      await page.goto(`/admin/pages/${pageId}`);
      await expect(page.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);
      await expect(altInput(0)).toHaveValue("QA Gallery Alt B");
      await expect(altInput(1)).toHaveValue("QA Gallery Alt A");
      await expect(altInput(2)).toHaveValue("QA Gallery Alt C");
    } finally {
      await deletePagePermanently(token, pageId);
      await deleteTestMedia(token, mediaA.id);
      await deleteTestMedia(token, mediaB.id);
      await deleteTestMedia(token, mediaC.id);
    }
  });

  test("alt metni eksik görselde uyarı rozeti görünür, alt metin girilince kaybolur", async () => {
    test.setTimeout(60_000);
    const media = await uploadTestMedia(token, `qa-gallery-altwarn-${Date.now()}.png`);
    // KASITLI OLARAK altText BOŞ bırakılır (`uploadMedia` varsayılanı zaten `null`).
    const { pageId } = await createHostPage("alt-warning");

    try {
      await openEditorAndRemoveDefaultBlock(pageId);
      await addGalleryBlock();
      await page.getByRole("button", { name: "Görsel Ekle" }).click();
      await page.getByRole("button", { name: `${media.filename} seç` }).click();
      await page.getByRole("button", { name: "Seç (1)" }).click();

      await expect(page.getByTitle("Alt metin eksik")).toBeVisible();

      await altInput(0).fill("QA e2e galeri alt metni");
      await expect(page.getByTitle("Alt metin eksik")).toHaveCount(0);

      // Alanı tekrar boşaltınca rozet GERİ gelmeli (yalnızca ilk render'da değil, canlı doğrulama).
      await altInput(0).fill("");
      await expect(page.getByTitle("Alt metin eksik")).toBeVisible();
    } finally {
      await deletePagePermanently(token, pageId);
      await deleteTestMedia(token, media.id);
    }
  });

  test("Grid/Carousel/Masonry stil seçimi — geçiş yapılabilir ve kaydedilip yeniden açıldığında korunur", async () => {
    test.setTimeout(60_000);
    const media = await uploadTestMedia(token, `qa-gallery-layout-${Date.now()}.png`);
    const { pageId } = await createHostPage("layout-select");

    try {
      await openEditorAndRemoveDefaultBlock(pageId);
      await addGalleryBlock();
      await page.getByRole("button", { name: "Görsel Ekle" }).click();
      await page.getByRole("button", { name: `${media.filename} seç` }).click();
      await page.getByRole("button", { name: "Seç (1)" }).click();

      const gridBtn = page.getByRole("button", { name: "Izgara" });
      const carouselBtn = page.getByRole("button", { name: "Kaydırmalı" });

      // Varsayılan: Izgara (grid) seçili.
      await expect(gridBtn).toHaveAttribute("aria-pressed", "true");

      await carouselBtn.click();
      await expect(carouselBtn).toHaveAttribute("aria-pressed", "true");
      await expect(gridBtn).toHaveAttribute("aria-pressed", "false");

      await saveAndExpectSuccess();
      await page.goto(`/admin/pages/${pageId}`);
      await expect(page.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);
      await expect(page.getByRole("button", { name: "Kaydırmalı" })).toHaveAttribute("aria-pressed", "true");

      await page.getByRole("button", { name: "Masonry" }).click();
      await expect(page.getByRole("button", { name: "Masonry" })).toHaveAttribute("aria-pressed", "true");
      await saveAndExpectSuccess();
      await page.goto(`/admin/pages/${pageId}`);
      await expect(page.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);
      await expect(page.getByRole("button", { name: "Masonry" })).toHaveAttribute("aria-pressed", "true");
    } finally {
      await deletePagePermanently(token, pageId);
      await deleteTestMedia(token, media.id);
    }
  });
});

/**
 * Public site render — kritik: "yalnızca admin süsü kalan özellik" hatasının burada TEKRARLANMADIĞI
 * doğrulanır. Kurulum UI ÜZERİNDEN DEĞİL, `patchPageBlocks` (doğrudan API) ile yapılır — bkz. görev
 * tanımındaki madde 7 ("mevcut testlerdeki pattern neyse onu izle", `admin-page-builder-columns.spec.ts`
 * satır ~329 AYNI desen). `GalleryBlockDataSchema.images[].url` backend'de yalnızca `min(1)` string'dir
 * (gerçek bir URL formatı ZORUNLU DEĞİL, bkz. `pages.schemas.ts`), bu yüzden gerçek medya yükleme
 * GEREKMEZ — sabit `https://example.com/...` URL'leri yeterlidir.
 */
test.describe("Galeri bloğu — public site render (gerçek public URL, admin DIŞINDA)", () => {
  test("Grid: `auto-fit` grid class'ı + doğru sayıda görsel gerçekten render edilir", async () => {
    const { pageId, slug } = await createHostPage("public-grid", "PUBLISHED");
    try {
      await patchPageBlocks(token, pageId, [
        {
          id: "qa-gallery-grid",
          type: "gallery",
          data: {
            layout: "grid",
            images: [
              { url: "https://example.com/qa-e2e-gallery-grid-1.png", alt: "QA galeri grid 1" },
              { url: "https://example.com/qa-e2e-gallery-grid-2.png", alt: "QA galeri grid 2" },
            ],
          },
        },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        await expect(publicPage.getByRole("img", { name: "QA galeri grid 1" })).toBeVisible({ timeout: 15_000 });
        await expect(publicPage.locator('[class*="auto-fit"]').first()).toBeVisible();
        await expect(publicPage.locator("figure")).toHaveCount(2);
        // Regresyon kanıtı — Carousel/Masonry'ye ÖZGÜ class'lar Grid'de KESİNLİKLE yok (3 stilin
        // gerçekten FARKLI DOM ürettiğinin kanıtı, bkz. dosya başlığı).
        await expect(publicPage.locator('[class*="snap-x"]')).toHaveCount(0);
        await expect(publicPage.locator('[class*="columns-2"]')).toHaveCount(0);
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("Carousel: `snap-x` kaydırmalı bölge + gezinme okları gerçekten render edilir", async () => {
    const { pageId, slug } = await createHostPage("public-carousel", "PUBLISHED");
    try {
      await patchPageBlocks(token, pageId, [
        {
          id: "qa-gallery-carousel",
          type: "gallery",
          data: {
            layout: "carousel",
            images: [
              { url: "https://example.com/qa-e2e-gallery-car-1.png", alt: "QA galeri carousel 1" },
              { url: "https://example.com/qa-e2e-gallery-car-2.png", alt: "QA galeri carousel 2" },
              { url: "https://example.com/qa-e2e-gallery-car-3.png", alt: "QA galeri carousel 3" },
            ],
          },
        },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        await expect(publicPage.getByRole("img", { name: "QA galeri carousel 1" })).toBeVisible({ timeout: 15_000 });
        await expect(publicPage.getByRole("region", { name: "Galeri, kaydırmalı görünüm" })).toBeVisible();
        await expect(publicPage.locator('[class*="snap-x"]').first()).toBeVisible();
        await expect(publicPage.getByRole("button", { name: "Sonraki görsel" })).toBeVisible();
        await expect(publicPage.getByRole("button", { name: "Önceki görsel" })).toBeVisible();
        await expect(publicPage.locator("figure")).toHaveCount(3);
        await expect(publicPage.locator('[class*="auto-fit"]')).toHaveCount(0);
        await expect(publicPage.locator('[class*="columns-2"]')).toHaveCount(0);
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("Masonry: `columns-2`/`columns-3` class'ı gerçekten render edilir", async () => {
    const { pageId, slug } = await createHostPage("public-masonry", "PUBLISHED");
    try {
      await patchPageBlocks(token, pageId, [
        {
          id: "qa-gallery-masonry",
          type: "gallery",
          data: {
            layout: "masonry",
            images: [
              { url: "https://example.com/qa-e2e-gallery-mas-1.png", alt: "QA galeri masonry 1" },
              { url: "https://example.com/qa-e2e-gallery-mas-2.png", alt: "QA galeri masonry 2" },
            ],
          },
        },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        await expect(publicPage.getByRole("img", { name: "QA galeri masonry 1" })).toBeVisible({ timeout: 15_000 });
        await expect(publicPage.locator('[class*="columns-2"]').first()).toBeVisible();
        await expect(publicPage.locator("figure")).toHaveCount(2);
        await expect(publicPage.locator('[class*="auto-fit"]')).toHaveCount(0);
        await expect(publicPage.locator('[class*="snap-x"]')).toHaveCount(0);
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("Boş galeri (`images: []`) public sayfada HİÇBİR ŞEY render etmiyor — boş kutu/konteyner KALMIYOR", async () => {
    const { pageId, slug } = await createHostPage("public-empty", "PUBLISHED");
    try {
      // Boş galeriyi iki benzersiz metin bloğu ARASINA yerleştir — eğer `GalleryBlockView` boş
      // bir konteyner/div bırakıyorsa (bug), MARKER_BEFORE'un DOM'daki bir sonraki kardeş
      // elemanı MARKER_AFTER'IN KENDİSİ DEĞİL, aradaki o boş konteyner OLURDU.
      await patchPageBlocks(token, pageId, [
        { id: "qa-marker-before", type: "text", data: { html: "<p>QA_GALLERY_MARKER_BEFORE</p>" } },
        { id: "qa-gallery-empty", type: "gallery", data: { layout: "grid", images: [] } },
        { id: "qa-marker-after", type: "text", data: { html: "<p>QA_GALLERY_MARKER_AFTER</p>" } },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        // `TextBlockView` (`components/site/blocks/text-block.tsx`) marker metnini `<div class="prose
        // ...">` KÖK elemanının İÇİNE `dangerouslySetInnerHTML` ile (`<p>MARKER</p>`) basar —
        // `getByText`'in bulduğu innermost `<p>` DEĞİL, bu KÖK `div` blok-seviyesinde kardeştir
        // (`BlockRenderer` bir `<>` Fragment'i olduğu için EK bir sarmalayıcı DOM düğümü YOK,
        // blok-seviye elemanlar birbirinin DOĞRUDAN kardeşidir).
        const beforeBlock = publicPage.locator("div.prose", { hasText: "QA_GALLERY_MARKER_BEFORE" });
        await expect(beforeBlock).toBeVisible({ timeout: 15_000 });
        await expect(publicPage.getByText("QA_GALLERY_MARKER_AFTER")).toBeVisible();

        // Marker bloğunun hemen ardından gelen kardeş eleman DOĞRUDAN "after" blok metnini
        // içermeli — aradan sızmış boş bir galeri konteyneri YOK.
        const nextSiblingText = await beforeBlock.evaluate((el) => el.nextElementSibling?.textContent ?? null);
        expect(nextSiblingText).toBe("QA_GALLERY_MARKER_AFTER");

        await expect(publicPage.locator('[class*="auto-fit"]')).toHaveCount(0);
        await expect(publicPage.locator('[class*="snap-x"]')).toHaveCount(0);
        await expect(publicPage.locator('[class*="columns-2"]')).toHaveCount(0);
        await expect(publicPage.locator("figure")).toHaveCount(0);
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});
