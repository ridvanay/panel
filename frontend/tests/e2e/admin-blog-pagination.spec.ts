import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";
import { cleanupBlogPostsByPrefix, createManyBlogPosts } from "./support/blog-fixtures";

/**
 * KULLANICININ AÇIKÇA İSTEDİĞİ regresyon testi ("qa-agent: özellikle 3. maddeyi (pagination)
 * ... test etsin"). Kök neden ve bağlayıcı düzeltme: ARCHITECTURE.md §10.7.1 — beş liste
 * ekranındaki `totalPages > 10` eşiği `totalPages > 1` ile değiştirildi. Bu dosya GERÇEK
 * backend + Postgres'e karşı, GERÇEK 229 blog yazısıyla (§10.7.1 tablosundaki örnekle BİREBİR
 * aynı sayı) doğrular — mock/stub YOK.
 *
 * 229 öğe → pageSize'a göre totalPages: 10→23, 20→12, 50→5 (tablo, §10.7.1).
 */
test.describe.configure({ retries: 1 });

const TITLE_PREFIX = "QA E2E Pag";
const TOTAL_POSTS = 229;

let page: Page;
let closeSession: () => Promise<void>;

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(180_000);
  const { accessToken } = await getCachedAdminSession();
  // İdempotent zemin — önceki başarısız bir koşumdan kalmış olabilir.
  await cleanupBlogPostsByPrefix(accessToken, TITLE_PREFIX);
  await createManyBlogPosts(accessToken, TOTAL_POSTS, TITLE_PREFIX);
  ({ page, close: closeSession } = await createAuthenticatedPage(browser));
});

test.afterAll(async () => {
  const { accessToken } = await getCachedAdminSession();
  await cleanupBlogPostsByPrefix(accessToken, TITLE_PREFIX);
  // `closeSession` yalnızca `beforeAll` başarıyla TAMAMLANDIYSA atanmıştır — `beforeAll`
  // erken (ör. fixture oluşturma sırasında) fırlatırsa burası hâlâ çalışır (Playwright
  // `afterAll`'ı `beforeAll` başarısız olsa da çağırır); asıl hatayı bir de anlamsız bir
  // `TypeError`'la MASKELEMEMEK için varlığı kontrol ediyoruz.
  if (closeSession) await closeSession();
});

/** `assertNotTruncated` — pageSize seçicisinin metni KESMEDİĞİNİ kanıtlar (madde 2 CSS bug'ı,
 * `w-24` → `w-auto`). `scrollWidth`/`clientWidth` native `<select>`'te güvenilir değildir
 * (tarayıcı içeriği kutuya göre değil OS native render eder); bunun yerine kutunun gerçek
 * render genişliğinin, seçili metnin canvas ile ölçülen piksel genişliğinden DAR olmadığını
 * doğrudan kanıtlıyoruz — `w-24` (96px) genişliğindeyken "50 / sayfa" bunu aşardı. */
async function assertPageSizeSelectNotTruncated(locator: ReturnType<Page["getByLabel"]>) {
  const { offsetWidth, textWidth, className } = await locator.evaluate((el: HTMLSelectElement) => {
    const style = getComputedStyle(el);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const text = el.selectedOptions[0]?.textContent ?? "";
    return { offsetWidth: el.offsetWidth, textWidth: ctx.measureText(text).width, className: el.className };
  });
  expect(className).not.toContain("w-24");
  expect(className).toContain("w-auto");
  // Kutu, metinden (+ok ikonu payı) dar olmamalı — eski `w-24` (96px) "50 / sayfa" gibi
  // metinleri keserdi; burada kutunun ölçülen metin genişliğini KAPSADIĞINI doğruluyoruz.
  expect(offsetWidth).toBeGreaterThanOrEqual(textWidth);
}

async function gotoBlogListFilteredToFixture(target: Page) {
  await target.goto("/admin/blog");
  await expect(target.getByRole("heading", { name: "Blog Yazıları" })).toBeVisible();
  const search = target.getByLabel("Başlığa göre ara");
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(TITLE_PREFIX);
}

