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

      await expect(page.getByText("Buraya blok sürükleyin")).toHaveCount(0);
      await saveAndExpectSuccess();

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.setViewportSize({ width: 1280, height: 900 });
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        const img = publicPage.getByRole("img", { name: "QA container 50/50 görsel A" });
        const text = publicPage.getByText("Metin girin…");
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
      await openEditorAndRemoveDefaultBlock(pageId);

      // DİKKAT: `getByRole("button", { name: "Konteyner ayarları" })` (substring/varsayılan)
      // KULLANILMAZ — `ContainerCard`'ın başlık şeridi kendisi de `role="button"` taşır (seçim
      // için tıklanabilir alan, bkz. `builder-canvas.tsx`) ve aria adı yok olduğu için tarayıcı
      // BÜTÜN iç metni/etiketleri (sürükle tutamacının "Sürükle: Konteyner"'ı, "Konteyner ayarları"
      // dahil) birleştirip ad-içerikten hesaplıyor — yani substring eşleşmesi HEM dış seçim div'ini
      // HEM iç "Ayarlar" ikon butonunu birlikte YAKALAR (qa-agent'ın bu testi yazarken bizzat
      // bulduğu yanlış-pozitif — bkz. `[aria-label="..."]` CSS öz-nitelik seçicisine geçiş).
      const settingsBtn = page.locator('button[aria-label="Konteyner ayarları"]');
      const singleColumnTile = page.getByRole("button", { name: "Tek Sütun" });

      // Seviye 1 — kök dizine.
      await singleColumnTile.click();
      await expect(settingsBtn).toHaveCount(1);
      await settingsBtn.nth(0).click();
      await expect(page.getByText("Ekleniyor: Konteyner (Seviye 1)")).toBeVisible();

      // Seviye 2 — Seviye 1 seçiliyken içine.
      await singleColumnTile.click();
      await expect(settingsBtn).toHaveCount(2);
      await settingsBtn.nth(1).click();
      await expect(page.getByText("Ekleniyor: Konteyner (Seviye 2)")).toBeVisible();

      // Seviye 3.
      await singleColumnTile.click();
      await expect(settingsBtn).toHaveCount(3);
      await settingsBtn.nth(2).click();
      await expect(page.getByText("Ekleniyor: Konteyner (Seviye 3)")).toBeVisible();

      // Seviye 4 — maksimum.
      await singleColumnTile.click();
      await expect(settingsBtn).toHaveCount(4);
      await settingsBtn.nth(3).click();
      await expect(page.getByText("Ekleniyor: Konteyner (Seviye 4)")).toBeVisible();

      await expect(page.getByText("Seviye 4 · Maks.", { exact: true }).first()).toBeVisible();

      // Layout Picker karoları Seviye 4 konteyneri seçiliyken TAMAMI devre dışı — editör
      // 5. seviyeyi backend'in 422'sine güvenmeden ÖNLEYİCİ olarak engeller (ui-designer §3.1).
      await expect(singleColumnTile).toBeDisabled();
      await expect(singleColumnTile).toHaveAttribute("title", "Maksimum iç içe geçme derinliğine ulaşıldı (4)");

      // Devre dışı karo tıklanamaz (native `disabled`) — ağaç DEĞİŞMEDEN kaldığını doğrula.
      await expect(settingsBtn).toHaveCount(4);

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
      await openEditorAndRemoveDefaultBlock(pageId);

      // bkz. yukarıdaki senaryo 2'deki AYNI not — `[aria-label="..."]` öz-nitelik seçicisi kullanılır.
      const settingsBtn = page.locator('button[aria-label="Konteyner ayarları"]');
      const singleColumnTile = page.getByRole("button", { name: "Tek Sütun" });

      // C1 (Seviye 1, kök) → seç → içine C2 (Seviye 2, boş) ekle.
      await singleColumnTile.click();
      await expect(settingsBtn).toHaveCount(1);
      await settingsBtn.nth(0).click();
      await singleColumnTile.click();
      await expect(settingsBtn).toHaveCount(2);

      // `exact: true` ZORUNLU — "Ekleniyor: Konteyner (Seviye 1)" bağlam satırı da alt dize
      // olarak "Seviye 1"İ İÇERİR, exact olmadan iki AYRI (iç içe olmayan) eşleşme = strict-mode
      // ihlali. `.first()` de GEREKLİ — C1 seçiliyken sağ panel (`ContainerSettingsPanel`) KENDİ
      // "Seviye 1" rozetini AYRICA render eder (canvas kartındaki rozetle birebir aynı metin/sınıf),
      // yani iki adet "Seviye 1" span'ı BEKLENEN bir durumdur.
      await expect(page.getByText("Seviye 1", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Seviye 2", { exact: true }).first()).toBeVisible();
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
      // `exact: true` ZORUNLU — "Ekleniyor: Konteyner (Seviye 1)" bağlam satırı da alt dize
      // olarak "Seviye 1"İ İÇERİR, exact olmadan iki AYRI (iç içe olmayan) eşleşme = strict-mode
      // ihlali. `.first()` de GEREKLİ — C1 seçiliyken sağ panel (`ContainerSettingsPanel`) KENDİ
      // "Seviye 1" rozetini AYRICA render eder (canvas kartındaki rozetle birebir aynı metin/sınıf),
      // yani iki adet "Seviye 1" span'ı BEKLENEN bir durumdur.
      await expect(page.getByText("Seviye 1", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Seviye 2", { exact: true }).first()).toBeVisible();
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

      await page.getByRole("button", { name: "Tek Sütun" }).click();
      await expect(page.getByText("Buraya blok sürükleyin")).toBeVisible();

      await page.getByRole("button", { name: "Konteynere blok ekle" }).click();
      await page.getByRole("tab", { name: "Medya & İnteraktif" }).click();
      await page.getByRole("menuitem", { name: "Görsel", exact: true }).click();
      await page.locator('[id$="-url"]').fill("https://example.com/qa-e2e-unwrap-image.png");
      await page.locator('[id$="-alt"]').fill("QA unwrap görseli");

      await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(2); // Konteyner + Görsel

      // Konteynerin KENDİ "Düzen" tetikleyicisi DOM'da İLK sırada (çocuğundan ÖNCE render edilir).
      // `[aria-label="Düzen"]` öz-nitelik seçicisi kullanılır — senaryo 2/3'teki AYNI gerekçe
      // (`ContainerCard`'ın seçim div'i `role="button"`, ad-içerikten hesaplanan adı "Düzen"i
      // alt dize olarak İÇERİR).
      const layoutMenuTrigger = page.locator('button[aria-label="Düzen"]').first();

      // --- Vazgeç akışı — hiçbir şey değişmemeli ---
      await layoutMenuTrigger.click();
      await page.getByRole("menuitem", { name: "Konteyneri Kaldır" }).click();
      await expect(page.getByRole("heading", { name: "Konteyner kaldırılsın mı?" })).toBeVisible();
      await expect(page.getByText("İçindeki 1 öğe, sırasıyla üst seviyeye taşınacak. İçerik SİLİNMEZ.")).toBeVisible();

      await page.getByRole("button", { name: "Vazgeç" }).click();
      await expect(page.getByRole("heading", { name: "Konteyner kaldırılsın mı?" })).toHaveCount(0);
      await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(2); // DEĞİŞMEDİ
      await expect(page.getByText("Buraya blok sürükleyin")).toHaveCount(0); // konteyner hâlâ dolu
      await expect(page.locator('[id$="-alt"]')).toHaveValue("QA unwrap görseli"); // içerik SAĞLAM

      // --- Onayla akışı — konteyner kalkar, İÇERİK KORUNUR (üst seviyeye düzleşir) ---
      await layoutMenuTrigger.click();
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
