import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession, createPage as createPageFixture, deletePagePermanently } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * "Metin" bloğu düzeltmeleri (bu turda frontend-agent tarafından geçici Playwright script'leriyle
 * doğrulanmış ama kalıcı bir test dosyasına DÖNÜŞTÜRÜLMEMİŞ değişiklikler — qa-agent bunu kalıcı
 * hale getirir, bkz. görev notu):
 *
 *  1. `registry.ts::createBlock("text")` artık `data: { html: "" }` ile başlıyor (önceden gerçek
 *     "<p>Metin girin…</p>" metniydi — placeholder'ı TAMAMEN devre dışı bırakıyordu).
 *  2. `text-block.tsx`, `PostEditor`'a `placeholder="Metin girin…"` + `minHeightClassName="min-h-[140px]"`
 *     geçiyor (blog editörünün varsayılanları — "İçeriğinizi buraya yazın…" / min-h-[200px] —
 *     AYRI/KORUNMUŞ kalıyor, bkz. aşağıdaki regresyon testi).
 *  3. `globals.css`teki unlayered `:focus-visible` kuralı `.ProseMirror` üzerinde tarayıcının
 *     kendi outline'ı + kart sarmalayıcının `focus-within:ring` ile ÇİFT halka üretiyordu;
 *     `.ProseMirror:focus-visible { outline: none; }` (aynı unlayered katman, daha yüksek
 *     özgüllük) bunu düzeltti.
 */
test.describe.configure({ retries: 1 });

const PAGE_TITLE_PREFIX = "QaE2eTextBlockPage";

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

async function createHostPage(prefix: string) {
  const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 46_656).toString(36)}`;
  const slug = `qa-txt-${prefix}-${unique}`;
  const created = await createPageFixture(token, {
    title: `${PAGE_TITLE_PREFIX} ${prefix} ${unique}`,
    slug,
    // Fixture varsayılan bir Metin bloğu ile GERÇEK içerik oluşturuyor (bkz. `support/api.ts`
    // `createPage`) — bu, `registry.ts::createBlock`'un YENİ ("") varsayılanından FARKLI bir
    // kod yoluna gider (backend'den yüklenen mevcut bir blok). Testin doğruladığı davranış
    // SADECE editörde ELLE eklenen YENİ bir bloğa özgü olduğu için bu varsayılan blok aşağıda
    // silinip yerine editör üzerinden taze bir tane eklenir.
    html: "başlangıç fixture içeriği",
    status: "DRAFT",
  });
  return { pageId: created.id as string, slug: created.slug as string };
}

/** `admin-page-builder-widgets.spec.ts` ile AYNI desen — varsayılan konteyneri kaldırır, taze
 *  bir "Tek Sütun" konteyner + blok seçici menüsü açar; çağıran taraf kategorisiyle blok seçer. */
async function openEditorAndAddFreshBlock(pageId: string, categoryTab: string, blockName: string) {
  await page.goto(`/admin/pages/${pageId}`);
  await expect(page.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500); // bkz. `admin-page-builder-gallery.spec.ts` başlığındaki AYNI güvenlik payı notu
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(2);
  await page.locator('button[aria-label="Konteyneri sil"]').first().click();
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(0);

  // Sabit "DÜZEN" paneli kaldırıldı (`.claude/design-notes-page-builder-dynamic-container-
  // insertion.md`) — sayfa TAMAMEN boşken tetikleyici artık boş-durum hero'sunun İÇİNDEKİ
  // "Yeni Konteyner Ekle" düğmesi, popover'ı açar; karo tıklaması aynen kalır.
  await page.getByRole("button", { name: "Yeni Konteyner Ekle" }).click();
  await page.getByRole("button", { name: "Tek Sütun" }).click();
  await page.getByRole("button", { name: "Konteynere blok ekle" }).click();
  await page.getByRole("tab", { name: categoryTab }).click();
  await page.getByRole("menuitem", { name: blockName, exact: true }).click();
}

