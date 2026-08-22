import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession, createPage as createPageFixture, deletePagePermanently, patchPageBlocks, getPage } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * qa-agent — Page Builder üst araç çubuğu (`sticky top-14 z-20`, Taslak/Önizle/Kaydet) + konteyner
 * ayar paneli (sağdan sabit `Sheet` çekmecesi) revizyonu, e2e kapsamı. Kaynak: `.claude/design-
 * notes-page-builder-sticky-panel-and-toolbar.md` (ui-designer, bağlayıcı) + frontend-agent'ın bu
 * dokümana göre `frontend/src/app/admin/pages/[pageId]/page.tsx` ve
 * `frontend/src/components/admin/page-builder/container-settings-panel.tsx`'te yaptığı implementasyon.
 *
 * Bu dosya, `admin-page-builder-containers.spec.ts`/`admin-page-builder-editing-tools.spec.ts` ile
 * AYNI fixture/auth/session desenini kullanır. O iki dosya + `admin-page-builder-gallery.spec.ts`
 * TARANDI (`grep -r "sticky bottom|ContainerSettingsPanel|Konteyner Ayarları"`) — HİÇBİRİ eski
 * `sticky bottom-6` alt çubuğunu veya panelin eski inline/grid ikinci-sütun yerleşimini selector
 * olarak KULLANMIYORDU (tümü `getByRole("button", { name: "Kaydet", exact: true })` ile üstteki TEK
 * Kaydet butonunu zaten doğru buluyor, panel içeriğiyle yalnızca `getByText`/`getByRole` üzerinden
 * — kabuğun `Sheet`e taşınmasından ETKİLENMEYEN — bir şekilde etkileşime giriyordu) — bu yüzden o
 * dosyalarda GÜNCELLEME GEREKMEDİ, yalnızca bu YENİ dosya eklendi.
 *
 * ÖNEMLİ locator notu — `Sheet` (`@base-ui/react/dialog`) erişilebilirlik gereği bir `Dialog.Title`
 * (`SheetTitle`) render eder; bu, `container-settings-panel.tsx`'in KENDİ görünür başlığıyla
 * (`<h3>Konteyner Ayarları</h3>`) AYNI metni taşır ama `sr-only` (görsel olarak gizli) — DOM'da
 * `<h2>Konteyner Ayarları</h2>` (Sheet'in) + `<h3>Konteyner Ayarları</h3>` (panelin) olmak üzere
 * İKİ heading eşleşmesi vardır (bkz. design-notes §1.1 "Neden SheetHeader sr-only" gerekçesi). Bu
 * yüzden `getByRole("heading", { name: "Konteyner Ayarları" })` TEK BAŞINA strict-mode ihlali verir
 * — `level: 3` ile panelin KENDİ (görünür) başlığına daraltılır.
 */
test.describe.configure({ retries: 1 });

const PAGE_TITLE_PREFIX = "QaE2eStickyPanelPage";

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
  const slug = `qa-sticky-${prefix}-${unique}`;
  const created = await createPageFixture(token, {
    title: `${PAGE_TITLE_PREFIX} ${prefix} ${unique}`,
    slug,
    html: "<p>başlangıç fixture içeriği</p>",
    status,
  });
  return { pageId: created.id as string, slug: created.slug as string };
}

async function gotoEditor(pageId: string) {
  await page.goto(`/admin/pages/${pageId}`);
  await expect(page.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500); // bkz. `admin-page-builder-containers.spec.ts` başlığındaki AYNI güvenlik payı notu
}

async function saveAndExpectSuccess() {
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Sayfa kaydedildi.").last()).toBeVisible({ timeout: 10_000 });
}

/** Sıradan bir dikey konteyner ayarı — `minHeight` ile deterministik bir yükseklik üretir, sayfayı
 *  scroll gerektirecek kadar uzatmak için (gerçek metin/görsel içeriğine bağımlı OLMADAN). */
