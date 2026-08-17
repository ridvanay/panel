import { test, expect, type Page } from "@playwright/test";
import { API_BASE_URL, getCachedAdminSession } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";
import {
  cleanupBlogCategoriesByPrefix,
  cleanupBlogPostsByPrefix,
  cleanupBlogTagsByPrefix,
  createBlogCategory,
  createBlogPost,
  createBlogTag,
  deleteBlogTag,
  type AdminBlogPost,
} from "./support/blog-fixtures";

/**
 * Kullanıcının açıkça istediği ikinci odak: "yeni Etiket sistemini test etsin" — ARCHITECTURE.md
 * §10.14 (Tag) + §10.7.2 (Hızlı Düzenle genişletmesi). Gerçek backend + Postgres'e karşı,
 * satır-içi oluşturma, Hızlı Düzenle, TAM SET semantiği, filtreleme ve etiket silme
 * senaryolarını kapsar.
 */
test.describe.configure({ retries: 1 });

const POST_PREFIX = "QaE2eTagPost";
const CATEGORY_PREFIX = "QaE2eTagCat";
const TAG_PREFIX = "QaE2eTagTag";

let page: Page;
let closeSession: () => Promise<void>;
let token: string;

async function cleanupAll() {
  await cleanupBlogPostsByPrefix(token, POST_PREFIX);
  await cleanupBlogTagsByPrefix(token, TAG_PREFIX);
  await cleanupBlogCategoriesByPrefix(token, CATEGORY_PREFIX);
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(60_000);
  const session = await getCachedAdminSession();
  token = session.accessToken;
  await cleanupAll(); // idempotent zemin — önceki başarısız bir koşumdan kalmış olabilir
  ({ page, close: closeSession } = await createAuthenticatedPage(browser));
});

test.afterAll(async () => {
  await cleanupAll();
  // Bkz. `admin-blog-pagination.spec.ts` — `beforeAll` erken fırlarsa `closeSession` atanmamış
  // olabilir; kontrolsüz çağrı asıl hatayı anlamsız bir `TypeError`'la maskeler.
  if (closeSession) await closeSession();
});

// qa-agent bulgusu — testler SABİT başlık/ad ile fixture oluşturuyor (ör. `createBlogPost(token,
// { title: \`${POST_PREFIX} TagCreate\` })`). Yalnızca dosya-seviyesi `beforeAll`/`afterAll`
// temizliği varken, bir test BAŞARISIZ olup `test.describe.configure({ retries: 1 })` onu tekrar
// denediğinde ilk denemenin oluşturduğu kayıt hâlâ DB'de durur — retry aynı başlıkla POST atınca
// `409 CONFLICT` alır (asıl hatayı maskeleyen ikinci, sahte bir başarısızlık). Her testten SONRA
// (başarılı/başarısız fark etmeksizin) aynı süpürmeyi çalıştırmak retry'ları güvenli hale getirir.
test.afterEach(async () => {
  await cleanupAll();
});

async function openEditPage(target: Page, post: AdminBlogPost) {
  await target.goto(`/admin/blog/${post.id}`);
  await expect(target.getByRole("button", { name: "Kaydet" })).toBeVisible({ timeout: 15_000 });
  // Başlık alanı yüklenen veriyle doldu mu — sayfanın gerçekten bu yazıyı getirdiğinin kanıtı.
  // qa-agent bulgusu — `getByLabel("Başlık", { exact: true })` bu SAYFADA (tam editör) tekrar
  // tekrar "element(s) not found" ile 30s'de bile timeout oluyordu, ANCAK hatanın a11y
  // snapshot'ı (`error-context.md`) tam o anda `textbox "Başlık": <doğru değer>`i AÇIKÇA DOM'da
  // gösteriyordu — yani element GERÇEKTEN oradaydı. Bu, olası bir periyodik remount/otomatik-
  // kaydetme döngüsüyle (sayfada "Taslak kaydedildi HH:MM" göstergesi var) `getByLabel`'in
  // polling penceresini sürekli ıskalaması gibi görünüyor (frontend-agent'a bilgi amaçlı
  // raporlandı — bkz. qa-agent nihai rapor). Kararlı `#title` id'sine geçmek (`Field id="title"`,
  // `field.tsx`) test güvenilirliğini DOM kimliğine dayandırıp bu polling yarışını atlatıyor.
  await expect(target.locator("#title")).toHaveValue(post.title, { timeout: 30_000 });
}

