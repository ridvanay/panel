import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  getCachedAdminSession,
  createPage as createPageFixture,
  deletePagePermanently,
  patchPageBlocks,
  getPage,
  setRawPageBlocksDirectly,
} from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * Dalga 3.3 (qa-agent) — hiyerarşik konteyner (`container`) mimarisi, e2e kapsamı.
 * Kaynak: `.claude/design-notes-page-builder-containers.md` (mimar) + `.claude/design-notes-page-
 * builder-container-ui.md` (ui-designer) + `.claude/design-notes-page-builder-containers.md` §10.17
 * satır ~1027 "3.3 qa-agent" görev tanımı (bağlayıcı, birebir 6 senaryo). v2'nin sabit/esnek
 * `columns` UI'ı bu turda TAMAMEN supersede edildi — eski `admin-page-builder-columns.spec.ts`
 * bu yüzden RETİRE edildi (bkz. o kararın gerekçesi `TEST_COVERAGE.md`'de) ve bu dosya onun yerini
 * DOĞRUDAN devralıyor + mimarın 6 maddelik ek görev listesini (derinlik sınırı, isDescendant guard,
 * legacy fixture parite, unwrap onayı) ekliyor.
 *
 * Fixture deseni `admin-page-builder-gallery.spec.ts` ile TUTARLI (aynı auth/session/host-page
 * yardımcıları, aynı dosya-seviyesi `beforeAll`/`afterAll`).
 */
test.describe.configure({ retries: 1 });

const PAGE_TITLE_PREFIX = "QaE2eContainerPage";
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
  // bkz. `admin-page-builder-gallery.spec.ts::createHostPage` başlığındaki AYNI slug-kırpma bug
  // notu — kısa/kompakt üretim bu turda da pratikte devre dışı bırakır, `created.slug` yine de
  // kaynak-doğruluk olarak kullanılır (savunma derinliği).
  const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 46_656).toString(36)}`;
  const slug = `qa-cnt-${prefix}-${unique}`;
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
  // Fixture'ın çıplak kök `text` bloğu ("b1") artık editör YÜKLENİRKEN otomatik olarak kendi
  // tek-sütunlu konteynerine sarılıyor (bkz. `containers.ts::wrapBareRootBlocks`) — bu yüzden 2
  // sürükle tutamacı (Konteyner + Metin) bekleniyor; konteyneri (içeriğiyle BİRLİKTE) silmek
  // temiz/boş bir sayfa bırakır.
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(2);
  // DİKKAT: `getByRole("button", { name: "Konteyneri sil" })` (substring/varsayılan) KULLANILMAZ
  // — dosyanın başka yerlerindeki AYNI not (bkz. senaryo 2/3) — `ContainerCard`'ın seçim div'i
  // de `role="button"` taşır ve aria adı olmadığı için TÜM iç metni/aria-label'ları (bu düğme
  // dahil) birleştirip ad-içerikten hesaplıyor; `.first()` o zaman İÇ düğme yerine DIŞ seçim
  // div'ini yakalar (tıklama hiçbir şeyi SİLMEZ, yalnızca seçer) — `[aria-label="..."]` öz-nitelik
  // seçicisine geçilir.
  await page.locator('button[aria-label="Konteyneri sil"]').first().click();
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(0);
}

async function saveAndExpectSuccess() {
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Sayfa kaydedildi.").last()).toBeVisible({ timeout: 10_000 });
}

test.describe("Konteyner mimarisi — admin editörü", () => {
  test("1) Layout Picker'dan 'İki Eşit Sütun' ekle → her sütuna blok koy → kaydet → public'te doğrula", async () => {
    test.setTimeout(60_000);
    const { pageId, slug } = await createHostPage("layout-5050", "PUBLISHED");

    try {
      await openEditorAndRemoveDefaultBlock(pageId);

      // Sabit "DÜZEN" paneli kaldırıldı (`.claude/design-notes-page-builder-dynamic-container-
      // insertion.md`) — sayfa TAMAMEN boşken tetikleyici artık boş-durum hero'sunun İÇİNDEKİ
      // "Yeni Konteyner Ekle" düğmesi (`NewContainerInserter variant="empty"`), popover'ı açar;
      // karo tıklaması ("İki Eşit Sütun") aynen kalır — `LayoutPresetTile`'ın aria-label semantiği
      // DEĞİŞMEDİ (§2.2 tasarım notları).
      await page.getByRole("button", { name: "Yeni Konteyner Ekle" }).click();
      await page.getByRole("button", { name: "İki Eşit Sütun" }).click();
      await expect(page.getByText("2 Sütun", { exact: true })).toBeVisible();
      await expect(page.getByText("Buraya blok sürükleyin")).toHaveCount(2);

      const addToEmptyContainer = page.getByRole("button", { name: "Konteynere blok ekle" });

      // İlk sütuna Görsel — "Görsel" "Medya & İnteraktif" kategorisinde, popover varsayılan
      // olarak "Temel Elemanlar" sekmesini gösterir (bkz. `add-content-menu.tsx`) — önce
      // kategori sekmesine geçilir.
      await addToEmptyContainer.nth(0).click();
      await page.getByRole("tab", { name: "Medya & İnteraktif" }).click();
      await page.getByRole("menuitem", { name: "Görsel", exact: true }).click();
      await page.locator('[id$="-url"]').fill("https://example.com/qa-e2e-container-5050-a.png");
      await page.locator('[id$="-alt"]').fill("QA container 50/50 görsel A");

      // Kalan tek boş sütuna (artık index 0) Metin.
      await addToEmptyContainer.nth(0).click();
      await page.getByRole("menuitem", { name: "Metin", exact: true }).click();

      // qa-agent (bu turda düzeltildi) — Metin bloğu artık BOŞ (`data.html === ""`) başlıyor
      // (bkz. `registry.ts::createBlock("text")`, frontend-agent'ın placeholder düzeltmesi);
      // önceden buraya gerçek "<p>Metin girin…</p>" içeriği yazılıyordu ve bu test SADECE bu
      // varsayılan (dokunulmamış) içeriği public sayfada arıyordu. Artık dokunulmamış bir blok
      // public'te GÖRÜNÜR bir metin ÜRETMEZ (kasıtlı — bkz. registry.ts yorumu: eski davranış
      // düzenlenmemiş bir bloğun placeholder-benzeri metni gerçek içerik gibi yayınlamasıydı).
      // Test amacı (iki sütunun yan yana, eşit genişlikte render olduğunu görsel/DOM'dan
      // doğrulamak) DEĞİŞMEDİ — ikinci sütuna GERÇEK bir metin YAZILIR, public'te O metin aranır.
      const textBlockContent = "QA container 50/50 metin B";
      const textEditor = page.locator(".ProseMirror").first();
      await textEditor.click();
      await textEditor.pressSequentially(textBlockContent);
      await expect(textEditor).toContainText(textBlockContent);

      await expect(page.getByText("Buraya blok sürükleyin")).toHaveCount(0);
      await saveAndExpectSuccess();

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.setViewportSize({ width: 1280, height: 900 });
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        const img = publicPage.getByRole("img", { name: "QA container 50/50 görsel A" });
        const text = publicPage.getByText(textBlockContent);
        await expect(img).toBeVisible({ timeout: 15_000 });
        await expect(text).toBeVisible();

        const imgBox = await img.boundingBox();
        const textBox = await text.boundingBox();
        expect(imgBox && textBox).toBeTruthy();
        // Sol Görsel, sağ Metin (dış konteyner `direction: row`, iki sütun `50-50` preset'i).
        expect(imgBox!.x).toBeLessThan(textBox!.x);
        // "İki Eşit Sütun" → widthFr [1,1] → genişlikler yaklaşık EŞİT olmalı.
        expect(Math.abs(imgBox!.width - textBox!.width)).toBeLessThan(60);
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("2) 4 seviye iç içe konteyner kurulabilir, 5. seviye editörde ÖNLEYİCİ olarak ENGELLENİR (MAX_CONTAINER_DEPTH=4)", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("depth-limit", "DRAFT");

    try {
      // Dinamik/pozisyonel ekleme modelinde (`.claude/design-notes-page-builder-dynamic-container-
      // insertion.md`) BOŞ bir konteynerin İÇİNE yeni bir KONTEYNER eklemenin (yalnızca içerik
      // bloğu değil) tek-tık yolu YOK — `BetweenContainersInserter` YALNIZCA 2+ çocuklu dikey
      // listelerde belirir (§4.3), `Alta yeni konteyner ekle` her zaman KARDEŞ ekler (aynı seviye,
      // §5.2), boş bir konteynerin içine yalnızca İÇERİK BLOĞU eklenebilir (`EmptyContainerDropZone`,
      // konteyner DEĞİL). Eski "seç + Tek Sütun'a tekrar tıkla" (seçili konteyneri örtük hedef alan)
      // akışı KALDIRILDI — bu, sıfırdan derinlik kurmanın artık TEK tıkla mümkün olmadığı anlamına
      // gelir; bu bulgu orkestratöre raporlandı (frontend-agent'ın değerlendirmesi gerekir).
      //
      // Bu senaryonun asıl iddiası "4 seviye kurulabilir, 5. ENGELLENİR" — 1-3. seviyeler bu yüzden
      // `patchPageBlocks` fixture'ıyla (senaryo 6 ile AYNI desen, production verisi DEĞİL) önceden
      // kurulur; yalnızca en derin konteynerin (C3) İKİ metin bloğu vardır (between-inserter için
      // gereken minimum), test asıl odağı olan "4. seviye UI'DAN GERÇEK bir tıklamayla eklenir, 5.
      // seviye ÖNLEYİCİ engellenir" iddiasını GERÇEK tıklamalarla doğrular.
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
          id: "qa-depth-c1",
          type: "container",
          settings: col,
          children: [
            {
              id: "qa-depth-c2",
              type: "container",
              settings: col,
              children: [
                {
                  id: "qa-depth-c3",
                  type: "container",
                  settings: col,
                  children: [
                    { id: "qa-depth-tb-a", type: "text", data: { html: "<p>QA derinlik A</p>" } },
                    { id: "qa-depth-tb-b", type: "text", data: { html: "<p>QA derinlik B</p>" } },
                  ],
                },
              ],
            },
          ],
        },
      ]);

      await page.goto(`/admin/pages/${pageId}`);
      await expect(page.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);

      // C1/C2 birer çocuğa sahip (between-inserter 2+ çocuk gerektirir, §4.3) — sayfadaki TEK
      // between-inserter, C3'ün iki metin bloğu arasındakidir; strict-mode/konum belirsizliği YOK.
      const betweenInserter = page.getByRole("button", { name: "Aralarına yeni konteyner ekle" });
      await expect(betweenInserter).toHaveCount(1);

      // Seviye 4 — UI'DAN GERÇEK bir tıklamayla, C3'ün (Seviye 3) çocukları arasına eklenir.
      await betweenInserter.click();
      await page.getByRole("button", { name: "Tek Sütun" }).click();
      await page.keyboard.press("Escape"); // popover seçimden sonra otomatik KAPANMAZ (Popover, DropdownMenu DEĞİL — §2.1)

      await expect(page.locator('button[aria-label="Konteyner ayarları"]')).toHaveCount(4);
      const level4Badge = page.getByText("Seviye 4 · Maks.", { exact: true });
      await expect(level4Badge).toBeVisible();

      // qa-agent (bu turda düzeltildi) — sabit üst kontrol çubuğundaki "Alta yeni konteyner ekle"
      // düğmesi ui-designer v2 tasarımıyla (`.claude/design-notes-page-builder-editing-tools-v2.md`
      // §1.3) KALDIRILDI; aynı sibling-ekleme işlevi artık "•••" (`ContainerMoreMenu`, aria-label
      // "Daha fazla işlem") içindeki `DropdownMenuSub` "Alta Konteyner Ekle" satırında. Seviye 4
      // konteynerinin KENDİ "•••" menüsündeki bu alt-grid'i (`ContainerMoreMenu`'e geçilen
      // `atMaxDepth`, konteynerin KENDİ derinliğinden hesaplı — bkz. `builder-canvas.tsx::
      // ContainerCard`) TAMAMEN devre dışı — editör 5. seviyeyi backend'in 422'sine güvenmeden
      // ÖNLEYİCİ olarak engeller. En yakın `.group` atası (`ContainerCard`'ın kök div'i,
      // `builder-canvas.tsx`) XPath ile bulunur — bu, C1/C2/C3'ün KENDİ "•••" düğmeleriyle (hepsi
      // aynı aria-label'ı taşır) karışmayı önler. `DropdownMenuSubTrigger` varsayılan olarak
      // `openOnHover` (base-ui) — bir gerçek fare tıklaması `ignoreMouse: true` yüzünden YOK
      // SAYILIR, bu yüzden `.hover()` kullanılır (`.click()` DEĞİL).
      const level4Card = level4Badge.locator(
        "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' group ')][1]"
      );
      await level4Card.locator('button[aria-label="Daha fazla işlem"]').click();
      const addBelowSubTrigger = page.getByRole("menuitem", { name: "Alta Konteyner Ekle" });
      await expect(addBelowSubTrigger).toBeVisible();
      // orkestratör bulgusu — ara sıra FLAKY: imleç `.click()`ten hemen sonra menünün civarında
      // durabilir, bu da floating-ui'nin `allowMouseEnter` korumasını (menü imlecin ALTINDA
      // açıldığında yanlışlıkla hover-açılmasını önler) bazen tetiklemeyebilir. İmleç önce menünün
      // DIŞINA taşınıp GERİ getirilerek her seferinde gerçek bir giriş olayı üretilir (bkz.
      // `admin-page-builder-editing-tools.spec.ts`teki AYNI düzeltme).
      await page.mouse.move(0, 0);
      await addBelowSubTrigger.hover();
      const singleColumnTile = page.getByRole("button", { name: "Tek Sütun" });
      await expect(singleColumnTile).toBeVisible();
      await expect(singleColumnTile).toBeDisabled();
      await expect(singleColumnTile).toHaveAttribute("title", "Maksimum iç içe geçme derinliğine ulaşıldı (4)");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      // Devre dışı karo tıklanamaz (native `disabled`) — ağaç DEĞİŞMEDEN kaldığını doğrula.
      await expect(page.locator('button[aria-label="Konteyner ayarları"]')).toHaveCount(4);

      // Editör kilitlenmedi — normal işlem (kaydetme) sorunsuz çalışır.
      await saveAndExpectSuccess();
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});

