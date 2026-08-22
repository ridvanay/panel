import { test, expect, type Page, type Locator } from "@playwright/test";
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

/**
 * qa-agent (bu turda eklendi) — `ContainerCard`'ın kök `.group` div'ini, üzerindeki "Seviye N"
 * rozet metninden bulur (`admin-page-builder-containers.spec.ts`teki AYNI teknik, bkz. o dosyanın
 * derinlik-sınırı senaryosu) — bir sayfada aynı anda birden fazla konteyner varken doğru kartı
 * SCOPE etmek için (aria-label'lar tüm konteynerler arasında PAYLAŞILIR, ör. "İç konteyner ekle").
 */
function containerCardByLevelBadge(levelText: string): Locator {
  return page
    .getByText(levelText, { exact: true })
    .locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' group ')][1]");
}

/**
 * v2 tasarım notları §2.2b — kontrol çubuğundaki YENİ `FolderPlus` "İç konteyner ekle" düğmesi
 * (`Popover`, `DropdownMenu` DEĞİL) ile bir konteynerin İÇİNE (CHILD, sibling DEĞİL) yeni bir alt
 * konteyner ekler. Popover seçimden sonra otomatik KAPANMAZ (§2.1) — `Escape` ile kapatılır.
 */
async function addChildContainerViaFolderPlus(card: Locator, presetLabel: string) {
  await card.locator('button[aria-label="İç konteyner ekle"]').click();
  await page.getByRole("button", { name: presetLabel, exact: true }).click();
  await page.keyboard.press("Escape");
  // qa-agent bulgusu — Popover'ın kapanış animasyonu (`data-closed`, ~100ms) bitmeden bir SONRAKİ
  // "İç konteyner ekle" popover'ı açılırsa, ESKİ popover içeriği DOM'da/erişilebilirlik ağacında bir
  // SÜRE daha görünür kalabilir ("Tek Sütun" strict-mode ihlali, 2 eşleşme) — art arda 3 kez
  // zincirlenen bu akışta (Seviye 1→2→3→4) tam kapanışı BEKLEMEK gerekir.
  await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0);
}

/**
 * `<input type="range">` React kontrollü input'unu güvenilir biçimde tetikler — Playwright'ın
 * `locator.fill()`'i `type="range"` için GÜVENİLİR DEĞİLDİR (resmi uyarı); native value setter +
 * `input` event dispatch'i, React'in `onChange`'ini (senkron `Object.is` karşılaştırmasını atlayan
 * native setter sayesinde) doğru tetikler.
 */