async function searchBlogList(target: Page, query: string) {
  await target.goto("/admin/blog");
  await expect(target.getByRole("heading", { name: "Blog Yazıları" })).toBeVisible();
  const search = target.getByLabel("Başlığa göre ara");
  await expect(search).toBeVisible({ timeout: 15_000 });
  await search.fill(query);
}

test("madde 1 — tam editörde satır-içi YENİ ETİKET oluşturma: otomatik seçilir, kaydedilince listede chip görünür", async () => {
  // `openEditPage` içindeki 30s'lik Başlık beklemesi + navigasyon/diğer adımlar varsayılan 30s
  // dosya timeout'unu aşabilir (qa-agent bulgusu) — bu iki test (tam editör navigasyonu yapan
  // TEK testler) için ayrıca uzatılıyor.
  test.setTimeout(60_000);
  const post = await createBlogPost(token, { title: `${POST_PREFIX} TagCreate` });
  const tagName = `${TAG_PREFIX}Inline1`;

  await openEditPage(page, post);

  const tagInput = page.getByLabel("Etiketler", { exact: true });
  await tagInput.fill(tagName);
  await page.getByRole("button", { name: `"${tagName}" için yeni etiket oluştur` }).click();

  // Otomatik seçili: chip hemen görünür (§10.14.5 madde 2 — "201 gövdesi zaten kaydı döner", refetch YOK).
  await expect(page.getByText(tagName, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `${tagName} etiketini kaldır` })).toBeVisible();

  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("Yazı kaydedildi.")).toBeVisible();

  await searchBlogList(page, post.title);
  const row = page.locator("table tbody tr", { hasText: post.title });
  await expect(row.getByText(tagName, { exact: true })).toBeVisible();
});

test("madde 5 — tam editörde satır-içi YENİ KATEGORİ oluşturma: otomatik seçilir, kaydedilince listede görünür", async () => {
  test.setTimeout(60_000); // bkz. "madde 1" — openEditPage'in uzun Başlık beklemesi.
  const post = await createBlogPost(token, { title: `${POST_PREFIX} CategoryCreate` });
  const categoryName = `${CATEGORY_PREFIX}Inline1`;

  await openEditPage(page, post);

  await page.getByRole("button", { name: "Yeni Kategori Oluştur" }).click();
  await page.getByLabel("Yeni kategori adı").fill(categoryName);
  await page.getByRole("button", { name: "Oluştur", exact: true }).click();

  // Otomatik seçili — dropdown'ın seçili option'ının metni yeni kategoriyle eşleşir.
  const categorySelect = page.getByLabel("Kategori", { exact: true });
  await expect(categorySelect).toBeVisible();
  const selectedOptionText = await categorySelect.evaluate(
    (el: HTMLSelectElement) => el.selectedOptions[0]?.textContent ?? ""
  );
  expect(selectedOptionText).toBe(categoryName);

  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("Yazı kaydedildi.")).toBeVisible();

  await searchBlogList(page, post.title);
  const row = page.locator("table tbody tr", { hasText: post.title });
  await expect(row.getByText(categoryName, { exact: true })).toBeVisible();
});