/**
 * dnd-kit `PointerSensor` bu ortamda ara sıra (~%30) sentetik imleç olaylarını kaçırır — bkz.
 * eski (retire edilmiş) `admin-page-builder-columns.spec.ts`'te ÖNCEDEN belgelenmiş, uygulama
 * kodu DEĞİL bir yerel Windows/Playwright sınırlaması. Aşağıdaki yardımcı AYNI kanıtlanmış
 * adım-adım imleç hareketi desenini kullanır, ancak bu dosyanın 3. senaryosu (`isDescendant`
 * reddi) "hiçbir şey DEĞİŞMEMELİ" iddiası taşıdığı için `dragUntil`'in "değişene kadar tekrar
 * dene" mantığı BURADA UYGUN DEĞİL (sürükleme hiç tetiklenmeden de yanlışlıkla "başarılı"
 * görünürdü). Bunun yerine her denemede dnd-kit'in `DragOverlay`'inin (`ring-primary/40` vurgusu)
 * GERÇEKTEN göründüğünü doğrulayarak sürüklemenin FİİLEN tetiklendiğini kanıtlar; yalnızca sensör
 * aktivasyonu başarısız olursa (overlay hiç görünmezse) yeniden dener.
 */
async function attemptDragOntoAndConfirmStarted(pg: Page, source: Locator, target: Locator, attempts = 4): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const src = await source.boundingBox();
    const dst = await target.boundingBox();
    if (!src || !dst) throw new Error("attemptDragOntoAndConfirmStarted: bounding box bulunamadı");
    const startX = src.x + src.width / 2;
    const startY = src.y + src.height / 2;
    const endX = dst.x + dst.width / 2;
    const endY = dst.y + dst.height / 2;

    await pg.mouse.move(startX, startY);
    await pg.mouse.down();
    await pg.waitForTimeout(100);

    const steps = 12;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      await pg.mouse.move(startX + (endX - startX) * t, startY + (endY - startY) * t);
      await pg.waitForTimeout(40);
    }

    const overlayStarted = await pg
      .locator('[class*="ring-primary/40"]')
      .isVisible()
      .catch(() => false);

    await pg.waitForTimeout(150);
    await pg.mouse.up();
    await pg.waitForTimeout(200);

    if (overlayStarted) return true;
  }
  return false;
}