async function setRangeValue(locator: Locator, value: string) {
  await locator.evaluate((el: HTMLInputElement, val: string) => {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    nativeSetter.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
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
      // qa-agent (bu turda düzeltildi) — v2 tasarım notları §3.2/§3.3: `Select`/`combobox` VE
      // 5-değerli `SegmentedToggle` gecikme kontrolü KALDIRILDI. Efekt artık 4×2 ikon-karo grid
      // (`RevealEffectControl::REVEAL_TILES`, native `<button aria-label>`) — karonun `aria-label`/
      // `title`'ı `REVEAL_EFFECT_LABEL` (uzun etiket, ör. "fade-up" → "Yukarı Belirme (Fade Up)").
      // Gecikme artık 0-1000ms/100ms adımlı native `<input type="range" id="reveal-delay">`.
      await page.locator('button[aria-label="Yukarı Belirme (Fade Up)"]').click();

      // §3.4 — varsayılan gecikme 300ms (`RevealEffectControl`'ün `delayMs ?? 300`), kısa etiket
      // "Yukarı Belirme" (`REVEAL_SHORT_LABEL["fade-up"]`).
      await expect(page.getByText("Yukarı Belirme · 300ms", { exact: true })).toBeVisible();

      // Gecikme değiştirme — native range slider, yalnızca `hasEffect` (`effect !== "none"`) iken
      // görünür.
      await setRangeValue(page.locator("#reveal-delay"), "500");
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

  test("4) Flip Up efekti + gecikme/süre/tekrarlama ayarları kalıcı olur; public render'da doğru class/stil üretir", async () => {
    test.setTimeout(60_000);
    const { pageId, slug } = await createHostPage("reveal-flip-persist", "PUBLISHED");

    try {
      await openEditorAndRemoveDefaultBlock(pageId);

      await page.getByRole("button", { name: "Yeni Konteyner Ekle" }).click();
      await page.getByRole("button", { name: "Tek Sütun" }).click();

      await page.getByRole("button", { name: "Konteynere blok ekle" }).click();
      await page.getByRole("menuitem", { name: "Metin", exact: true }).click();

      const textBlockContent = "QA reveal flip-up kalıcılık metni";
      const textEditor = page.locator(".ProseMirror").first();
      await textEditor.click();
      await textEditor.pressSequentially(textBlockContent);
      await expect(textEditor).toContainText(textBlockContent);

      // Bloğun KENDİ "Görünüm Efekti" tetikleyicisi — konteynerin AYNI `aria-label`'ı taşıyan KENDİ
      // tetikleyicisiyle (strict-mode ihlali) KARIŞMAMASI için `ContentBlockCard`'ın kökü olan
      // `bg-card` sınıflı div'e SCOPE edilir.
      const textCard = textEditor.locator(
        "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' bg-card ')][1]"
      );
      const blockRevealTrigger = textCard.locator('button[aria-label="Görünüm Efekti"]');
      await expect(blockRevealTrigger).toHaveCount(1);
      await blockRevealTrigger.click();

      await page.locator('button[aria-label="Çevirerek Belirme (Flip Up)"]').click();

      await setRangeValue(page.locator("#reveal-delay"), "300");
      await expect(page.getByText("Gecikme (300ms)", { exact: true })).toBeVisible();

      // §3.4 — Süre `SegmentedToggle` (Hızlı=300/Normal=600/Yavaş=1000), varsayılan "Normal" (600).
      await page.getByRole("button", { name: "Hızlı", exact: true }).click();
      await expect(page.getByRole("button", { name: "Hızlı", exact: true })).toHaveAttribute("aria-pressed", "true");

      // §3.5 — Tekrarlama `Switch` (`checked = !once`), varsayılan `once: true` → switch KAPALI.
      // qa-agent/orkestratör bulgusu — sayfa formunun ÜSTÜNDEKİ "Hukuki belge" alanı da AYRI bir
      // `role="switch"` taşıyor (aynı DOM'da, popover'ın DIŞINDA) — `page.getByRole("switch")`
      // (isimsiz) İKİ eleman DÖNDÜRÜP strict-mode ihlaline yol açıyordu. `Switch` (base-ui) erişilebilir
      // adı `<label htmlFor="reveal-repeat">`ten DOĞRU şekilde alıyor (`aria-labelledby`) — test bu
      // yüzden `{ name: "Her görünüşte tekrarla" }` ile TEKİL bağlanır.
      const repeatSwitch = page.getByRole("switch", { name: "Her görünüşte tekrarla" });
      await expect(repeatSwitch).toHaveAttribute("aria-checked", "false");
      await repeatSwitch.click(); // AÇ — "her görünüşte tekrarla" (`once: false`)
      await expect(repeatSwitch).toHaveAttribute("aria-checked", "true");

      await page.keyboard.press("Escape");
      await saveAndExpectSuccess();

      // --- Kalıcılık — editörü YENİDEN yükle, popover'ı tekrar aç, seçimler KORUNMUŞ olmalı. ---
      await page.goto(`/admin/pages/${pageId}`);
      await expect(page.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);

      const reloadedTextEditor = page.locator(".ProseMirror").first();
      await expect(reloadedTextEditor).toContainText(textBlockContent);
      const reloadedTextCard = reloadedTextEditor.locator(
        "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' bg-card ')][1]"
      );
      await reloadedTextCard.locator('button[aria-label="Görünüm Efekti"]').click();

      await expect(page.locator('button[aria-label="Çevirerek Belirme (Flip Up)"]')).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#reveal-delay")).toHaveValue("300");
      await expect(page.getByRole("button", { name: "Hızlı", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("switch", { name: "Her görünüşte tekrarla" })).toHaveAttribute("aria-checked", "true");
      await page.keyboard.press("Escape");

      // --- Public render — `pb-reveal-flip-up` class'ı + inline `transition-delay`/`transition-duration`. ---
      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        const revealBox = publicPage.locator(".pb-reveal-flip-up");
        await expect(revealBox).toHaveCount(1);
        await expect(revealBox.getByText(textBlockContent)).toBeVisible({ timeout: 15_000 });
        await expect(revealBox).toHaveAttribute("style", /transition-delay:\s*300ms/);
        await expect(revealBox).toHaveAttribute("style", /transition-duration:\s*300ms/);
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});

test.describe("Editör araçları — İç İçe Konteyner Ekleme (Nested Containers)", () => {
  test("5) Kontrol çubuğundaki 'İç konteyner ekle' (FolderPlus) ile Seviye 1→4 UI'dan kurulur, Seviye 4'te preset karoları DISABLED olur", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("nested-depth", "DRAFT");

    try {
      await openEditorAndRemoveDefaultBlock(pageId);

      await page.getByRole("button", { name: "Yeni Konteyner Ekle" }).click();
      await page.getByRole("button", { name: "Tek Sütun" }).click();
      await expect(page.getByText("Seviye 1", { exact: true })).toBeVisible();

      // Seviye 1 → 2 → 3 → 4, HER SEFERİNDE kontrol çubuğundaki YENİ `FolderPlus` "İç konteyner
      // ekle" düğmesiyle (v2 tasarım notları §2.2b) — `AddContentMenu`'nün pinned menü satırı
      // DEĞİL, doğrudan buton kullanılır (ikinci giriş noktası aşağıda AYRICA doğrulanır).
      await addChildContainerViaFolderPlus(containerCardByLevelBadge("Seviye 1"), "Tek Sütun");
      await expect(page.getByText("Seviye 2", { exact: true })).toBeVisible();

      await addChildContainerViaFolderPlus(containerCardByLevelBadge("Seviye 2"), "Tek Sütun");
      await expect(page.getByText("Seviye 3", { exact: true })).toBeVisible();

      await addChildContainerViaFolderPlus(containerCardByLevelBadge("Seviye 3"), "Tek Sütun");
      const level4Badge = page.getByText("Seviye 4 · Maks.", { exact: true });
      await expect(level4Badge).toBeVisible();

      const level4Card = level4Badge.locator(
        "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' group ')][1]"
      );

      // qa-agent bulgusu — trigger düğmesinin/menü satırının KENDİSİ `disabled` DEĞİL (her zaman
      // tıklanabilir, popover/alt-menü AÇILIR); derinlik guard'ı `LayoutPresetPopoverGrid`in
      // İÇİNDEKİ preset KAROLARINA uygulanır (`disabled`/`disabledReason` props, bkz.
      // `builder-canvas.tsx::AddChildContainerControl` ve `add-content-menu.tsx`). Bu, tasarım
      // notlarıyla TUTARLI (§2.2a/§2.2b `disabled={atMaxDepth}` YALNIZCA `LayoutPresetPopoverGrid`e
      // geçiliyor) — aşağıdaki assertion'lar karo seviyesinde doğrular.
      await level4Card.locator('button[aria-label="İç konteyner ekle"]').click();
      const singleColumnTileInBar = page.getByRole("button", { name: "Tek Sütun", exact: true });
      const twoColumnTileInBar = page.getByRole("button", { name: "İki Eşit Sütun", exact: true });
      await expect(singleColumnTileInBar).toBeVisible();
      await expect(singleColumnTileInBar).toBeDisabled();
      await expect(singleColumnTileInBar).toHaveAttribute("title", "Maksimum iç içe geçme derinliğine ulaşıldı (4)");
      await expect(twoColumnTileInBar).toBeDisabled();
      await expect(twoColumnTileInBar).toHaveAttribute("title", "Maksimum iç içe geçme derinliğine ulaşıldı (4)");
      await page.keyboard.press("Escape");

      // Seviye 4 BOŞ olduğu için `EmptyContainerDropZone` → `AddContentMenu`'nün pinned "İç
      // Konteyner / Bölüm Ekle" satırı da AYNI şekilde devre dışı (§2.2a). `DropdownMenuSubTrigger`
      // KENDİSİ `disabled` DEĞİL — base-ui `SubmenuTrigger` varsayılan `openOnHover` (bir gerçek
      // fare TIKLAMASI `ignoreMouse: true` yüzünden YOK SAYILIR), bu yüzden `.hover()` kullanılır.
      // orkestratör bulgusu — `pinnedRow` menünün İLK öğesi, tetikleyici butonun HEMEN altında açılır;
      // imleç `.click()`ten sonra ZATEN o civarda durduğu için `.hover()` GERÇEK bir "giriş" hareketi
      // ÜRETMEZ — floating-ui'nin `allowMouseEnter` kapısı (menü imlecin ALTINDA açıldığında yanlışlıkla
      // hover-açılmasını önleyen kasıtlı korumadır) tetiklenmez, alt-menü AÇILMAZ. İmleç önce menünün
      // DIŞINA taşınıp GERİ getirilerek gerçek bir giriş olayı üretilir.
      await level4Card.getByRole("button", { name: "Konteynere blok ekle" }).click();
      const pinnedRow = page.getByRole("menuitem", { name: "İç Konteyner / Bölüm Ekle" });
      await expect(pinnedRow).toBeVisible();
      await page.mouse.move(0, 0);
      await pinnedRow.hover();
      const singleColumnTileInMenu = page.getByRole("button", { name: "Tek Sütun", exact: true });
      await expect(singleColumnTileInMenu).toBeVisible();
      await expect(singleColumnTileInMenu).toBeDisabled();
      await expect(singleColumnTileInMenu).toHaveAttribute("title", "Maksimum iç içe geçme derinliğine ulaşıldı (4)");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      // Ağaç DEĞİŞMEDEN kaldı — hâlâ tam 4 seviye (5. seviye YOK).
      await expect(page.locator('button[aria-label="Konteyner ayarları"]')).toHaveCount(4);

      await saveAndExpectSuccess();
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});

test.describe("Editör araçları — Kompakt Kontrol Çubuğu (taşma kontrolü)", () => {
  test("6) Mobil önizlemede (375px) 4'lü sütun düzeninde kontrol çubuğunun 5 butonu taşmaz", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("toolbar-overflow", "DRAFT");

    try {
      await openEditorAndRemoveDefaultBlock(pageId);

      await page.getByRole("button", { name: "Mobil", exact: true }).click();

      await page.getByRole("button", { name: "Yeni Konteyner Ekle" }).click();
      await page.getByRole("button", { name: "Dört Eşit Sütun" }).click();
      await expect(page.getByText("4 Sütun", { exact: true })).toBeVisible();

      // DOM sırası: [0]=dış "4 Sütun" satırının KENDİ Sil düğmesi, [1..4]=4 sütunun HER BİRİNİN Sil
      // düğmesi (bkz. `builder-canvas.tsx::ContainerCard` — kontrol çubuğu, ardından çocuklar).
      const deleteButtons = page.locator('button[aria-label="Konteyneri sil"]');
      await expect(deleteButtons).toHaveCount(5);

      const firstColumnDelete = deleteButtons.nth(1);
      const columnCard = firstColumnDelete.locator(
        "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' group ')][1]"
      );
      const columnBox = await columnCard.boundingBox();
      expect(columnBox).toBeTruthy();

      // §1.2 v2 tasarım notları — görünür 5'li sıra: Ayarlar/Efekt/İç Konteyner Ekle/Daha Fazla/Sil.
      const barButtonLabels = ["Konteyner ayarları", "Görünüm Efekti", "İç konteyner ekle", "Daha fazla işlem", "Konteyneri sil"];
      const viewportSize = page.viewportSize();
      expect(viewportSize).toBeTruthy();

      for (const label of barButtonLabels) {
        const btn = columnCard.locator(`button[aria-label="${label}"]`).first();
        await expect(btn).toBeVisible();
        const btnBox = await btn.boundingBox();
        expect(btnBox).toBeTruthy();
        // Buton, kendi sütun kartının sağ kenarını AŞMAMALI (taşma yok — §1.1/§1.2 tasarım
        // notlarındaki kök neden düzeltmesi: buton SAYISI 8-9'dan 5'e indirildi + `icon-xs` +
        // `gap-0.5`, bkz. dosya başlığı).
        expect(btnBox!.x + btnBox!.width).toBeLessThanOrEqual(columnBox!.x + columnBox!.width + 1);
        // Sayfa görünür alanının (viewport) içinde kalır — gerçekten tıklanabilir.
        expect(btnBox!.x).toBeGreaterThanOrEqual(0);
        expect(btnBox!.x + btnBox!.width).toBeLessThanOrEqual(viewportSize!.width);
      }

      await saveAndExpectSuccess();
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});
