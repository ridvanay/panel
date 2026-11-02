import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { API_BASE_URL, createPageWithBlocks, deletePagePermanently, getAdminSettings, getCachedAdminSession, patchSiteSettings } from "./support/api";
import { createCategory, createPost, deleteCategory, deletePostPermanently, deleteSpecialty } from "./support/blog-z1-fixtures";

/**
 * qa-agent — Paket AH Faz 1 ekran görüntüleri (EN + AR; masaüstü 1440, mobil 390).
 * Yalnızca `AH_SHOTS=1` ile koşar (normal e2e koşusunda atlanır). Çıktı: docs/prompts/2026-11-02-AH-ekran/.
 * Geçici fixture'lar (EN adlı bölümler, temiz ana sayfa, blog yazısı) kurulur; saas_e2e'deki Türkçe tohum bölümler
 * ekran görüntüsü süresince pasife alınır ve sonunda GERİ AÇILIR.
 */
test.skip(process.env.AH_SHOTS !== "1", "AH_SHOTS=1 ile koşar");
test.use({ navigationTimeout: 120_000, actionTimeout: 20_000 });
test.describe.configure({ mode: "serial" });

const OUT = path.resolve(__dirname, "../../../docs/prompts/2026-11-02-AH-ekran");
const RUN = Date.now().toString(36);
const LANGS = [
  { code: "en", prefix: "" },
  { code: "ar", prefix: "/ar" },
] as const;
const DEVICES = [
  { name: "masaustu", width: 1440, height: 900 },
  { name: "mobil", width: 390, height: 844 },
] as const;

let token = "";
const specialtyIds: string[] = [];
const deactivated: string[] = [];
let categoryId = "";
let postId = "";
let homePageId = "";
let originalHomePageId: string | null = null;
const POST_SLUG = `what-to-prepare-before-treatment-${RUN}`;

