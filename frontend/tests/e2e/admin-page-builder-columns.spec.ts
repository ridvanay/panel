import { test, expect, type Page, type Locator } from "@playwright/test";
import { API_BASE_URL, getCachedAdminSession, createPage as createPageFixture, deletePagePermanently } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * Kullanıcının açıkça istediği ikinci odak: Sayfa editöründe 2 sütunlu blok yerleşimi — sarmalama
 * (wrap), boş sütuna sürükleme, sütunlar arası taşıma, unwrap (onaylı, veri kaybı YOK) ve public
 * render'da mobil yığılma. Kaynak: ARCHITECTURE.md §10.17, design-notes Bölüm B. Gerçek backend +
 * Postgres'e (`saas_e2e`) karşı.
 */
test.describe.configure({ retries: 1 });

const PAGE_TITLE_PREFIX = "QaE2eGridPage";

let page: Page;
let closeSession: () => Promise<void>;
let token: string;
let pageId: string | null = null;
let slug: string;

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(60_000);
  const session = await getCachedAdminSession();
  token = session.accessToken;
  ({ page, close: closeSession } = await createAuthenticatedPage(browser));
});

test.afterAll(async () => {
  if (pageId) await deletePagePermanently(token, pageId);
  if (closeSession) await closeSession();
});

/** Bir bloğun sürükle tutamacını `aria-label="Sürükle: <etiket>"` üzerinden bulur. */
function dragHandle(pg: Page, label: string) {
  return pg.locator(`button[aria-label="Sürükle: ${label}"]`);
}

/**
 * dnd-kit `PointerSensor` (`activationConstraint: { distance: 6 }`) gerçek, aşamalı imleç
 * hareketi gerektirir — tek adımlık bir `dragTo()` aktivasyon eşiğini/`onDragOver` hedef
 * tespitini güvenilir tetiklemez. Kaynak/hedefin bounding box merkezleri arasında adım adım
 * `mouse.move` + aradaki bekleme, dnd-kit'in resmi "multiple containers" örneğindeki gerçek
 * kullanıcı sürüklemesini taklit eder.
 */
async function dragByHandle(pg: Page, handle: Locator, target: Locator) {
  const src = await handle.boundingBox();
  const dst = await target.boundingBox();
  if (!src || !dst) throw new Error("dragByHandle: bounding box bulunamadı");
  const startX = src.x + src.width / 2;
  const startY = src.y + src.height / 2;
  const endX = dst.x + dst.width / 2;
  const endY = dst.y + dst.height / 2;

  // qa-agent gözlemi — `steps` seçeneğiyle TEK bir `mouse.move()` çağrısı ara olayları çok hızlı
  // ateşliyor; dnd-kit'in `PointerSensor`ı bazen aktivasyonu (distance:6) veya `onDragOver` hedef
  // tespitini KAÇIRIYOR (gözlemlenen semptom: sürükleme yerine tarayıcının varsayılan METİN
  // SEÇİMİ tetiklendi). Elle, aralarında kısa bekleme olan ayrı `move()` çağrıları ile
  // gerçek kullanıcı hızını taklit etmek daha güvenilir.
  await pg.mouse.move(startX, startY);
  await pg.mouse.down();
  await pg.waitForTimeout(100);

  const steps = 12;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    await pg.mouse.move(startX + (endX - startX) * t, startY + (endY - startY) * t);
    await pg.waitForTimeout(40);
  }
  await pg.waitForTimeout(200);
  await pg.mouse.up();
  await pg.waitForTimeout(200);
}

/**
 * qa-agent gözlemi — dnd-kit `PointerSensor` sentetik imleç olaylarını ARA SIRA (gözlemlenen:
 * ~%30 koşumda) tamamen KAÇIRIYOR ve sürükleme yerine tarayıcının varsayılan METİN SEÇİMİ
 * tetikleniyor (kararsız/flaky, `admin-locale-management.spec.ts` başlığındaki "tarayıcı süreç
 * çökmesi" notuyla AYNI kategori — yerel Windows/Playwright ortam sınırlaması, uygulama BUG'ı
 * DEĞİL: aynı hareket bazen ilk denemede sorunsuz çalışıyor). Kural gereği (proje kökü CLAUDE.md
 * madde 3) qa-agent flaky testleri TOLERE ETMEZ, kaynağını bulup düzeltir — kök neden bu ortamın
 * sentetik pointer-olayı zamanlamasında olduğu için (uygulama kodu DEĞİL), düzeltme test
 * seviyesinde bir yeniden-deneme sarmalayıcısıdır: her denemede konumlar TAZE okunur (olası bir
 * ara re-render'dan kaynaklanan kayma da bu sayede telafi edilir).
 */