test.describe("Konteyner mimarisi — sürükle-bırak koruması", () => {
  test("3) Konteyneri kendi çocuğunun içine sürüklemek REDDEDİLİR (isDescendant guard), editör KİLİTLENMEZ", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("descendant-guard", "DRAFT");

    try {
      // Dinamik/pozisyonel ekleme modelinde (`.claude/design-notes-page-builder-dynamic-container-
      // insertion.md`) BOŞ bir konteynerin İÇİNE yeni bir KONTEYNER eklemenin tek-tık yolu YOK —
      // eski "seç + Tek Sütun'a tekrar tıkla" (seçili konteyneri hedef alan) akışı KALDIRILDI (bu
      // bulgu orkestratöre raporlandı). Bu senaryonun asıl odağı sürükle-bırak `isDescendant`
      // guard'ı olduğu için C1/C2 iskeleti `patchPageBlocks` fixture'ıyla (senaryo 6 ile AYNI desen)
      // kurulur — production verisi DEĞİL, bu testin KENDİ ürettiği fixture'ı.
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
          id: "qa-descendant-c1",
          type: "container",
          settings: col,
          children: [{ id: "qa-descendant-c2", type: "container", settings: col, children: [] }],
        },
      ]);

      await page.goto(`/admin/pages/${pageId}`);
      await expect(page.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);

      // Hiçbir konteyner SEÇİLMEDİĞİ için (bu testte `onSelectContainer` hiç tetiklenmez)
      // `ContainerSettingsPanel`'in AYRI bir "Seviye N" rozeti render ETMEZ — tek eşleşme beklenir.
      await expect(page.getByText("Seviye 1", { exact: true })).toBeVisible();
      await expect(page.getByText("Seviye 2", { exact: true })).toBeVisible();
      await expect(page.getByText("Buraya blok sürükleyin")).toHaveCount(1); // yalnızca C2 boş

      const c1Handle = page.locator('button[aria-label="Sürükle: Konteyner"]').first(); // DOM sırası: C1 önce
      const c2EmptyDropzone = page.getByText("Buraya blok sürükleyin");

      const dragActuallyStarted = await attemptDragOntoAndConfirmStarted(page, c1Handle, c2EmptyDropzone);
      // Sürükleme GERÇEKTEN tetiklendiğini kanıtla — aksi halde "hiçbir şey değişmedi" iddiası
      // yalnızca sensörün hiç aktive OLMAMASINDAN kaynaklanan sahte bir başarı olurdu.
      expect(dragActuallyStarted).toBe(true);

      // Guard (`isDescendant`, C2 → C1'in torunu) reddettiği için ağaç DEĞİŞMEDEN kaldı: C1 hâlâ
      // C2'yi sarmalıyor, C2 hâlâ boş, hiçbir düğüm kaybolmadı/kopyalanmadı.
      await expect(page.locator('button[aria-label="Sürükle: Konteyner"]')).toHaveCount(2);
      await expect(page.getByText("Seviye 1", { exact: true })).toBeVisible();
      await expect(page.getByText("Seviye 2", { exact: true })).toBeVisible();
      await expect(page.getByText("Buraya blok sürükleyin")).toHaveCount(1);

      // Editör kilitlenmedi/çökmedi — reddedilen sürüklemeden SONRA normal işlem sorunsuz çalışır.
      await saveAndExpectSuccess();
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});

