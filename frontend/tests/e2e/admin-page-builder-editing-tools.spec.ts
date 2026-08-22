import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession, createPage as createPageFixture, deletePagePermanently } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * qa-agent — Editör Araçları (Cihaz Önizleme Çubuğu / Şekilli Bölüm Ayırıcıları / Giriş
 * Animasyonları), e2e smoke kapsamı. Kaynak: `.claude/design-notes-page-builder-editing-tools.md`
 * (ui-designer) + `builder-canvas.tsx`/`container-settings-panel.tsx` implementasyonu.
 *
 * Bu üç özellik için mevcut bir e2e testi YOKTU (yalnızca `pages-container-schema.test.ts`
 * backend unit testleri şemayı kapsıyordu) — bu dosya `admin-page-builder-containers.spec.ts` ile
 * AYNI fixture/auth/session deseniyle en az bir kritik akış doğrulaması ekler (DoD §"E2E test
 * eklenmiş").
 */
test.describe.configure({ retries: 1 });

const PAGE_TITLE_PREFIX = "QaE2eEditingToolsPage";
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
  const slug = `qa-tools-${prefix}-${unique}`;
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
  await page.waitForTimeout(500); // bkz. `admin-page-builder-containers.spec.ts` başlığındaki AYNI güvenlik payı notu
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(2);
  await page.locator('button[aria-label="Konteyneri sil"]').first().click();
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(0);
}

async function saveAndExpectSuccess() {
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Sayfa kaydedildi.").last()).toBeVisible({ timeout: 10_000 });
}