test("KRİTİK — 229 yazı, 50/sayfa seçilince pagination VE pageSize seçici görünür kalır, 2. sayfaya geçilebiliyor, 10/sayfa'ya geri dönülebiliyor", async () => {
  await gotoBlogListFilteredToFixture(page);

  // Varsayılan pageSize=10 → totalPages=23 (229/10 tavan) — kontroller görünür olmalı.
  await expect(page.getByText("Sayfa 1 / 23", { exact: true })).toBeVisible();
  const pageSizeSelect = page.getByLabel("Sayfa boyutu");
  await expect(pageSizeSelect).toBeVisible();

  await pageSizeSelect.selectOption("50");

  // ESKİ BUG: totalPages 229/50=5'e düşünce `> 10` eşiği hem pagination'ı hem pageSize
  // seçiciyi TAMAMEN gizliyordu — kullanıcı ne sayfa değiştirebiliyor ne 10/sayfa'ya
  // dönebiliyordu. İkisi de HÂLÂ DOM'da olmalı (totalPages=5 > 1).
  await expect(pageSizeSelect).toBeVisible();
  await expect(page.getByLabel("Sonraki sayfa")).toBeVisible();
  await expect(page.getByText("Sayfa 1 / 5", { exact: true })).toBeVisible();

  // Gerçekten 2. sayfaya GEÇİLEBİLİYOR mu (eski bug: buton DOM'da olmadığı için geçilemiyordu).
  await page.getByLabel("Sonraki sayfa").click();
  await expect(page.getByText("Sayfa 2 / 5", { exact: true })).toBeVisible();

  // Kullanıcı 10/sayfa'ya GERİ dönebiliyor mu (eski bug: seçici de kaybolduğu için buna
  // dönmenin TEK yolu sayfayı yenilemekti — state sıfırlanırdı).
  await expect(pageSizeSelect).toBeVisible();
  await pageSizeSelect.selectOption("10");
  await expect(page.getByText("Sayfa 1 / 23", { exact: true })).toBeVisible();
});

test("totalPages === 1 iken pagination kontrolleri (ve pageSize seçici) GİZLİ kalır", async () => {
  await gotoBlogListFilteredToFixture(page);
  // Tek bir kayda daralt — tam başlık eşleşmesi.
  const search = page.getByLabel("Başlığa göre ara");
  await search.fill(`${TITLE_PREFIX} 0001`);
  await expect(page.getByText(`${TITLE_PREFIX} 0001`, { exact: false }).first()).toBeVisible();

  await expect(page.getByLabel("Sayfa boyutu")).toHaveCount(0);
  await expect(page.getByLabel("Sonraki sayfa")).toHaveCount(0);
  await expect(page.getByLabel("Önceki sayfa")).toHaveCount(0);
  await expect(page.getByText(/^Sayfa \d+ \/ \d+$/)).toHaveCount(0);
});

const PAGE_SIZE_CASES: { size: "10" | "20" | "50"; totalPages: number; label: string }[] = [
  { size: "10", totalPages: 23, label: "10 / sayfa" },
  { size: "20", totalPages: 12, label: "20 / sayfa" },
  { size: "50", totalPages: 5, label: "50 / sayfa" },
];

for (const { size, totalPages, label } of PAGE_SIZE_CASES) {
  test(`${label} — ilk/orta/son sayfa aralığında doğru çalışır (229 yazı, totalPages=${totalPages})`, async () => {
    await gotoBlogListFilteredToFixture(page);
    const pageSizeSelect = page.getByLabel("Sayfa boyutu");
    await pageSizeSelect.selectOption(size);
    await assertPageSizeSelectNotTruncated(pageSizeSelect);

    const next = page.getByLabel("Sonraki sayfa");
    const prev = page.getByLabel("Önceki sayfa");
    const rows = page.locator("table tbody tr");

    // İLK sayfa.
    await expect(page.getByText(`Sayfa 1 / ${totalPages}`, { exact: true })).toBeVisible();
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();
    await expect(rows).toHaveCount(Number(size));

    // ORTA sayfa (yaklaşık ortadaki bir sayfaya git).
    const middlePage = Math.max(2, Math.floor(totalPages / 2));
    for (let i = 1; i < middlePage; i++) {
      await next.click();
    }
    await expect(page.getByText(`Sayfa ${middlePage} / ${totalPages}`, { exact: true })).toBeVisible();
    await expect(prev).toBeEnabled();
    await expect(next).toBeEnabled();
    await expect(rows).toHaveCount(Number(size));

    // SON sayfaya kadar ilerle.
    for (let i = middlePage; i < totalPages; i++) {
      await next.click();
    }
    await expect(page.getByText(`Sayfa ${totalPages} / ${totalPages}`, { exact: true })).toBeVisible();
    await expect(next).toBeDisabled();
    await expect(prev).toBeEnabled();
    const remainder = TOTAL_POSTS % Number(size);
    const expectedLastPageCount = remainder === 0 ? Number(size) : remainder;
    await expect(rows).toHaveCount(expectedLastPageCount);

    // Önceki'ye basınca gerçekten bir önceki sayfaya dönüyor mu.
    await prev.click();
    await expect(page.getByText(`Sayfa ${totalPages - 1} / ${totalPages}`, { exact: true })).toBeVisible();
  });
}