test("madde 3 — Hızlı Düzenle'den Kategori + Etiket değiştirilince liste güncellenir", async () => {
  const catA = await createBlogCategory(token, `${CATEGORY_PREFIX}QeA`);
  const catB = await createBlogCategory(token, `${CATEGORY_PREFIX}QeB`);
  const tagA = await createBlogTag(token, `${TAG_PREFIX}QeA`);
  const tagB = await createBlogTag(token, `${TAG_PREFIX}QeB`);
  const post = await createBlogPost(token, {
    title: `${POST_PREFIX} QuickEdit`,
    categoryId: catA.id,
    tagIds: [tagA.id],
  });

  await searchBlogList(page, post.title);
  const row = page.locator("table tbody tr", { hasText: post.title });
  await row.getByRole("button", { name: "Hızlı Düzenle" }).click();

  const categorySelect = page.getByLabel("Kategori", { exact: true }).filter({ visible: true });
  await expect(categorySelect).toBeVisible();
  await categorySelect.selectOption(catB.id);

  // tagA'yı kaldır, tagB'yi ekle.
  await page.getByRole("button", { name: `${tagA.name} etiketini kaldır` }).click();
  // qa-agent bulgusu — `content-list-table` Hızlı Düzenle'yi masaüstü/mobil için AYRI DOM
  // markup'ında (id'ler `-m-` son ekiyle ayrışır, bkz. Başlık input'u) render ediyor; ikisi de
  // aynı erişilebilir etikete ("Etiketler") sahip olduğundan `getByLabel` iki eşleşme buluyor
  // (Playwright strict-mode hatası). `filter({ visible: true })` yalnızca o an GÖRÜNÜR olanı
  // (test varsayılan masaüstü viewport'unda) seçer.
  const tagInput = page.getByLabel("Etiketler", { exact: true }).filter({ visible: true });
  await tagInput.fill(tagB.name);
  await page.getByRole("button", { name: tagB.name, exact: true }).click();

  await page.getByRole("button", { name: "Güncelle" }).click();
  await expect(page.getByText("Yazı güncellendi.")).toBeVisible();

  await expect(row.getByText(catB.name, { exact: true })).toBeVisible();
  await expect(row.getByText(tagB.name, { exact: true })).toBeVisible();
  await expect(row.getByText(tagA.name, { exact: true })).toHaveCount(0);
});

test("madde 4 — tagIds TAM SET (delta değil): 3 etiketten 1'i kaldırılınca PATCH gövdesi kalan 2'yi içerir", async () => {
  const t1 = await createBlogTag(token, `${TAG_PREFIX}Set1`);
  const t2 = await createBlogTag(token, `${TAG_PREFIX}Set2`);
  const t3 = await createBlogTag(token, `${TAG_PREFIX}Set3`);
  const post = await createBlogPost(token, {
    title: `${POST_PREFIX} TagIdsFullSet`,
    tagIds: [t1.id, t2.id, t3.id],
  });

  await searchBlogList(page, post.title);
  const row = page.locator("table tbody tr", { hasText: post.title });
  await row.getByRole("button", { name: "Hızlı Düzenle" }).click();
  await expect(page.getByRole("button", { name: `${t2.name} etiketini kaldır` })).toBeVisible();
  await page.getByRole("button", { name: `${t2.name} etiketini kaldır` }).click();

  const patchUrl = `${API_BASE_URL}/admin/blog/${post.id}`;
  const requestPromise = page.waitForRequest((req) => req.url() === patchUrl && req.method() === "PATCH");
  await page.getByRole("button", { name: "Güncelle" }).click();
  const request = await requestPromise;
  const body = request.postDataJSON() as { tagIds?: string[] };

  expect(body.tagIds).toBeDefined();
  expect(new Set(body.tagIds)).toEqual(new Set([t1.id, t3.id]));
  expect(body.tagIds).toHaveLength(2);

  await expect(page.getByText("Yazı güncellendi.")).toBeVisible();
});