test.describe("Editör araçları — Cihaz Önizleme Çubuğu", () => {
  test("1) Tablet/Mobil butonlarına tıklayınca tuval genişliği değişir, rozet görünür", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("device-preview", "DRAFT");

    try {
      await openEditorAndRemoveDefaultBlock(pageId);

      // `canvasWidthClass()` — DndContext içindeki içerik sarmalayıcı `mx-auto w-full
      // transition-all duration-300` sınıflarını HER ZAMAN taşır, cihaza göre `max-w-[…]` eklenir.
      const canvas = page.locator(
        'div[class*="mx-auto"][class*="w-full"][class*="transition-all"][class*="duration-300"]'
      );
      await expect(canvas).toHaveCount(1);

      // Masaüstü (varsayılan) — genişlik kısıtı YOK, rozet gösterilmez (§1.5).
      await expect(page.getByText("768px", { exact: true })).toHaveCount(0);
      await expect(page.getByText("375px", { exact: true })).toHaveCount(0);

      await page.getByRole("button", { name: "Tablet", exact: true }).click();
      await expect(canvas).toHaveClass(/max-w-\[768px\]/);
      await expect(page.getByText("768px", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Mobil", exact: true }).click();
      await expect(canvas).toHaveClass(/max-w-\[375px\]/);
      await expect(page.getByText("375px", { exact: true })).toBeVisible();
      await expect(canvas).not.toHaveClass(/max-w-\[768px\]/);

      await page.getByRole("button", { name: "Masaüstü", exact: true }).click();
      await expect(canvas).not.toHaveClass(/max-w-\[375px\]/);
      await expect(page.getByText("375px", { exact: true })).toHaveCount(0);
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});

test.describe("Editör araçları — Şekilli Bölüm Ayırıcıları", () => {
  test("2) Konteyner ayarlarında 'Ayırıcılar' bölümünden bir şablon seçilir, kaydedilir, public'te SVG ayırıcı render olur", async () => {
    test.setTimeout(60_000);
    const { pageId, slug } = await createHostPage("shape-divider", "PUBLISHED");

    try {
      await openEditorAndRemoveDefaultBlock(pageId);

      // Sabit "DÜZEN" paneli kaldırıldı (`.claude/design-notes-page-builder-dynamic-container-
      // insertion.md`) — sayfa TAMAMEN boşken tetikleyici artık boş-durum hero'sunun İÇİNDEKİ
      // "Yeni Konteyner Ekle" düğmesi, popover'ı açar; karo tıklaması aynen kalır.
      await page.getByRole("button", { name: "Yeni Konteyner Ekle" }).click();
      await page.getByRole("button", { name: "Tek Sütun" }).click();
      const settingsBtn = page.locator('button[aria-label="Konteyner ayarları"]');
      await expect(settingsBtn).toHaveCount(1);
      await settingsBtn.first().click();

      await expect(page.getByText("Ayırıcılar", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Üst Ayırıcı ekle" }).click();

      // Varsayılan şablon `wave` (`DEFAULT_SHAPE_DIVIDER.type`) — açık durumda 4 karo görünür,
      // "Eğimli Çizgi" (slant) seçilir (render motorundaki path'i public'te doğrudan aranabilir).
      const slantTile = page.locator('button[aria-label="Eğimli Çizgi"]');
      await expect(slantTile).toBeVisible();
      await slantTile.click();
      await expect(slantTile).toHaveAttribute("aria-pressed", "true");

      await saveAndExpectSuccess();

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        // `container-block.tsx::SHAPE_DIVIDER_PATHS.slant` — tam-genişlik render yolu.
        const dividerPath = publicPage.locator('svg path[d="M0,120 L1200,0 L1200,120 Z"]');
        await expect(dividerPath).toBeVisible({ timeout: 15_000 });
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});

test.describe("Editör araçları — Giriş Animasyonları (Scroll Reveal)", () => {
  test("3) Bir konteynerin 'Görünüm Efekti' popover'ında efekt seçilince kart rozeti ('· ms') görünür", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("scroll-reveal", "DRAFT");

    try {
      await openEditorAndRemoveDefaultBlock(pageId);

      // Sabit "DÜZEN" paneli kaldırıldı (`.claude/design-notes-page-builder-dynamic-container-
      // insertion.md`) — sayfa TAMAMEN boşken tetikleyici artık boş-durum hero'sunun İÇİNDEKİ
      // "Yeni Konteyner Ekle" düğmesi, popover'ı açar; karo tıklaması aynen kalır.
      await page.getByRole("button", { name: "Yeni Konteyner Ekle" }).click();
      await page.getByRole("button", { name: "Tek Sütun" }).click();
      const revealTrigger = page.locator('button[aria-label="Görünüm Efekti"]');
      await expect(revealTrigger).toHaveCount(1);

      // Efekt seçilmeden önce rozet YOK.
      await expect(page.getByText(/· \d+ms/)).toHaveCount(0);

      await revealTrigger.click();
      // NOT: `getByLabel("Görünüm Efekti")` KULLANILMAZ — popover tetikleyici butonu da AYNI
      // `aria-label="Görünüm Efekti"` taşıdığı için (strict-mode ihlali, iki eşleşme); `combobox`
      // rolüne daraltılır (yalnızca popover içindeki `<select>` bu role sahip).
      await page.getByRole("combobox", { name: "Görünüm Efekti" }).selectOption("fade-up");

      // §3.4 — varsayılan gecikme 300ms (`RevealEffectControl`'ün `delayMs ?? 300`), kısa etiket
      // "Yukarı Belirme" (`REVEAL_SHORT_LABEL["fade-up"]`).
      await expect(page.getByText("Yukarı Belirme · 300ms", { exact: true })).toBeVisible();

      // Gecikme değiştirme — `SegmentedToggle` yalnızca `effect !== "none"` iken görünür.
      await page.getByRole("button", { name: "500", exact: true }).click();
      await expect(page.getByText("Yukarı Belirme · 500ms", { exact: true })).toBeVisible();

      await page.keyboard.press("Escape");
      await saveAndExpectSuccess();

      // Kalıcılık — sayfa yeniden açıldığında rozet hâlâ görünür.
      await page.goto(`/admin/pages/${pageId}`);
      await expect(page.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);
      await expect(page.getByText("Yukarı Belirme · 500ms", { exact: true })).toBeVisible();
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});