function fillerContainerSettings() {
  return {
    layout: "full-width" as const,
    direction: "column" as const,
    justifyContent: "start" as const,
    alignItems: "stretch" as const,
    gap: 16,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    background: { type: "none" as const },
    minHeight: { value: 220, unit: "px" as const },
  };
}

function buildFillerContainers(count: number, idPrefix: string) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${idPrefix}-${i}`,
    type: "container",
    settings: fillerContainerSettings(),
    children: [{ id: `${idPrefix}-txt-${i}`, type: "text", data: { html: `<p>Dolgu içerik ${i}</p>` } }],
  }));
}

test.describe("Konteyner ayar paneli — sağdan sabit çekmece (Sheet)", () => {
  test("1) Sayfanın altına scroll gerektiren derin bir konteynerde 'Ayarlar' paneli sağdan SABİT bir çekmece olarak açılır — sayfa akışının parçası DEĞİL, pencere scroll'undan etkilenmez", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("scroll-drawer", "DRAFT");

    try {
      // 16 dolgu konteyner (~220px minHeight + gap'ler) — hedef (SONUNCU) konteynerin "Ayarlar"
      // düğmesi başlangıçta görünür alanın DIŞINDA kalır; Playwright bu düğmeye tıklamadan ÖNCE
      // onu otomatik görünür alana kaydırır (`scrollIntoViewIfNeeded`) — gerçek bir kullanıcının
      // sayfayı aşağı kaydırıp derin bir konteynerin ayarlarını açması senaryosunu simüle eder.
      const fillers = buildFillerContainers(16, "qa-scroll-filler");
      await patchPageBlocks(token, pageId, fillers);

      await gotoEditor(pageId);

      const settingsButtons = page.locator('button[aria-label="Konteyner ayarları"]');
      await expect(settingsButtons).toHaveCount(16);

      await settingsButtons.last().click();

      const scrollYAfterOpen = await page.evaluate(() => window.scrollY);
      expect(scrollYAfterOpen).toBeGreaterThan(300); // gerçekten aşağı kaydırılmış durumda olmalı

      const sheetContent = page.locator('[data-slot="sheet-content"]');
      await expect(sheetContent).toBeVisible();
      await expect(page.getByRole("heading", { name: "Konteyner Ayarları", level: 3 })).toBeVisible();

      // Çekmecenin kendisi `position: fixed` — sayfanın normal doküman akışının PARÇASI DEĞİL
      // (bkz. `sheet.tsx::SheetContent`, `fixed z-50 ... data-[side=right]:inset-y-0`).
      await expect(sheetContent).toHaveCSS("position", "fixed");
      const boxWhileScrolledDown = await sheetContent.boundingBox();
      expect(boxWhileScrolledDown).toBeTruthy();
      expect(boxWhileScrolledDown!.y).toBeLessThan(5); // `inset-y-0` — üstten sıfır

      // Kullanıcı pencereyi tekrar en üste kaydırsa (veya hiç kaydırmasa) bile panelin konumu/
      // boyutu DEĞİŞMEZ — `SheetPortal` ana pencere kaydırma bağlamının DIŞINDA render edilir,
      // panel eski (inline/`grid-cols-[1fr_320px]`) yerleşimdeki gibi sayfayla birlikte KAYMAZ.
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await page.evaluate(() => window.scrollY)).toBe(0);

      await expect(sheetContent).toBeVisible();
      const boxAtTop = await sheetContent.boundingBox();
      expect(boxAtTop).toBeTruthy();
      expect(Math.abs(boxAtTop!.y - boxWhileScrolledDown!.y)).toBeLessThan(2);
      expect(Math.abs(boxAtTop!.height - boxWhileScrolledDown!.height)).toBeLessThan(2);

      // Kapatma yolu 2/2 — backdrop'a tıklama (base-ui `Dialog` varsayılanı, `showCloseButton=false`
      // olduğu için panelin KENDİ X'i dışındaki TEK diğer kapatma yolu; sol üst köşe backdrop'a,
      // panelin kendisine (sağda) İSABET ETMEZ).
      await page.locator('[data-slot="sheet-overlay"]').click({ position: { x: 5, y: 5 } });
      await expect(page.getByRole("heading", { name: "Konteyner Ayarları", level: 3 })).toHaveCount(0);
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("2) Panelde bir alanı (gap) değiştirmek state'e yansır; panel kapanıp yeniden açılınca veya başka bir konteyner seçilip geri dönülünce değer KAYBOLMAZ, komşu konteynerin değerini SIZDIRMAZ", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("panel-state", "DRAFT");

    try {
      const col = {
        layout: "boxed" as const,
        direction: "column" as const,
        justifyContent: "start" as const,
        alignItems: "stretch" as const,
        gap: 16,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        background: { type: "none" as const },
      };
      await patchPageBlocks(token, pageId, [
        {
          id: "qa-panel-a",
          type: "container",
          settings: col,
          children: [
            { id: "qa-panel-a-t1", type: "text", data: { html: "<p>QA panel A metin 1</p>" } },
            { id: "qa-panel-a-t2", type: "text", data: { html: "<p>QA panel A metin 2</p>" } },
          ],
        },
        {
          id: "qa-panel-b",
          type: "container",
          settings: col,
          children: [{ id: "qa-panel-b-t1", type: "text", data: { html: "<p>QA panel B metin 1</p>" } }],
        },
      ]);

      await gotoEditor(pageId);

      const settingsButtons = page.locator('button[aria-label="Konteyner ayarları"]');
      await expect(settingsButtons).toHaveCount(2);
      const gapInput = page.locator("#container-gap");

      // A'nın ayarlarını aç, gap'i (16 → 64) değiştir.
      await settingsButtons.nth(0).click();
      await expect(page.getByRole("heading", { name: "Konteyner Ayarları", level: 3 })).toBeVisible();
      await expect(gapInput).toHaveValue("16");
      await gapInput.fill("64");
      await expect(gapInput).toHaveValue("64");

      // Panelin KENDİ X butonuyla kapat (backdrop DEĞİL, bkz. senaryo 1'in kapsadığı yol) —
      // `ContainerSettingsPanel` unmount olur (`{selectedContainer && (...)}`), ama veri
      // component'in KENDİSİNDE değil `page.tsx`'teki `activeNodes` state'inde yaşadığı için
      // kaybolmamalı (design-notes §1.3).
      await page.locator('button[aria-label="Paneli kapat"]').click();
      await expect(page.getByRole("heading", { name: "Konteyner Ayarları", level: 3 })).toHaveCount(0);
      await page.waitForTimeout(300); // Sheet kapanış geçişi (~200ms)

      // Aynı konteyneri (A) yeniden aç — 64 hâlâ orada.
      await settingsButtons.nth(0).click();
      await expect(page.getByRole("heading", { name: "Konteyner Ayarları", level: 3 })).toBeVisible();
      await expect(gapInput).toHaveValue("64");

      // Kapat, B'nin ayarlarını aç — kendi (dokunulmamış) 16 değerini gösterir, A'nınkini SIZDIRMAZ.
      await page.locator('button[aria-label="Paneli kapat"]').click();
      await page.waitForTimeout(300);
      await settingsButtons.nth(1).click();
      await expect(page.getByRole("heading", { name: "Konteyner Ayarları", level: 3 })).toBeVisible();
      await expect(gapInput).toHaveValue("16");

      // A'ya geri dön — hâlâ 64 (B'yi ziyaret etmek A'nın state'ini SIFIRLAMADI).
      await page.locator('button[aria-label="Paneli kapat"]').click();
      await page.waitForTimeout(300);
      await settingsButtons.nth(0).click();
      await expect(gapInput).toHaveValue("64");

      await page.locator('button[aria-label="Paneli kapat"]').click();
      await page.waitForTimeout(300);

      await saveAndExpectSuccess();

      // API-seviyesi doğrulama — state kaybı YOKTU iddiasının kalıcı/gerçek kanıtı: kaydedilen
      // veride A'nın gap'i 64, B'ninki DOKUNULMAMIŞ (16) olarak kalmalı.
      const saved = await getPage(token, pageId);
      const savedBlocks = saved.blocks as Array<{ id: string; settings: { gap: number } }>;
      const savedA = savedBlocks.find((b) => b.id === "qa-panel-a");
      const savedB = savedBlocks.find((b) => b.id === "qa-panel-b");
      expect(savedA?.settings.gap).toBe(64);
      expect(savedB?.settings.gap).toBe(16);
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});

test.describe("Üst araç çubuğu — sticky + Kaydet/Ctrl+S", () => {
  /**
   * DÜZELTİLDİ (frontend-agent) — bu senaryo bir turda `test.fail()` ile "bilinen bug" olarak
   * işaretlenmişti: `sticky top-14 z-20` üst araç çubuğu, `frontend/src/app/admin/layout.tsx`
   * satır ~45'teki `<main className="flex-1 overflow-hidden ...">` yüzünden HİÇ yapışmıyordu —
   * `overflow-hidden` (dikey eksende) `<main>`'i CSS açısından `position: sticky`'nin "en yakın
   * kaydırma bağlamı" ata'sı yapıyordu, ama bu `<main>` KENDİSİ hiçbir zaman scroll OLMUYORDU
   * (gerçek scroll `window`/`documentElement` seviyesinde gerçekleşiyor) — sonuç, sticky elemanın
   * `scrollY` ile TAM 1:1 yukarı kayması, yani pratikte `position: static` gibi davranması.
   *
   * Düzeltme: `admin/layout.tsx`'teki `<main>`da `overflow-hidden` → `overflow-x-clip` (`overflow-
   * x-hidden` DEĞİL — canlı tarayıcıda doğrulandı: CSS Overflow spec'inin "visible/non-visible
   * eşleşme" kuralı gereği `overflow-x: hidden` + belirtilmemiş `overflow-y` kombinasyonu, tarayıcıyı
   * `overflow-y`'nin kullanılan değerini YİNE 'auto'ya zorluyor — yani `<main>` YİNE bir scroll
   * container oluyor ve sticky YİNE bozuk kalıyordu, `overflow-x-hidden` ile test EDİLİP GÖZLEMLENDİ.
   * `overflow-x-clip` bu zorlamadan MUAF — `overflow-y` gerçekten 'visible' kalıyor, `<main>` hiçbir
   * eksende scroll container OLMUYOR, `sticky` gerçek `window` scroll bağlamına bağlanıyor). Bu
   * global bir layout değişikliği olduğu için `/admin/pages`, `/admin/appearance` gibi diğer admin
   * sayfaları da elle/otomatik gözden geçirildi — hiçbir yatay scrollbar/layout kırılması yok;
   * `appearance/page.tsx`'teki kendi `lg:sticky lg:top-6`/`sticky bottom-6` blokları da (aynı kök
   * nedenden ÖNCEDEN çalışmıyordu) bu düzeltmeyle birlikte artık doğru şekilde yapışıyor — bir yan-
   * etki regresyonu değil, aynı kök nedenin başka bir belirtisinin de düzelmesi.
   */
  test("3) Üst araç çubuğu (Sil / Taslak Olarak Kaydet / Önizle / Kaydet) sayfa aşağı kaydırılınca GERÇEKTEN sticky kalır (görünür/tıklanabilir)", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("sticky-toolbar", "DRAFT");

    try {
      const fillers = buildFillerContainers(10, "qa-toolbar-filler");
      await patchPageBlocks(token, pageId, fillers);

      await gotoEditor(pageId);

      // Yalnızca 400px — sayfanın en altına kadar gitmeye GEREK YOK, kök neden (yukarıdaki not)
      // zaten ~200px'ten itibaren tetikleniyor; küçük/deterministik bir değer flaky'liği azaltır.
      await page.evaluate(() => window.scrollTo(0, 400));
      expect(await page.evaluate(() => window.scrollY)).toBe(400);

      const viewport = page.viewportSize();
      expect(viewport).toBeTruthy();

      const saveButton = page.getByRole("button", { name: "Kaydet", exact: true });
      const deleteButton = page.getByRole("button", { name: "Sil", exact: true });
      const draftButton = page.getByRole("button", { name: "Taslak Olarak Kaydet" });

      for (const btn of [saveButton, deleteButton, draftButton]) {
        const box = await btn.boundingBox();
        expect(box).toBeTruthy();
        // Görünür alanın (viewport) İÇİNDE kalmalı — `top-14 z-20` çubuğu pencerenin üst kısmına
        // yapışık kalıyor (bkz. yukarıdaki düzeltme notu — `admin/layout.tsx` `overflow-x-clip`).
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
      }

      await saveButton.click();
      await expect(page.getByText("Sayfa kaydedildi.").last()).toBeVisible({ timeout: 10_000 });
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("4) Ctrl+S kısayolu handleSave()'i (üstteki 'Kaydet' ile AYNI PATCH isteğini) tetikler", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("ctrl-s", "DRAFT");

    try {
      await gotoEditor(pageId);

      await page.locator("#title").fill(`${PAGE_TITLE_PREFIX} ctrl-s (değiştirildi)`);
      await expect(page.getByText("Kaydedilmemiş değişiklik")).toBeVisible();

      const updateResponse = page.waitForResponse(
        (res) => res.url().includes(`/admin/pages/${pageId}`) && res.request().method() === "PATCH"
      );
      await page.keyboard.press("Control+s");
      const res = await updateResponse;
      expect(res.ok()).toBe(true);

      await expect(page.getByText("Sayfa kaydedildi.").last()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Kaydedilmemiş değişiklik")).toHaveCount(0);
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});

test.describe("Üst araç çubuğu — 'Taslak Olarak Kaydet' / 'Önizle' görünürlük ve disabled davranışı", () => {
  test("5) DRAFT sayfa — 'Taslak Olarak Kaydet' disabled + doğru title; 'Önizle' disabled BUTON (gerçek bir <a> DEĞİL) + doğru title", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("toolbar-draft", "DRAFT");

    try {
      await gotoEditor(pageId);

      const draftButton = page.getByRole("button", { name: "Taslak Olarak Kaydet" });
      await expect(draftButton).toBeDisabled();
      await expect(draftButton).toHaveAttribute("title", "Sayfa zaten taslak");

      const previewButton = page.getByRole("button", { name: "Önizle" });
      await expect(previewButton).toBeDisabled();
      await expect(previewButton).toHaveAttribute("title", "Önizlemek için sayfa önce yayınlanmalı");
      await expect(previewButton).not.toHaveAttribute("href");
      expect(await previewButton.evaluate((el) => el.tagName)).toBe("BUTTON");
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("6) PUBLISHED sayfa — 'Taslak Olarak Kaydet' aktif; 'Önizle' gerçek bir <a> linki (doğru href/target/rel)", async () => {
    test.setTimeout(60_000);
    const { pageId, slug } = await createHostPage("toolbar-published", "PUBLISHED");

    try {
      await gotoEditor(pageId);

      const draftButton = page.getByRole("button", { name: "Taslak Olarak Kaydet" });
      await expect(draftButton).toBeEnabled();
      await expect(draftButton).not.toHaveAttribute("title");

      const previewLink = page.getByRole("link", { name: "Önizle" });
      await expect(previewLink).toBeVisible();
      await expect(previewLink).toHaveAttribute("href", `/${slug}`);
      await expect(previewLink).toHaveAttribute("target", "_blank");
      await expect(previewLink).toHaveAttribute("rel", "noopener noreferrer");
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});