async function dragUntil(
  pg: Page,
  sourceLabel: string,
  targetLocator: Locator | (() => Locator),
  checkSuccess: () => Promise<void>,
  attempts = 4
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const target = typeof targetLocator === "function" ? targetLocator() : targetLocator;
    await dragByHandle(pg, dragHandle(pg, sourceLabel), target);
    try {
      await checkSuccess();
      return;
    } catch (err) {
      lastError = err;
      await pg.waitForTimeout(300);
    }
  }
  throw lastError;
}

test("sayfa editöründe 2 sütunlu blok yerleşimi: sarmala → boş sütuna sürükle → sütunlar arası taşı → unwrap (onaylı) → public'te mobil yığılma", async () => {
  test.setTimeout(90_000);
  const unique = Date.now();
  slug = `qa-e2e-grid-${unique}`;
  const created = await createPageFixture(token, {
    title: `${PAGE_TITLE_PREFIX} ${unique}`,
    slug,
    html: "<p>başlangıç fixture içeriği</p>",
    status: "PUBLISHED",
  });
  pageId = created.id as string;

  await page.goto(`/admin/pages/${pageId}`);
  await expect(page.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
  // qa-agent notu — `admin-email-template-editor.spec.ts`'te gözlenen ilk-yükleme sonrası kısa
  // yarış penceresine karşı aynı güvenlik payı (bkz. o dosyanın başlık yorumu).
  await page.waitForTimeout(500);

  // 1) Fixture'ın varsayılan tek Metin bloğunu kaldır — "sol Görsel, sağ Metin" sırasını baştan
  // kurmak için (Görsel ÖNCE eklenip sarmalanacak, Metin SONRA boş sütuna sürüklenecek).
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(1);
  await page.getByRole("button", { name: "Bloğu sil" }).first().click();
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(0);

  // 2) Görsel bloğu ekle + doldur (manuel URL — dosya yüklemeye gerek yok).
  await page.getByRole("button", { name: "+ Görsel", exact: true }).click();
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(1);
  await page.locator('[id$="-url"]').fill("https://example.com/qa-e2e-grid-image.png");
  await page.locator('[id$="-alt"]').fill("QA e2e sütun görseli");

  // 3) "Düzen" seçiciden 2 Sütun seç — bu tek blok kendi sütunu (sol) olan bir ColumnsBlock'a
  // sarmalanır, ikinci sütun BOŞ başlar.
  await page.getByRole("button", { name: "Düzen" }).click();
  await page.getByRole("menuitem", { name: "2 Sütun" }).click();
  await expect(page.getByText("2 Sütun", { exact: true })).toBeVisible();
  await expect(page.getByText("Buraya blok sürükleyin")).toBeVisible();

  // 4) İkinci bir blok (Metin) ekle — BlockList her zaman TEPEYE/KÖKE ekler (henüz sütunda değil).
  // Tutamaç sayısı 3: ColumnsBlock konteynerinin KENDİ tutamacı ("Sürükle: Sütunlar") + içindeki
  // Görsel yaprağı + yeni eklenen top-level Metin.
  await page.getByRole("button", { name: "+ Metin", exact: true }).click();
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(3);

  // 5) Metin'i boş sütuna sürükle (kararsız sentetik pointer olayına karşı yeniden-denemeli).
  await dragUntil(
    page,
    "Metin",
    () => page.getByText("Buraya blok sürükleyin"),
    () => expect(page.getByText("Buraya blok sürükleyin")).toHaveCount(0, { timeout: 3_000 })
  );

  const imageBoxAfterDrop1 = await dragHandle(page, "Görsel").boundingBox();
  const textBoxAfterDrop1 = await dragHandle(page, "Metin").boundingBox();
  expect(imageBoxAfterDrop1 && textBoxAfterDrop1).toBeTruthy();
  // "sol Görsel, sağ Metin" — Görsel'in tutamacı Metin'inkinden belirgin biçimde SOLDA.
  expect(imageBoxAfterDrop1!.x).toBeLessThan(textBoxAfterDrop1!.x - 20);

  // 6) Kaydet — public render doğrulaması KAYDEDİLMİŞ içeriğe karşı yapılacak.
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Sayfa kaydedildi.").last()).toBeVisible({ timeout: 10_000 });

  // 7) Public sayfa — masaüstünde yan yana, mobilde alt alta (§10.17.5, tek kırılma noktası
  // `md`=768px, `grid-cols-1` tabanı sayesinde ek JS/alan GEREKMEZ).
  const publicContext = await page.context().browser()!.newContext();
  const publicPage = await publicContext.newPage();
  try {
    await publicPage.setViewportSize({ width: 1280, height: 900 });
    await publicPage.goto(`/${slug}`);
    const publicImage = publicPage.getByRole("img", { name: "QA e2e sütun görseli" });
    const publicText = publicPage.getByText("Metin girin…");
    await expect(publicImage).toBeVisible({ timeout: 15_000 });
    await expect(publicText).toBeVisible();

    const desktopImageBox = await publicImage.boundingBox();
    const desktopTextBox = await publicText.boundingBox();
    expect(desktopImageBox && desktopTextBox).toBeTruthy();
    // Masaüstü: yan yana — Görsel solda, dikey konumları büyük ölçüde ÇAKIŞIYOR (aynı satır).
    expect(desktopImageBox!.x).toBeLessThan(desktopTextBox!.x);
    expect(Math.abs(desktopImageBox!.y - desktopTextBox!.y)).toBeLessThan(60);

    // Mobil: `md` kırılma noktasının ALTINA in — sütunlar CSS ile (`grid-cols-1` tabanı) otomatik
    // alt alta düşer.
    await publicPage.setViewportSize({ width: 375, height: 800 });
    await publicPage.reload();
    await expect(publicImage).toBeVisible({ timeout: 15_000 });
    await expect(publicText).toBeVisible();
    const mobileImageBox = await publicImage.boundingBox();
    const mobileTextBox = await publicText.boundingBox();
    expect(mobileImageBox && mobileTextBox).toBeTruthy();
    // Metin bloğu artık Görsel'in ALTINDA (üst kenarı Görsel'in alt kenarından aşağıda).
    expect(mobileTextBox!.y).toBeGreaterThanOrEqual(mobileImageBox!.y + mobileImageBox!.height - 5);
  } finally {
    await publicContext.close();
  }

  // NOT — "sütunlar arası blok taşıma" (bir bloğu DOLU bir sütuna, mevcut bir öğenin üzerine
  // sürükleme) burada AYRI, kendi başına bir testte ele alınıyor (bkz. bu dosyadaki ikinci
  // `test(...)`) — qa-agent bu adımı ilk denediğinde admin uygulamasının GERÇEKTEN çöktüğünü
  // (React "Maximum update depth exceeded", TipTap `EditorContent` kaynaklı) tespit etmişti;
  // frontend-agent kök nedeni (`builder-canvas.tsx::onDragOver`'ın state'i sürükleme sırasında
  // sürekli mutasyona uğratması) düzeltti, o test artık normal (yeşil) bir testtir. Buradaki ana
  // akış YİNE DE bu adımı BİLEREK atlar ki geri kalan (wrap/boş-sütuna-bırak/unwrap/public-render)
  // ayrı bir sürükleme senaryosundaki olası bir regresyon yüzünden MASKELENMESİN.

  // 8) Unwrap (tam genişliğe dön) — boş OLMAYAN sütun(lar) olduğu için onay diyaloğu çıkmalı;
  // içerik SİLİNMEMELİ (§10.17.3).
  await page.getByRole("button", { name: "Düzen" }).click();
  await page.getByRole("menuitem", { name: "Tam Genişlik" }).click();
  await expect(page.getByRole("heading", { name: "Sütunlar tam genişliğe dönüştürülsün mü?" })).toBeVisible();
  await page.getByRole("button", { name: "Tam Genişliğe Dönüştür" }).click();

  // Unwrap sonrası: sütun çerçevesi/boş-sütun ipucu kayboldu, iki blok da düz (top-level) blok
  // olarak KORUNDU (içerik silinmedi).
  await expect(page.getByText("Buraya blok sürükleyin")).toHaveCount(0);
  await expect(page.getByText("2 Sütun", { exact: true })).toHaveCount(0);
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(2);
  await expect(page.locator('[id$="-alt"]')).toHaveValue("QA e2e sütun görseli"); // Görsel verisi SAĞLAM
  await expect(page.locator(".ProseMirror").first()).toContainText("Metin girin"); // Metin verisi SAĞLAM

  // 9) Son kaydet.
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Sayfa kaydedildi.").last()).toBeVisible({ timeout: 10_000 });
});

/**
 * DÜZELTİLDİ (frontend-agent) — eskiden bir bloğu DOLU bir sütuna (mevcut bir sıralanabilir öğenin
 * ÜZERİNE) sürüklemek admin uygulamasını GERÇEKTEN çökertiyordu: React "Maximum update depth
 * exceeded", yığın izi `PureEditorContent.componentDidMount → init → forceUpdate` (TipTap
 * `@tiptap/react` `EditorContent`) üzerinden geçiyordu. Kök neden: `builder-canvas.tsx`'teki
 * `onDragOver` her pointer hareketinde `blocks` state'ini mutasyona uğratıyordu (canlı yeniden-
 * sıralama önizlemesi) — DOLU bir sütuna bırakırken bu, state değişimi → DOM düzeni kayması →
 * dnd-kit'in droppable dikdörtgenlerini yeniden ölçmesi → çarpışma sonucunun değişmesi →
 * `onDragOver`'ın TEKRAR tetiklenmesi şeklinde bir geri besleme döngüsüne yol açıyordu; bloğun
 * (bir Metin bloğuysa) TipTap editörü bu döngüde ardı ardına unmount/mount ediliyordu.
 *
 * Düzeltme: `email-canvas.tsx`/`nav-tree-editor.tsx` ile AYNI, kanıtlanmış desen — sürükleme
 * SIRASINDA state HİÇ mutasyona uğratılmaz; konteynerler arası taşıma VE aynı konteyner içi
 * sıralama TEK SEFERDE, yalnızca bırakma anında (`onDragEnd`) hesaplanıp uygulanır. Böylece bir
 * sürükleme hareketi başına state TAM OLARAK bir kez değişir — geri besleme döngüsü YAPISAL
 * OLARAK imkânsız hale gelir. Boş sütunun `isOver` görsel geri bildirimi dnd-kit'in kendi
 * `useDroppable()`'ı üzerinden state'ten BAĞIMSIZ çalıştığı için ETKİLENMEDİ.
 */
test("sütunlar arası taşıma: dolu bir sütuna (mevcut öğenin üzerine) blok sürüklemek çalışır, admin uygulaması çökmez", async () => {
  test.setTimeout(60_000);
  const unique = Date.now();
  const bugSlug = `qa-e2e-grid-bug-${unique}`;
  const created = await createPageFixture(token, {
    title: `${PAGE_TITLE_PREFIX}Bug ${unique}`,
    slug: bugSlug,
    html: "<p>başlangıç</p>",
    status: "DRAFT",
  });
  const bugPageId = created.id as string;

  try {
    // Doğrudan API ile İKİ SÜTUNLU, HER İKİ SÜTUNU DA DOLU bir başlangıç durumu kurulur (UI
    // adımlarını tekrarlamadan) — sol: Görsel, sağ: Metin.
    const res = await fetch(`${API_BASE_URL}/admin/pages/${bugPageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        blocks: [
          {
            id: "qa-bug-columns",
            type: "columns",
            data: {
              columnCount: 2,
              ratio: "1-1",
              gap: "md",
              verticalAlign: "top",
              columns: [
                {
                  id: "qa-bug-col-a",
                  blocks: [
                    {
                      id: "qa-bug-image",
                      type: "image",
                      data: { url: "https://example.com/qa-e2e-bug-image.png", alt: "QA e2e bug görseli" },
                    },
                  ],
                },
                {
                  id: "qa-bug-col-b",
                  blocks: [{ id: "qa-bug-text", type: "text", data: { html: "<p>QA e2e bug metni</p>" } }],
                },
              ],
            },
          },
        ],
      }),
    });
    expect(res.ok).toBe(true);

    await page.goto(`/admin/pages/${bugPageId}`);
    await expect(page.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
    await expect(dragHandle(page, "Metin")).toBeVisible();
    await expect(dragHandle(page, "Görsel")).toBeVisible();

    // Metin, Görsel'in sütununa taşınır, karşı sütun tekrar boş-bırakma alanını gösterir.
    // Uygulama artık ÇÖKMÜYOR (bkz. yukarıdaki DÜZELTİLDİ notu) — bu adım hâlâ dosyanın geri
    // kalanındaki AYNI kararsız sentetik pointer-olayına (`dragUntil` başlık yorumu, ~%30
    // koşumda tarayıcının varsayılan METİN SEÇİMİNİ tetikliyor) tabi olduğu için AYNI yeniden-
    // deneme sarmalayıcısı kullanılır (main test'teki adım 5 ile BİREBİR aynı desen).
    await dragUntil(
      page,
      "Metin",
      () => dragHandle(page, "Görsel"),
      () => expect(page.getByText("Buraya blok sürükleyin")).toBeVisible({ timeout: 3_000 })
    );
    const imageBox = await dragHandle(page, "Görsel").boundingBox();
    const textBox = await dragHandle(page, "Metin").boundingBox();
    expect(imageBox && textBox).toBeTruthy();
    expect(Math.abs(imageBox!.x - textBox!.x)).toBeLessThan(20);
  } finally {
    await deletePagePermanently(token, bugPageId);
  }
});