async function api(pathname: string, init: RequestInit = {}) {
  return fetch(`${API_BASE_URL}${pathname}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
}
async function createSpec(name: string, slug: string, description: string, ar: { name: string; description: string }, parentId: string | null = null, icon = "Stethoscope") {
  const res = await api("/admin/telehealth/specialties", {
    method: "POST",
    body: JSON.stringify({ name, slug, icon, description, parentId, translations: { en: { name, description }, ar } }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const id = ((await res.json()) as { data: { id: string } }).data.id;
  specialtyIds.push(id);
  return id;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  token = (await getCachedAdminSession()).accessToken;
  // Türkçe tohum bölümleri geçici pasife al.
  const list = (await (await api("/admin/telehealth/specialties")).json()) as { data: Array<{ id: string; isActive: boolean; slug: string; name: string }> };
  for (const s of list.data.filter((x) => x.isActive && !x.slug.startsWith("qa-"))) {
    const r = await api(`/admin/telehealth/specialties/${s.id}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) });
    if (r.ok) deactivated.push(s.id);
  }
  const gastro = await createSpec("Gastroenterology", `gastroenterology-${RUN}`, "Digestive system conditions, endoscopy and liver care at authorized healthcare facilities.", { name: "أمراض الجهاز الهضمي", description: "أمراض الجهاز الهضمي والمنظار ورعاية الكبد في منشآت صحية مرخّصة." }, null, "Stethoscope");
  await createSpec("Endoscopic Procedures", `endoscopic-procedures-${RUN}`, "Diagnostic and therapeutic endoscopy.", { name: "إجراءات المنظار", description: "المنظار التشخيصي والعلاجي." }, gastro);
  await createSpec("ERCP", `ercp-${RUN}`, "Bile duct and pancreatic procedures.", { name: "تصوير القنوات الصفراوية (ERCP)", description: "إجراءات القنوات الصفراوية والبنكرياس." }, gastro);
  await createSpec("Obesity and Metabolic Surgery", `bariatric-${RUN}`, "Weight-loss surgery and metabolic care.", { name: "جراحة السمنة والجراحة الأيضية", description: "جراحة إنقاص الوزن والرعاية الأيضية." });
  await createSpec("Dental Treatments", `dental-${RUN}`, "Implants, veneers and full-mouth restoration.", { name: "علاجات الأسنان", description: "زراعة الأسنان والقشور وترميم الفم الكامل." });
  await createSpec("Hair Transplantation", `hair-${RUN}`, "FUE and DHI hair restoration.", { name: "زراعة الشعر", description: "ترميم الشعر بتقنيتي FUE وDHI." });
  await createSpec("IVF and Reproductive Health", `ivf-${RUN}`, "Fertility assessment and assisted reproduction.", { name: "أطفال الأنابيب والصحة الإنجابية", description: "تقييم الخصوبة والإنجاب المساعد." });

  const cat = await createCategory(token, { name: "Planning your trip", slug: `planning-your-trip-${RUN}`, isMedical: false, translations: { ar: { name: "تخطيط رحلتك" } } });
  categoryId = cat.id;
  const post = await createPost(token, {
    title: "What to prepare before travelling for treatment",
    slug: POST_SLUG,
    excerpt: "A practical checklist for international patients planning treatment in Türkiye.",
    contentHtml:
      "<p>Planning treatment abroad involves more than choosing a service. This guide lists the practical points that international patients usually ask about before they travel.</p><h2>Documents</h2><p>Keep a valid passport, any previous medical reports and a list of the medicines you currently take. Share only what your patient coordinator asks for, through the secure channel they provide.</p><h2>Travel and stay</h2><p>Book flexible tickets, plan your accommodation close to the facility and agree on airport transfers in advance. Your coordinator can arrange these for you.</p><h2>Aftercare</h2><p>Ask how follow-up will work once you are back home, including who you contact and in which language.</p>",
    categoryId,
    status: "PUBLISHED",
    medicalReviewStatus: "not_required",
    keyTakeaways: ["Prepare documents and medicines list early", "Plan travel, stay and transfers with your coordinator", "Agree on aftercare communication before you leave"],
    translations: {
      ar: {
        title: "ما الذي تحضّره قبل السفر للعلاج",
        excerpt: "قائمة عملية للمرضى الدوليين الذين يخططون للعلاج في تركيا.",
        contentHtml:
          "<p>لا يقتصر التخطيط للعلاج في الخارج على اختيار الخدمة. يعرض هذا الدليل النقاط العملية التي يسأل عنها المرضى الدوليون عادةً قبل السفر.</p><h2>المستندات</h2><p>احتفظ بجواز سفر ساري وبأي تقارير طبية سابقة وقائمة بالأدوية التي تتناولها. شارك فقط ما يطلبه منسق المرضى عبر القناة الآمنة.</p><h2>السفر والإقامة</h2><p>احجز تذاكر مرنة وخطط لإقامتك قرب المنشأة واتفق مسبقًا على الانتقال من المطار.</p>",
        keyTakeaways: ["جهّز المستندات وقائمة الأدوية مبكرًا", "خطّط للسفر والإقامة مع منسقك", "اتفق على آلية المتابعة قبل المغادرة"],
      },
    },
  });
  postId = post.id;

  originalHomePageId = ((await getAdminSettings(token)).homePageId as string | null) ?? null;
  const home = await createPageWithBlocks(token, {
    title: `AH shot home ${RUN}`,
    slug: `ah-shot-home-${RUN}`,
    status: "PUBLISHED",
    blocks: [
      {
        id: "c-hero",
        type: "container",
        settings: {},
        children: [
          { id: "h1", type: "heading", data: { text: "Plan your treatment in Türkiye with a patient coordinator", level: 1, align: "left", underline: false } },
          { id: "t1", type: "text", data: { html: "<p>Tell us which service you need. A patient coordinator arranges your treatment at an authorized healthcare facility, your travel and your stay.</p>" } },
        ],
      },
      {
        id: "c-spec",
        type: "container",
        settings: {},
        children: [{ id: "sc", type: "specialty-cards", data: { content: { en: { title: "Health Tourism Services", subtitle: "Choose a service to request a consultation." }, ar: { title: "خدمات السياحة العلاجية", subtitle: "اختر خدمة لطلب استشارة." } }, columns: 3, showDescription: true, imageShape: "circle" } }],
      },
    ],
  });
  homePageId = home.id as string;
  await patchSiteSettings(token, { homePageId });
});

test.afterAll(async () => {
  await patchSiteSettings(token, { homePageId: originalHomePageId }).catch(() => undefined);
  if (homePageId) await deletePagePermanently(token, homePageId).catch(() => undefined);
  if (postId) await deletePostPermanently(token, postId).catch(() => undefined);
  if (categoryId) await deleteCategory(token, categoryId).catch(() => undefined);
  for (const id of [...specialtyIds].reverse()) await deleteSpecialty(token, id).catch(() => undefined);
  for (const id of deactivated) await api(`/admin/telehealth/specialties/${id}`, { method: "PATCH", body: JSON.stringify({ isActive: true }) }).catch(() => undefined);
});

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  await page.waitForTimeout(400);
}
async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  await settle(page);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: opts.fullPage ?? true });
}