/**
 * "Legacy fixture" senaryosu — `setRawPageBlocksDirectly` KULLANIR (bkz. `support/api.ts`
 * başlığındaki gerekçe): `PATCH /admin/pages/{id}` (dolayısıyla `patchPageBlocks`) her zaman
 * backend'in yazma-anındaki `z.preprocess`'inden geçer ve `columns`'ı ANINDA `container`'a çevirip
 * ÖYLE YAZAR — yani normal API akışıyla "DB'de hâlâ columns duran" bir satır ÜRETİLEMEZ. Bu, v3
 * migration'ından ÖNCE (eski bir istemciyle) kaydedilmiş ve o zamandan beri hiç dokunulmamış GERÇEK
 * bir tarihi satırı simüle etmenin TEK yoludur.
 */
test.describe("Konteyner mimarisi — legacy fixture parite ve migration", () => {
  test("4) v1 (ratio) + v2 (width) legacy fixture — dokunmadan public render oranı korur; kayıt sonrası container'a döner", async () => {
    test.setTimeout(60_000);
    const { pageId, slug } = await createHostPage("legacy-fixture", "PUBLISHED");

    try {
      const legacyBlocks = [
        {
          id: "qa-legacy-v1",
          type: "columns",
          data: {
            columnCount: 2,
            ratio: "2-1", // v1 — oran metinden, per-column `width` YOK.
            gap: "md",
            verticalAlign: "top",
            columns: [
              {
                id: "qa-legacy-v1-col-a",
                blocks: [
                  { id: "qa-legacy-v1-img-a", type: "image", data: { url: "https://example.com/qa-legacy-v1-a.png", alt: "QA legacy v1 görsel A" } },
                ],
              },
              {
                id: "qa-legacy-v1-col-b",
                blocks: [
                  { id: "qa-legacy-v1-img-b", type: "image", data: { url: "https://example.com/qa-legacy-v1-b.png", alt: "QA legacy v1 görsel B" } },
                ],
              },
            ],
          },
        },
        {
          id: "qa-legacy-v2",
          type: "columns",
          data: {
            columnCount: 2,
            gap: "sm",
            verticalAlign: "center", // ratio YOK, per-column `width` VAR — v2 şekli.
            columns: [
              {
                id: "qa-legacy-v2-col-a",
                width: 3,
                blocks: [
                  { id: "qa-legacy-v2-img-a", type: "image", data: { url: "https://example.com/qa-legacy-v2-a.png", alt: "QA legacy v2 görsel A" } },
                ],
              },
              {
                id: "qa-legacy-v2-col-b",
                width: 1,
                blocks: [
                  { id: "qa-legacy-v2-img-b", type: "image", data: { url: "https://example.com/qa-legacy-v2-b.png", alt: "QA legacy v2 görsel B" } },
                ],
              },
            ],
          },
        },
      ];
      setRawPageBlocksDirectly(pageId, legacyBlocks);

      // Kaydetmeden ÖNCE — API yanıtı hâlâ HAM legacy şekli taşıyor ("dokunulmadı" kanıtı).
      const beforeTouch = await getPage(token, pageId);
      expect(JSON.stringify(beforeTouch.blocks)).toContain('"type":"columns"');

      // Public render — DOKUNMADAN (yalnızca GET/SSR), oran/genişlik korunmalı.
      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.setViewportSize({ width: 1280, height: 900 });
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);

        const v1A = publicPage.getByRole("img", { name: "QA legacy v1 görsel A" });
        const v1B = publicPage.getByRole("img", { name: "QA legacy v1 görsel B" });
        await expect(v1A).toBeVisible({ timeout: 15_000 });
        await expect(v1B).toBeVisible();
        const v1ABox = await v1A.boundingBox();
        const v1BBox = await v1B.boundingBox();
        expect(v1ABox && v1BBox).toBeTruthy();
        // v1 `ratio: "2-1"` → widthFr [2,1] → A, B'nin yaklaşık 2 katı genişlikte.
        const v1Ratio = v1ABox!.width / v1BBox!.width;
        expect(v1Ratio).toBeGreaterThan(1.5);
        expect(v1Ratio).toBeLessThan(2.5);

        const v2A = publicPage.getByRole("img", { name: "QA legacy v2 görsel A" });
        const v2B = publicPage.getByRole("img", { name: "QA legacy v2 görsel B" });
        await expect(v2A).toBeVisible();
        await expect(v2B).toBeVisible();
        const v2ABox = await v2A.boundingBox();
        const v2BBox = await v2B.boundingBox();
        expect(v2ABox && v2BBox).toBeTruthy();
        // v2 `width` [3,1] → A, B'nin yaklaşık 3 katı genişlikte.
        const v2Ratio = v2ABox!.width / v2BBox!.width;
        expect(v2Ratio).toBeGreaterThan(2.3);
        expect(v2Ratio).toBeLessThan(3.7);
      } finally {
        await publicContext.close();
      }

      // Sonra kaydet — EDİTÖR ÜZERİNDEN (herhangi bir alanı değiştir): frontend `normalizePageNodes`
      // ile okuma-anında container'a çevrilmiş ağacı, olduğu gibi backend'e geri gönderir.
      await page.goto(`/admin/pages/${pageId}`);
      await expect(page.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);
      await page.locator("#title").fill(`${PAGE_TITLE_PREFIX} legacy-fixture (dokunuldu)`);
      await saveAndExpectSuccess();

      const afterTouch = await getPage(token, pageId);
      const serialized = JSON.stringify(afterTouch.blocks);
      expect(serialized).not.toContain('"type":"columns"');
      // 2 legacy `columns` bloğu → her biri 1 dış + 2 iç sütun konteyneri = 3 konteyner × 2 = 6.
      expect((serialized.match(/"type":"container"/g) ?? []).length).toBe(6);
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});

test.describe("Konteyner mimarisi — unwrap onayı", () => {
  test("5) Unwrap onay diyaloğu — Vazgeç'te hiçbir şey değişmez, onaylanınca içerik KAYBOLMADAN üst seviyeye düzleşir", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("unwrap-confirm", "DRAFT");

    try {
      await openEditorAndRemoveDefaultBlock(pageId);

      // Sabit "DÜZEN" paneli kaldırıldı (`.claude/design-notes-page-builder-dynamic-container-
      // insertion.md`) — sayfa TAMAMEN boşken tetikleyici artık boş-durum hero'sunun İÇİNDEKİ
      // "Yeni Konteyner Ekle" düğmesi, popover'ı açar; karo tıklaması aynen kalır.
      await page.getByRole("button", { name: "Yeni Konteyner Ekle" }).click();
      await page.getByRole("button", { name: "Tek Sütun" }).click();
      await expect(page.getByText("Buraya blok sürükleyin")).toBeVisible();

      await page.getByRole("button", { name: "Konteynere blok ekle" }).click();
      await page.getByRole("tab", { name: "Medya & İnteraktif" }).click();
      await page.getByRole("menuitem", { name: "Görsel", exact: true }).click();
      await page.locator('[id$="-url"]').fill("https://example.com/qa-e2e-unwrap-image.png");
      await page.locator('[id$="-alt"]').fill("QA unwrap görseli");

      await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(2); // Konteyner + Görsel

      // qa-agent (bu turda düzeltildi) — `ContainerCard`'ın KENDİ "Düzen" (`LayoutMenu
      // mode="unwrap"`) tetikleyicisi ui-designer v2 tasarımıyla (§1.3) KALDIRILDI; "Konteyneri
      // Kaldır" artık doğrudan "•••" (`ContainerMoreMenu`, aria-label "Daha fazla işlem") içinde bir
      // `DropdownMenuItem`. (`ContentBlockCard`'ın KENDİ `LayoutMenu mode="wrap"` "Düzen" tetikleyicisi
      // DEĞİŞMEDİ — o burada KULLANILMIYOR, yalnızca konteyner kartının "•••" menüsü hedeflenir.)
      // Sayfada tek konteyner olduğu için `.first()` yeterli/güvenli.
      const moreMenuTrigger = page.locator('button[aria-label="Daha fazla işlem"]').first();

      // --- Vazgeç akışı — hiçbir şey değişmemeli ---
      await moreMenuTrigger.click();
      await page.getByRole("menuitem", { name: "Konteyneri Kaldır" }).click();
      await expect(page.getByRole("heading", { name: "Konteyner kaldırılsın mı?" })).toBeVisible();
      await expect(page.getByText("İçindeki 1 öğe, sırasıyla üst seviyeye taşınacak. İçerik SİLİNMEZ.")).toBeVisible();

      await page.getByRole("button", { name: "Vazgeç" }).click();
      await expect(page.getByRole("heading", { name: "Konteyner kaldırılsın mı?" })).toHaveCount(0);
      await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(2); // DEĞİŞMEDİ
      await expect(page.getByText("Buraya blok sürükleyin")).toHaveCount(0); // konteyner hâlâ dolu
      await expect(page.locator('[id$="-alt"]')).toHaveValue("QA unwrap görseli"); // içerik SAĞLAM

      // --- Onayla akışı — konteyner kalkar, İÇERİK KORUNUR (üst seviyeye düzleşir) ---
      await moreMenuTrigger.click();
      await page.getByRole("menuitem", { name: "Konteyneri Kaldır" }).click();
      await expect(page.getByRole("heading", { name: "Konteyner kaldırılsın mı?" })).toBeVisible();
      await page.getByRole("button", { name: "Konteyneri Kaldır" }).click(); // dialog'un ONAY butonu (role farklı, menuitem DEĞİL)

      await expect(page.getByRole("heading", { name: "Konteyner kaldırılsın mı?" })).toHaveCount(0);
      await expect(page.locator('button[aria-label^="Sürükle: Konteyner"]')).toHaveCount(0); // konteyner GİTTİ
      await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(1); // yalnızca Görsel kaldı
      await expect(page.locator('[id$="-url"]')).toHaveValue("https://example.com/qa-e2e-unwrap-image.png"); // veri SAĞLAM
      await expect(page.locator('[id$="-alt"]')).toHaveValue("QA unwrap görseli");

      await saveAndExpectSuccess();

      // Kalıcılık — sayfa YENİDEN açıldığında (taze GET) içerik hâlâ korunur. Unwrap edilmiş
      // (artık SUNUCUDA kökte çıplak duran) Görsel bloğu, editörün "içerik her zaman bir
      // konteyner içindedir" göç kuralı gereği (bkz. `containers.ts::wrapBareRootBlocks`) KENDİ
      // yeni tek-sütunlu konteynerine sarılmış olarak gösterilir — bu, KALDIRILAN eski
      // konteynerin "geri gelmesi" DEĞİL, salt editör-seviyesi bir göç görünümüdür (veri hâlâ
      // sunucuda çıplak duruyor, yalnızca bir sonraki kayıtta yeniden sarılmış kalıcı olur).
      await page.goto(`/admin/pages/${pageId}`);
      await expect(page.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);
      await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(2); // Konteyner (göç) + Görsel
      await expect(page.locator('[id$="-alt"]')).toHaveValue("QA unwrap görseli");
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});

/** §6.2 mimar dokümanı — `direction: "row"` HER ZAMAN `flex-col md:flex-row`'a çevrilir; `md`
 *  (768px) altında JS'siz, salt CSS ile otomatik yığılma. UI DIŞINDAN (`patchPageBlocks`, container
 *  şekli GERÇEK bir yazma yolundan geçtiği için `columns` gibi bir dönüşüme TABİ DEĞİL) kurulur. */
test.describe("Konteyner mimarisi — public render, mobil yığılma", () => {
  test("6) Mobil viewport'ta direction:'row' konteyner alt alta yığılır (flex-col taban, md:flex-row)", async () => {
    test.setTimeout(60_000);
    const { pageId, slug } = await createHostPage("mobile-stack", "PUBLISHED");

    try {
      const columnSettings = (widthFr: number) => ({
        layout: "full-width" as const,
        direction: "column" as const,
        justifyContent: "start" as const,
        alignItems: "stretch" as const,
        gap: 16,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        background: { type: "none" as const },
        widthFr,
      });

      await patchPageBlocks(token, pageId, [
        {
          id: "qa-mobile-row",
          type: "container",
          settings: {
            layout: "boxed",
            direction: "row",
            justifyContent: "start",
            alignItems: "stretch",
            gap: 16,
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
            background: { type: "none" },
          },
          children: [
            {
              id: "qa-mobile-col-a",
              type: "container",
              settings: columnSettings(1),
              children: [{ id: "qa-mobile-img-a", type: "image", data: { url: "https://example.com/qa-mobile-a.png", alt: "QA mobil yığılma A" } }],
            },
            {
              id: "qa-mobile-col-b",
              type: "container",
              settings: columnSettings(1),
              children: [{ id: "qa-mobile-img-b", type: "image", data: { url: "https://example.com/qa-mobile-b.png", alt: "QA mobil yığılma B" } }],
            },
          ],
        },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.setViewportSize({ width: 1280, height: 900 });
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        const imgA = publicPage.getByRole("img", { name: "QA mobil yığılma A" });
        const imgB = publicPage.getByRole("img", { name: "QA mobil yığılma B" });
        await expect(imgA).toBeVisible({ timeout: 15_000 });
        await expect(imgB).toBeVisible();

        const desktopA = await imgA.boundingBox();
        const desktopB = await imgB.boundingBox();
        expect(desktopA && desktopB).toBeTruthy();
        // Masaüstü: yan yana — A solda, dikey konumları büyük ölçüde ÇAKIŞIYOR (aynı satır).
        expect(desktopA!.x).toBeLessThan(desktopB!.x);
        expect(Math.abs(desktopA!.y - desktopB!.y)).toBeLessThan(60);

        // Mobil: `md` kırılma noktasının ALTINA in — `flex-col` tabanı otomatik alt alta düşürür.
        await publicPage.setViewportSize({ width: 375, height: 800 });
        await publicPage.reload();
        await expect(imgA).toBeVisible({ timeout: 15_000 });
        await expect(imgB).toBeVisible();
        const mobileA = await imgA.boundingBox();
        const mobileB = await imgB.boundingBox();
        expect(mobileA && mobileB).toBeTruthy();
        // B artık A'nın ALTINDA (üst kenarı A'nın alt kenarından aşağıda).
        expect(mobileB!.y).toBeGreaterThanOrEqual(mobileA!.y + mobileA!.height - 5);
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});