test.describe("Metin bloğu — editör içeriği/placeholder/fokus davranışı", () => {
  test("yeni eklenen bir Metin bloğu GERÇEKTEN boş başlar ve placeholder DOM'da görünür", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("empty-placeholder");
    try {
      await openEditorAndAddFreshBlock(pageId, "Temel Elemanlar", "Metin");

      const editor = page.locator(".ProseMirror").first();
      await expect(editor).toBeVisible();

      // Karakter sayacı 0 — eski davranışta "<p>Metin girin…</p>" başlangıç içeriği yüzünden
      // "12 karakter" gösteriyordu (bkz. dosya başlığı madde 1).
      await expect(page.getByText("0 karakter")).toBeVisible();

      // Tiptap Placeholder extension'ı YALNIZCA içerik boşken `data-placeholder` +
      // `is-editor-empty` üretir (bkz. globals.css'teki `.tiptap p.is-editor-empty:first-child::before` kuralı).
      const placeholderParagraph = editor.locator('p[data-placeholder="Metin girin…"].is-editor-empty');
      await expect(placeholderParagraph).toHaveCount(1);

      // Gerçekten görsel olarak render edildiğini de doğrula (::before pseudo-element içeriği).
      const beforeContent = await placeholderParagraph.evaluate((el) => window.getComputedStyle(el, "::before").content);
      expect(beforeContent).toContain("Metin girin");
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("editöre fokus verildiğinde SADECE sarmalayıcının halkası görünür, .ProseMirror'ın kendi outline'ı yoktur", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("focus-ring");
    try {
      await openEditorAndAddFreshBlock(pageId, "Temel Elemanlar", "Metin");

      const editor = page.locator(".ProseMirror").first();
      await editor.click();
      await expect(editor).toBeFocused();

      // Çift halka hatası: tarayıcının varsayılan `:focus-visible` outline'ı `.ProseMirror`
      // üzerinde `outline: none` ile bilerek bastırıldı (bkz. dosya başlığı madde 3) — tek
      // görünür gösterge artık kart sarmalayıcının `focus-within:ring`'idir.
      const outlineStyle = await editor.evaluate((el) => window.getComputedStyle(el).outlineStyle);
      expect(outlineStyle).toBe("none");

      const wrapperBoxShadow = await editor.evaluate((el) => {
        const wrapper = el.closest('div[class*="focus-within:ring"]');
        return wrapper ? window.getComputedStyle(wrapper).boxShadow : null;
      });
      expect(wrapperBoxShadow).not.toBeNull();
      expect(wrapperBoxShadow).not.toBe("none");
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("editörün boş alt boşluğuna tıklamak editörü fokuslar (min-height .ProseMirror'ın KENDİSİNDE)", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("click-empty-area");
    try {
      await openEditorAndAddFreshBlock(pageId, "Temel Elemanlar", "Metin");

      const editor = page.locator(".ProseMirror").first();
      const box = await editor.boundingBox();
      expect(box).not.toBeNull();
      // `min-h-[140px]` — editör içeriği boş olduğu için gerçek metin satırı çok daha kısa;
      // kutunun alt kısmına (boş dolgu alanına) tıklanır.
      await editor.click({ position: { x: 10, y: Math.max(box!.height - 8, 4) } });
      await expect(editor).toBeFocused();
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});

test.describe("Regresyon — blog yazı editörünün varsayılanları DEĞİŞMEDİ", () => {
  test("blog editörü hâlâ 'İçeriğinizi buraya yazın…' placeholder'ını ve 200px min-height'ı kullanır", async () => {
    test.setTimeout(60_000);
    await page.goto("/admin/blog/new");
    await expect(page.getByText("İçerik", { exact: true })).toBeVisible({ timeout: 15_000 });

    const editor = page.locator(".ProseMirror").first();
    await expect(editor).toBeVisible();

    const placeholderParagraph = editor.locator('p[data-placeholder="İçeriğinizi buraya yazın…"].is-editor-empty');
    await expect(placeholderParagraph).toHaveCount(1);

    const minHeight = await editor.evaluate((el) => window.getComputedStyle(el).minHeight);
    expect(minHeight).toBe("200px");

    // Çift-halka düzeltmesi page-builder'a ÖZEL değil — `.ProseMirror` seçicisi global (bkz.
    // globals.css), blog editöründe de AYNI şekilde uygulanmalı.
    await editor.click();
    await expect(editor).toBeFocused();
    const outlineStyle = await editor.evaluate((el) => window.getComputedStyle(el).outlineStyle);
    expect(outlineStyle).toBe("none");
  });
});