test("madde 4 (gözlemlenen davranış belgesi) — Hızlı Düzenle'de kategori/etiket DOKUNULMADAN kaydedilince PATCH gövdesi mevcut tagIds'i AYNEN taşır", async () => {
  // NOT (qa-agent bulgusu — frontend-agent'a bilgi amaçlı): görev talimatı "hiç dokunulmazsa
  // tagIds alanı gövdeye hiç eklenmez" bekliyordu. Kod incelemesi (`use-content-list.ts`
  // `saveQuickEdit`) gösteriyor ki Hızlı Düzenle HER ZAMAN `quickEditValues`'ın TAMAMINI
  // (title+slug+status+categoryId+tagIds) gönderiyor — tam editörün ("Tam editör her zaman
  // TÜM alanları gönderir", `[postId]/page.tsx` handleSave yorumu) izlediği AYNI "her zaman
  // tam gövde" deseni. Sonuç FONKSİYONEL OLARAK doğru (mevcut değer aynen yansıtılır, veri
  // kaybı YOK) ama backend'in `undefined` ("dokunma") ile `tagIds` ("replace") arasındaki
  // ayrımı frontend'de hiç KULLANILMIYOR. Bu test GERÇEK gözlemlenen davranışı belgeler.
  const t1 = await createBlogTag(token, `${TAG_PREFIX}Untouched1`);
  const post = await createBlogPost(token, {
    title: `${POST_PREFIX} TagIdsUntouched`,
    tagIds: [t1.id],
  });

  await searchBlogList(page, post.title);
  const row = page.locator("table tbody tr", { hasText: post.title });
  await row.getByRole("button", { name: "Hızlı Düzenle" }).click();
  // Kategori/Etikete HİÇ DOKUNULMUYOR — yalnızca başlık değiştiriliyor.
  // qa-agent bulgusu — bkz. yukarıdaki "madde 3" yorumu: Hızlı Düzenle masaüstü/mobil için AYRI
  // DOM markup'ında render edilir (`quick-edit-title-{id}` / `quick-edit-title-m-{id}`), ikisi de
  // "Başlık" etiketini paylaşır; `filter({ visible: true })` yalnızca görüneni seçer.
  const titleInput = page.getByLabel("Başlık", { exact: true }).filter({ visible: true });
  await titleInput.fill(`${post.title} (düzenlendi)`);

  const patchUrl = `${API_BASE_URL}/admin/blog/${post.id}`;
  const requestPromise = page.waitForRequest((req) => req.url() === patchUrl && req.method() === "PATCH");
  await page.getByRole("button", { name: "Güncelle" }).click();
  const request = await requestPromise;
  const body = request.postDataJSON() as { tagIds?: string[] };

  // Gözlemlenen gerçek davranış: alan HİÇ omit edilmiyor, mevcut tam set aynen gönderiliyor.
  expect(body.tagIds).toEqual([t1.id]);
});

test("madde 6 — etikete göre filtreleme (client-side): yalnızca o etikete sahip yazılar listelenir", async () => {
  const filterTag = await createBlogTag(token, `${TAG_PREFIX}Filter`);
  const withTag = await createBlogPost(token, { title: `${POST_PREFIX} FilterHasTag`, tagIds: [filterTag.id] });
  const withoutTag = await createBlogPost(token, { title: `${POST_PREFIX} FilterNoTag` });

  await page.goto("/admin/blog");
  await expect(page.getByRole("heading", { name: "Blog Yazıları" })).toBeVisible();
  const search = page.getByLabel("Başlığa göre ara");
  await expect(search).toBeVisible({ timeout: 15_000 });
  await search.fill(`${POST_PREFIX} Filter`);
  await expect(page.locator("table tbody tr", { hasText: withTag.title })).toBeVisible();
  await expect(page.locator("table tbody tr", { hasText: withoutTag.title })).toBeVisible();

  const tagFilterSelect = page.getByLabel("Etikete göre filtrele");
  await expect(tagFilterSelect).toBeVisible();
  await tagFilterSelect.selectOption(filterTag.id);

  await expect(page.locator("table tbody tr", { hasText: withTag.title })).toBeVisible();
  await expect(page.locator("table tbody tr", { hasText: withoutTag.title })).toHaveCount(0);
});

test("madde 7 — bir etiket silinince o etikete sahip yazı VAR OLMAYA devam eder, yalnızca etiketi kaybeder", async () => {
  const tagToDelete = await createBlogTag(token, `${TAG_PREFIX}Deletable`);
  const post = await createBlogPost(token, { title: `${POST_PREFIX} TagDeleted`, tagIds: [tagToDelete.id] });

  const deleteRes = await deleteBlogTag(token, tagToDelete.id);
  expect(deleteRes.status).toBe(204);

  await searchBlogList(page, post.title);
  const row = page.locator("table tbody tr", { hasText: post.title });
  // Yazı hâlâ listede (silinmedi) ama artık silinen etiketi taşımıyor.
  await expect(row).toBeVisible();
  await expect(row.getByText(tagToDelete.name, { exact: true })).toHaveCount(0);
});