test("hazırlık: fixture'lar ve temiz ana sayfa görünür olana dek bekle (60 sn önbellek)", async ({ page }) => {
  test.setTimeout(150_000);
  await expect(async () => {
    await page.goto("/");
    await page.reload();
    await expect(page.locator("body")).toContainText("Plan your treatment in Türkiye", { timeout: 2_000 });
    await page.goto("/specialties");
    await expect(page.locator(`a[href$="/specialties/gastroenterology-${RUN}"]`).first()).toBeVisible({ timeout: 2_000 });
    await expect(page.locator('a[href$="/specialties/kardiyoloji"]')).toHaveCount(0, { timeout: 2_000 });
    await page.goto(`/request`);
    await expect(page.locator(`#request-service option[value="gastroenterology-${RUN}"]`)).toHaveCount(1, { timeout: 2_000 });
    await page.goto(`/blog/${POST_SLUG}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 140_000, intervals: [3_000, 5_000] });
});

for (const lang of LANGS) {
  for (const dev of DEVICES) {
    test.describe(`${lang.code} / ${dev.name}`, () => {
      test.use({ viewport: { width: dev.width, height: dev.height } });
      const tag = `${lang.code}-${dev.name}`;

      test("ana sayfa: üst şerit + sayfa + footer", async ({ page }) => {
        await page.goto(`${lang.prefix || "/"}`);
        await shot(page, `${tag}-01-ana-sayfa-ust`, { fullPage: false });
        await shot(page, `${tag}-02-ana-sayfa-tam`);
        const footer = page.locator("footer").first();
        await footer.scrollIntoViewIfNeeded();
        await settle(page);
        await footer.screenshot({ path: path.join(OUT, `${tag}-03-footer.png`) });
      });

      test("menü açık hâli", async ({ page }) => {
        await page.goto(`${lang.prefix || "/"}`);
        await settle(page);
        if (dev.name === "masaustu") {
          const trigger = page.getByTestId("site-header-desktop").getByRole("button", { name: /Health Tourism Services|خدمات السياحة العلاجية/ }).or(page.getByTestId("site-header-desktop").getByRole("link", { name: /Health Tourism Services|خدمات السياحة العلاجية/ })).first();
          await trigger.click();
          await page.waitForTimeout(600);
          await page.screenshot({ path: path.join(OUT, `${tag}-04-menu-acik.png`), fullPage: false });
        } else {
          await page.getByRole("button", { name: /menu|القائمة/i }).first().click();
          await page.waitForTimeout(700);
          await page.screenshot({ path: path.join(OUT, `${tag}-04-menu-acik.png`), fullPage: false });
        }
      });

      test("Hakkımızda", async ({ page }) => {
        await page.goto(`${lang.prefix}/about`);
        await shot(page, `${tag}-05-hakkimizda`);
      });

      test("Health Tourism Services (/specialties)", async ({ page }) => {
        await page.goto(`${lang.prefix}/specialties`);
        await shot(page, `${tag}-06-health-tourism-services`);
      });

      test("bölüm sayfası (gastroenterology)", async ({ page }) => {
        await page.goto(`${lang.prefix}/specialties/gastroenterology-${RUN}`);
        await shot(page, `${tag}-07-bolum-gastroenterology`);
      });

      test("talep formu + başarı ekranı", async ({ page }) => {
        test.setTimeout(90_000);
        await page.goto(`${lang.prefix}/request?service=gastroenterology-${RUN}`);
        await expect(page.getByTestId("request-form")).toBeVisible();
        await shot(page, `${tag}-08-talep-formu`);
        await page.locator("#request-country").selectOption("DE");
        await page.locator("#request-contact-language").selectOption(lang.code === "ar" ? "ar" : "en");
        await page.getByTestId("request-date-from").fill("2026-12-01");
        await page.getByTestId("request-date-to").fill("2026-12-15");
        await page.getByTestId("request-interpreter-yes").check();
        await page.locator("#request-full-name").fill("Sample Visitor");
        await page.locator("#request-email").fill(`qa-ah-shot-${RUN}-${tag}@example.com`);
        await page.getByTestId("request-consent-contact").check();
        await shot(page, `${tag}-09-talep-formu-dolu`);
        await page.getByTestId("request-submit").click();
        await expect(page.getByTestId("request-success")).toBeVisible({ timeout: 30_000 });
        await shot(page, `${tag}-10-talep-basari`, { fullPage: false });
      });

      test("blog yazısı (alt kısım: koordinatör kartı + bilgi kutusu)", async ({ page }) => {
        await page.goto(`${lang.prefix}/blog/${POST_SLUG}`);
        await shot(page, `${tag}-11-blog-yazisi-tam`);
        await page.getByTestId("blog-coordinator-card").scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await settle(page);
        await page.screenshot({ path: path.join(OUT, `${tag}-12-blog-yazisi-alt.png`), fullPage: false });
      });

      test("içerik standartları", async ({ page }) => {
        await page.goto(`${lang.prefix}/content-standards`);
        await shot(page, `${tag}-13-icerik-standartlari`);
      });

      test("VIP sayfası", async ({ page }) => {
        await page.goto(`${lang.prefix}/vip-accommodation-transfer`);
        await shot(page, `${tag}-14-vip`);
      });
    });
  }
}
