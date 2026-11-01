import path from "node:path";
import { mkdirSync } from "node:fs";
import { test, expect, type Page, type Browser } from "@playwright/test";
import { getCachedAdminSession, getSiteModules, patchSiteModule, getFixtureUserToken, setupAndEnableTwoFactorForSelf, nextTotpCode, API_BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD } from "./support/api";
import { adminGetUserByEmail } from "./support/admin-users-fixtures";
import { linkDoctorUserRaw, deleteAdminDoctorFixture } from "./support/telehealth-fixtures";
import {
  Z1_PREFIX,
  createSpecialty,
  deleteSpecialty,
  createCategory,
  deleteCategory,
  createReviewerDoctor,
  createPost,
  patchPost,
  getAdminPost,
  doctorApprove,
  deletePostPermanently,
  publicPosts,
  publicPostDetail,
  listActivePackagesCount,
  type Z1Specialty,
  type Z1Category,
  type Z1Doctor,
} from "./support/blog-z1-fixtures";

/**
 * qa-agent — Paket Z1 blog altyapisi e2e (docs/prompts/2026-10-30-Z-blog-yenileme-100-yazi.md "Testler (Z1)").
 *
 * Yerel ortam notu: saas_e2e'de VARSAYILAN DIL TR'dir (canli ortamda EN). Bu yuzden kanonik metinler Turkce,
 * EN metinler `translations.en` ile verilir ve /en/blog adresleri test edilir. Varsayilan dile bagli beklentiler
 * (ornegin /en/blog/page/1 yonlendirme hedefi) `GET /locales` ile dinamik hesaplanir.
 *
 * Veri: describe-seviyesi `beforeAll` TEK bir hekim (2FA'li kullanicisiyla), iki uzmanlik, iki kategori ve
 * `qa-z1-` onekli yazilar kurar; `afterAll` hepsini siler. Sayfalama ve yayin-akisi testleri kendi yazilarini
 * kurup kendileri temizler. Hekim kullanicisi (User) projedeki diger fixture kullanicilari gibi kalici birakilir
 * (silme ucu yok).
 */
const RUN = Date.now().toString(36);
/** Onbellek (sunucu fetch cache) koşular arası bayat kalmasın diye uzmanlık/yazı/hekim slug'ları koşuya özgü. */
const TOPIC = { cardio: `qa-z1-cardio-${RUN}`, derm: `qa-z1-derm-${RUN}`, pag: `qa-z1-pag-${RUN}` };
const DOCTOR_SLUG = `qa-z1-doctor-${RUN}`;
const DOCTOR_EMAIL = `qa-e2e-z1-doctor-${RUN}@example.com`;
const DOCTOR_PASSWORD = "Mellow-Harbor-4471-Vq!";
const SHOT_DIR = path.resolve(process.cwd(), "..", "docs", "prompts", "2026-10-30-Z-ekran");

test.use({ navigationTimeout: 120_000, actionTimeout: 20_000 });

let adminToken: string;
let initialTelehealthEnabled = true;
let doctorTotpSecret: string;
let doctorToken: string;
let doctor: Z1Doctor;
let cardio: Z1Specialty;
let derm: Z1Specialty;
let medicalCat: Z1Category;
let travelCat: Z1Category;
const createdPostIds: string[] = [];
let reviewerName = "";

const SLUG = {
  a: `${Z1_PREFIX}heart-guide-${RUN}`,
  b: `${Z1_PREFIX}zebracardia-checkup-${RUN}`,
  c: `${Z1_PREFIX}skin-care-basics-${RUN}`,
  draft: `${Z1_PREFIX}draft-post-${RUN}`,
  travel: `${Z1_PREFIX}travel-checklist-${RUN}`,
};
const TITLE_EN = {
  a: "QA Z1 Heart Health Guide",
  b: "QA Z1 Zebracardia Checkup Guide",
  c: "QA Z1 Skin Care Basics",
  travel: "QA Z1 Medical Travel Checklist",
};

const H2 = { why: "Why heart health matters", when: "When to see a physician", prevent: "Everyday prevention" };
const H3 = { early: "Early warning signs", nutrition: "Nutrition basics" };

function paragraphs(n: number, topic: string): string {
  return Array.from({ length: n }, (_, i) => `<p>${topic} paragraph ${i + 1}. This is neutral fixture text written for automated tests only and does not contain medical advice. It is long enough to give the page some scroll height so that sticky behaviour can be observed.</p>`).join("");
}

function articleHtmlEn(topic: string): string {
  return (
    `<p>Introduction about ${topic}.</p>` +
    `<h2>${H2.why}</h2>${paragraphs(4, topic)}` +
    `<h3>${H3.early}</h3>${paragraphs(3, topic)}` +
    `<h2>${H2.when}</h2>${paragraphs(4, topic)}` +
    `<h2>${H2.prevent}</h2>${paragraphs(3, topic)}` +
    `<h3>${H3.nutrition}</h3>${paragraphs(4, topic)}`
  );
}

function articleHtmlTr(topic: string): string {
  return `<p>${topic} hakkinda giris.</p><h2>Neden onemli</h2><p>Test icerigi.</p><h3>Ilk belirtiler</h3><p>Test icerigi.</p><h2>Ne zaman hekime gidilmeli</h2><p>Test icerigi.</p>`;
}

const REFERENCES = [
  { title: "QA reference one", publisher: "Example Society", url: "https://example.com/reference-one", accessedAt: "2026-10-01" },
  { title: "QA reference two", publisher: "Example Journal", url: "https://example.com/reference-two", accessedAt: "2026-10-02" },
];
const FAQ_EN = [
  { question: "Is this fixture real advice?", answer: "No, it is only a test fixture." },
  { question: "Can I rely on it?", answer: "No. Please talk to a physician." },
];
const TAKEAWAYS_EN = ["First fixture takeaway", "Second fixture takeaway", "Third fixture takeaway"];

// ---------------------------------------------------------------------------------------------------------------------
// Yardimcilar
// ---------------------------------------------------------------------------------------------------------------------

/** Konsol hatalari + pageerror toplayici (hidrasyon uyarilari `console.error` olarak gelir). */
function trackConsole(page: Page, expectedUrl?: RegExp) {
  const errors: string[] = [];
  const ignored: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = `${m.text()} @ ${m.location().url}`;
    // Yerel ortamda /uploads goreli medya adresleri :3000/:3100'de 404 verir (bilinen, ilgisiz; bkz. proje notlari).
    // Anonim ziyaretcide AuthProvider'in `POST /auth/refresh` istegi 401 doner; tarayici bunu console.error yazar (blogla ilgisiz).
    if (/Failed to load resource/.test(m.text()) && /\/uploads\/|favicon|\/auth\/(refresh|me)/.test(m.location().url)) ignored.push(text);
    else if (expectedUrl && /Failed to load resource/.test(m.text()) && expectedUrl.test(m.location().url)) ignored.push(text);
    else errors.push(`console.error: ${text}`);
  });
  return {
    errors,
    ignored,
    assertClean() {
      expect(errors, `Konsol hatalari:\n${errors.join("\n")}`).toEqual([]);
    },
  };
}

/** ISR/onbellek gecikmesine karsi: sayfaya git + hazir olana kadar yeniden dene. */
async function gotoUntil(page: Page, url: string, ready: () => Promise<void>, timeout = 90_000): Promise<void> {
  await expect(async () => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await ready();
  }).toPass({ timeout, intervals: [1_000, 3_000, 5_000] });
}

function robotsContent(page: Page): Promise<string | null> {
  return page.locator('meta[name="robots"]').first().getAttribute("content", { timeout: 2_000 }).catch(() => null);
}

/** React hidrasyonu bitene kadar bekler (hidrasyondan once yapilan etkilesim sahte "hydration mismatch" uyarisi uretir). */
async function waitHydrated(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps"));
  }, selector);
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function defaultLocaleCode(): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/locales`);
  const body = (await res.json()) as { data: { code: string; isDefault: boolean }[] };
  return body.data.find((l) => l.isDefault)?.code ?? "en";
}

async function jsonLd(page: Page): Promise<Record<string, unknown>[]> {
  const raw = await page.locator('script[type="application/ld+json"]').allTextContents();
  return raw.map((r) => JSON.parse(r) as Record<string, unknown>);
}

async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: opts.fullPage ?? false, animations: "disabled" });
}

/** Yerel `/uploads` adreslerini backend'e yonlendirir (goreli medya URL'leri :3100'de 404 verir). */
async function forwardUploads(page: Page): Promise<void> {
  await page.route("**/uploads/**", async (route) => {
    const url = new URL(route.request().url());
    await route.continue({ url: `http://localhost:4001${url.pathname}${url.search}` }).catch(() => route.abort());
  });
}

/** Giris sayfasi tarayici diline gore EN/TR gelebiliyor; baglam `tr-TR` ile acilir, etiketler yine de iki dilli eslesir. */
async function loginAs(browser: Browser, email: string, password: string, totpSecret?: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    baseURL: process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100",
    viewport: { width: 1440, height: 900 },
    locale: "tr-TR",
  });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel(/E-posta|Email/).fill(email);
  await page.getByLabel(/Şifre|Password/).fill(password);
  await page.getByRole("button", { name: /Giriş yap|Sign in/ }).click();
  if (totpSecret) {
    await expect(page.getByText(/İki adımlı doğrulama|Two-step|Two-factor/i)).toBeVisible({ timeout: 20_000 });
    await page.getByLabel(/Authenticator/).fill(await nextTotpCode(totpSecret));
    await page.getByRole("button", { name: /Doğrula|Verify/ }).click();
    await page.waitForURL(/\/doctor/, { timeout: 30_000 });
  } else {
    await page.waitForURL((url) => url.pathname !== "/login", { timeout: 30_000 });
  }
  return { page, close: () => context.close() };
}

async function publishViaDoctor(post: { id: string }): Promise<void> {
  await doctorApprove(doctorToken, post.id);
  await patchPost(adminToken, post.id, { status: "PUBLISHED" });
}

// ---------------------------------------------------------------------------------------------------------------------
// Kurulum / temizlik
// ---------------------------------------------------------------------------------------------------------------------

test.beforeAll(async () => {
  test.setTimeout(240_000);
  adminToken = (await getCachedAdminSession()).accessToken;
  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  if (!initialTelehealthEnabled) await patchSiteModule(adminToken, "telehealth", true);

  cardio = await createSpecialty(adminToken, { name: "QA Z1 Kardiyoloji", slug: TOPIC.cardio, enName: "QA Z1 Cardiology" });
  derm = await createSpecialty(adminToken, { name: "QA Z1 Dermatoloji", slug: TOPIC.derm, enName: "QA Z1 Dermatology", icon: "scan-face" });
  medicalCat = await createCategory(adminToken, { name: "QA Z1 Medical guide", slug: `${Z1_PREFIX}medical`, isMedical: true });
  travelCat = await createCategory(adminToken, { name: "Health travel guide", slug: `${Z1_PREFIX}health-travel-guide`, isMedical: false });

  doctor = await createReviewerDoctor(adminToken, { fullName: "Zehra Qaztest", specialtyId: cardio.id, slug: DOCTOR_SLUG });
  doctorToken = await getFixtureUserToken(DOCTOR_EMAIL, DOCTOR_PASSWORD, "Bulut Hekim");
  const user = await adminGetUserByEmail(adminToken, DOCTOR_EMAIL);
  if (!user) throw new Error("Z1 doktor kullanicisi bulunamadi.");
  await linkDoctorUserRaw(adminToken, doctor.id, user.id);
  doctorTotpSecret = (await setupAndEnableTwoFactorForSelf(doctorToken, DOCTOR_PASSWORD)).secret;

  const make = async (opts: {
    slug: string;
    title: string;
    titleEn: string;
    specialty: Z1Specialty;
    featured?: boolean;
    faq?: boolean;
    ar?: boolean;
    topic: string;
  }) => {
    const post = await createPost(adminToken, {
      title: opts.title,
      slug: opts.slug,
      excerpt: `${opts.title} ozeti`,
      contentHtml: articleHtmlTr(opts.topic),
      categoryId: medicalCat.id,
      specialtyId: opts.specialty.id,
      reviewerDoctorId: doctor.id,
      isFeatured: opts.featured ?? false,
      keyTakeaways: ["Birinci madde", "Ikinci madde"],
      references: REFERENCES,
      translations: {
        en: {
          title: opts.titleEn,
          excerpt: `${opts.titleEn} excerpt for the listing page.`,
          contentHtml: articleHtmlEn(opts.topic),
          seoTitle: `${opts.titleEn} | SEO`,
          seoDescription: `${opts.titleEn} meta description.`,
          keyTakeaways: TAKEAWAYS_EN,
          ...(opts.faq ? { faq: FAQ_EN } : {}),
        },
        ...(opts.ar
          ? {
              ar: {
                title: "دليل صحة القلب QA Z1",
                excerpt: "ملخص تجريبي للدليل الصحي.",
                contentHtml: "<p>مقدمة تجريبية.</p><h2>لماذا يهم الأمر</h2><p>نص تجريبي للاختبار فقط.</p><h2>متى تزور الطبيب</h2><p>نص تجريبي للاختبار فقط.</p>",
                keyTakeaways: ["النقطة الأولى", "النقطة الثانية"],
              },
            }
          : {}),
      },
    });
    createdPostIds.push(post.id);
    await publishViaDoctor(post);
    return post;
  };

  // Yayin sirasi: en yeni son.
  await make({ slug: SLUG.c, title: "QA Z1 Cilt Bakimi Temelleri", titleEn: TITLE_EN.c, specialty: derm, topic: "skin care" });
  await make({ slug: SLUG.b, title: "QA Z1 Zebracardia Kontrol Rehberi", titleEn: TITLE_EN.b, specialty: cardio, topic: "zebracardia" });
  await make({ slug: SLUG.a, title: "QA Z1 Kalp Sagligi Rehberi", titleEn: TITLE_EN.a, specialty: cardio, featured: true, faq: true, ar: true, topic: "heart health" });

  // Tibbi olmayan kategori + hekim onayi gerekmez (yalniz ADMIN).
  const travel = await createPost(adminToken, {
    title: "QA Z1 Tibbi Seyahat Kontrol Listesi",
    slug: SLUG.travel,
    excerpt: "Seyahat ozeti",
    contentHtml: articleHtmlTr("travel"),
    categoryId: travelCat.id,
    medicalReviewStatus: "not_required",
    status: "PUBLISHED",
    translations: { en: { title: TITLE_EN.travel, excerpt: "Travel checklist excerpt.", contentHtml: articleHtmlEn("travel") } },
  });
  createdPostIds.push(travel.id);

  // Taslak (404 testi icin) — EN ceviri var ama durum DRAFT.
  const draft = await createPost(adminToken, {
    title: "QA Z1 Taslak Yazi",
    slug: SLUG.draft,
    contentHtml: articleHtmlTr("draft"),
    categoryId: medicalCat.id,
    specialtyId: cardio.id,
    reviewerDoctorId: doctor.id,
    translations: { en: { title: "QA Z1 Draft Post", contentHtml: articleHtmlEn("draft") } },
  });
  createdPostIds.push(draft.id);

  const detail = await publicPostDetail("en", SLUG.a);
  reviewerName = detail?.reviewer?.name ?? "";
  if (!reviewerName) throw new Error("Z1 fixture: yayinlanan yazida reviewer adi bos.");
});

test.afterAll(async () => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const attempt = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      errors.push(`${label}: ${String(err)}`);
    }
  };
  for (const id of createdPostIds) await attempt(`yazi ${id}`, () => deletePostPermanently(adminToken, id));
  if (doctor) await attempt("hekim", () => deleteAdminDoctorFixture(adminToken, doctor.id));
  if (cardio) await attempt("uzmanlik cardio", () => deleteSpecialty(adminToken, cardio.id));
  if (derm) await attempt("uzmanlik derm", () => deleteSpecialty(adminToken, derm.id));
  if (medicalCat) await attempt("kategori medical", () => deleteCategory(adminToken, medicalCat.id));
  if (travelCat) await attempt("kategori travel", () => deleteCategory(adminToken, travelCat.id));
  await attempt("telehealth modul", async () => {
    if (!initialTelehealthEnabled) await patchSiteModule(adminToken, "telehealth", false);
  });
  expect(errors, `Temizlik hatalari:\n${errors.join("\n")}`).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------------
// /en/blog — liste
// ---------------------------------------------------------------------------------------------------------------------

test("liste: Latest blogu, kart izgarasi, toplam sayi, konu filtresi sayilari, CTA, paket blogu yok", async ({ page }) => {
  const con = trackConsole(page);
  await gotoUntil(page, "/en/blog", async () => {
    await expect(page.getByTestId("blog-featured").getByRole("link", { name: "Read the article" })).toHaveAttribute("href", new RegExp(`/en/blog/${SLUG.a}$`), { timeout: 3_000 });
    await expect(page.getByTestId("blog-topic-group").filter({ hasText: "QA Z1 Cardiology" })).toContainText("(2)", { timeout: 3_000 });
    await expect(page.getByTestId("blog-topic-group").filter({ hasText: "QA Z1 Dermatology" })).toContainText("(1)", { timeout: 3_000 });
  });

  await expect(page.getByRole("heading", { level: 1, name: "Health Guides" })).toBeVisible();
  await expect(page.getByText("Patient guides written by our editorial team and reviewed by our physicians.")).toBeVisible();

  // Latest: isFeatured yazi, hekim onay satiri, "Read the article".
  const featured = page.getByTestId("blog-featured");
  await expect(featured.getByTestId("blog-featured-reviewer")).toHaveText(`Reviewed by ${reviewerName}`);
  await expect(featured.getByRole("link", { name: "Read the article" })).toHaveAttribute("href", new RegExp(`/en/blog/${SLUG.a}$`));

  // Kart izgarasi: featured tekrarlanmaz; diger yazilar gorunur; sablon kapak (kapak yok).
  const grid = page.getByTestId("blog-grid");
  await expect(grid).toContainText(TITLE_EN.b);
  await expect(grid).toContainText(TITLE_EN.c);
  await expect(grid).not.toContainText(TITLE_EN.a);
  expect(await page.getByTestId("blog-cover-template").count()).toBeGreaterThan(0);

  // Toplam sayi API ile birebir.
  const apiTotal = (await publicPosts("en", { pageSize: "1" })).total;
  await expect(page.getByTestId("blog-total")).toHaveText(`Articles: ${apiTotal}`);
  await expect(page.getByTestId("blog-topic-all")).toContainText(`(${apiTotal})`);

  // Konu filtresi sayilari (kendi uzmanliklarim: 2 + 1).
  await expect(page.getByTestId("blog-topic-group").filter({ hasText: "QA Z1 Cardiology" })).toContainText("(2)");
  await expect(page.getByTestId("blog-topic-group").filter({ hasText: "QA Z1 Dermatology" })).toContainText("(1)");

  // Ara CTA + editoryal guven satiri bolumu; aktif paket yoksa "Popular packages" yok.
  await expect(page.getByText("Not sure which physician you need?")).toBeVisible();
  if ((await listActivePackagesCount()) === 0) {
    await expect(page.getByText("Popular packages")).toHaveCount(0);
  } else {
    test.info().annotations.push({ type: "atlandi", description: "Aktif paket var: 'Popular packages yok' kontrolu atlandi." });
  }
  con.assertClean();
});

test("konu filtresi: ?topic= liste, sayi ve aria-current'i degistirir", async ({ page }) => {
  const con = trackConsole(page);
  await gotoUntil(page, `/en/blog?topic=${TOPIC.cardio}`, async () => {
    await expect(page.getByTestId("blog-total")).toHaveText("Articles: 2", { timeout: 3_000 });
    await expect(page.getByTestId("blog-topic-group").filter({ hasText: "QA Z1 Cardiology" })).toContainText("(2)", { timeout: 3_000 });
  });
  const group = page.getByTestId("blog-topic-group").filter({ hasText: "QA Z1 Cardiology" });
  await expect(group).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("blog-featured")).toContainText(TITLE_EN.a);
  await expect(page.getByTestId("blog-grid")).toContainText(TITLE_EN.b);
  await expect(page.getByText(TITLE_EN.c)).toHaveCount(0);
  await expect(page.getByText(TITLE_EN.travel)).toHaveCount(0);
  // Konu sayfasi indekslenebilir (noindex degil), canonical konuyu icerir.
  expect((await robotsContent(page)) ?? "").not.toMatch(/noindex/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/en/blog\\?topic=${TOPIC.cardio}$`));

  // Dermatoloji tek yazi.
  await gotoUntil(page, `/en/blog?topic=${TOPIC.derm}`, async () => {
    await expect(page.getByTestId("blog-total")).toHaveText("Articles: 1", { timeout: 3_000 });
  });

  // Bilinmeyen konu: bos durum (404 degil), noindex.
  const res = await page.goto(`/en/blog?topic=${Z1_PREFIX}yok-boyle-konu`);
  expect(res?.status()).toBe(200);
  await expect(page.getByTestId("blog-empty")).toContainText("No articles found");
  expect(await robotsContent(page)).toMatch(/noindex/);
  con.assertClean();
});

test("arama: ?q= sunucu tarafinda suzer ve sayfa noindex olur", async ({ page }) => {
  const con = trackConsole(page);
  await gotoUntil(page, "/en/blog?q=Zebracardia", async () => {
    await expect(page.getByTestId("blog-search-summary")).toBeVisible({ timeout: 3_000 });
  });
  await expect(page.getByTestId("blog-search-summary")).toContainText("Zebracardia");
  await expect(page.getByTestId("blog-total")).toHaveText("Articles: 1");
  await expect(page.getByText(TITLE_EN.b).first()).toBeVisible();
  await expect(page.getByText(TITLE_EN.c)).toHaveCount(0);
  expect(await robotsContent(page)).toMatch(/noindex/);

  // Arama formu: yazinca ayni adrese gider.
  await page.goto("/en/blog");
  await page.getByRole("searchbox").or(page.getByLabel("Search articles")).first().fill("Zebracardia");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/en\/blog\?(.*&)?q=Zebracardia/);

  // Sonuc yok.
  await page.goto("/en/blog?q=qqqnoresultqqq");
  await expect(page.getByTestId("blog-empty")).toContainText("No articles found");
  await expect(page.getByRole("link", { name: "Show all articles" })).toBeVisible();
  con.assertClean();
});

test("sayfalama: /blog/page/2 kendi canonical'i, page/1 yonlendirmesi, aralik disi 404", async ({ page }) => {
  test.setTimeout(240_000);
  const pagSpecialty = await createSpecialty(adminToken, { name: "QA Z1 Sayfalama", slug: TOPIC.pag, enName: "QA Z1 Pagination", icon: "stethoscope" });
  const ids: string[] = [];
  try {
    for (let start = 0; start < 13; start += 5) {
      const chunk = await Promise.all(
        Array.from({ length: Math.min(5, 13 - start) }, async (_, i) => {
          const n = String(start + i + 1).padStart(2, "0");
          const post = await createPost(adminToken, {
            title: `QA Z1 Sayfalama Yazisi ${n}`,
            slug: `${Z1_PREFIX}pag-${RUN}-${n}`,
            excerpt: `Sayfalama ${n}`,
            contentHtml: articleHtmlTr(`pag ${n}`),
            categoryId: travelCat.id,
            specialtyId: pagSpecialty.id,
            medicalReviewStatus: "not_required",
            status: "PUBLISHED",
            translations: { en: { title: `QA Z1 Pagination Post ${n}`, excerpt: `Pagination excerpt ${n}`, contentHtml: articleHtmlEn(`pag ${n}`) } },
          });
          return post.id;
        })
      );
      ids.push(...chunk);
    }
    createdPostIds.push(...ids);

    const con = trackConsole(page);
    const defaultCode = await defaultLocaleCode();
    const enBase = defaultCode === "en" ? "/blog" : "/en/blog";
    const topic = TOPIC.pag;

    await gotoUntil(page, `/en/blog?topic=${topic}`, async () => {
      await expect(page.getByTestId("blog-total")).toHaveText("Articles: 13", { timeout: 3_000 });
    });
    // 12 kartin 1'i "Latest" blogunda, 11'i izgarada.
    await expect(page.getByTestId("blog-featured")).toBeVisible();
    const pagination = page.getByRole("navigation", { name: "Pagination" });
    await expect(pagination).toBeVisible();
    expect((await robotsContent(page)) ?? "").not.toMatch(/noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${enBase}\\?topic=${topic}$`));

    // 2. sayfa: tek yazi, canonical KENDISI (konu sorgusuyla).
    const res2 = await page.goto(`/en/blog/page/2?topic=${topic}`);
    expect(res2?.status()).toBe(200);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/en/blog/page/2\\?topic=${topic}$`));
    expect((await robotsContent(page)) ?? "").not.toMatch(/noindex/);
    await expect(page).toHaveTitle(/Page 2 of 2/);
    await expect(page.getByTestId("blog-total")).toHaveText("Articles: 13");

    // Filtresiz 2. sayfa: toplam > 12 (13 + diger yazilar) oldugundan var; canonical kendisi.
    const res2b = await page.goto("/en/blog/page/2");
    expect(res2b?.status()).toBe(200);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/en\/blog\/page\/2$/);

    // page/1 -> kalici yonlendirme (sorgu korunur).
    await page.goto(`/en/blog/page/1?topic=${topic}`);
    await expect(page).toHaveURL(new RegExp(`${enBase}\\?topic=${topic}$`));
    await page.goto("/en/blog/page/1");
    expect(new URL(page.url()).pathname).toBe(enBase);

    // Aralik disi ve gecersiz sayfa: 404.
    con.assertClean();
    expect((await page.goto(`/en/blog/page/9?topic=${topic}`))?.status()).toBe(404);
    expect((await page.goto("/en/blog/page/abc"))?.status()).toBe(404);
  } finally {
    for (const id of ids) await deletePostPermanently(adminToken, id).catch(() => undefined);
    await deleteSpecialty(adminToken, pagSpecialty.id).catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Yazi sayfasi
// ---------------------------------------------------------------------------------------------------------------------

test("yazi: kunye, icindekiler (baglanti + yapiskan), key takeaways, FAQ akordeonu, References, uyari", async ({ page }) => {
  const con = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoUntil(page, `/en/blog/${SLUG.a}`, async () => {
    await expect(page.getByRole("heading", { level: 1, name: TITLE_EN.a })).toBeVisible({ timeout: 3_000 });
  });

  // Kunye: yazar kurum, hekim (profil baglantisi), Last reviewed, okuma suresi.
  const byline = page.getByTestId("blog-byline");
  await expect(byline).toContainText("WM Health Editorial Team");
  await expect(byline.getByTestId("blog-byline-reviewer")).toContainText("Medically reviewed by");
  await expect(byline.getByRole("link", { name: new RegExp(escapeRe(reviewerName)) })).toHaveAttribute("href", new RegExp(`/physicians/${DOCTOR_SLUG}$`));
  await expect(page.getByTestId("blog-last-reviewed")).toContainText(/Last reviewed: .+/);
  await expect(byline).toContainText(/\d+ min read/);

  // Key takeaways.
  const takeaways = page.getByTestId("blog-key-takeaways");
  await expect(takeaways).toContainText("Key takeaways");
  for (const item of TAKEAWAYS_EN) await expect(takeaways).toContainText(item);

  // Icindekiler: H2/H3 baglantilari, tiklayinca basliga gider.
  const toc = page.getByTestId("blog-toc");
  await expect(toc).toBeVisible();
  await expect(page.getByTestId("blog-toc-mobile")).toBeHidden();
  for (const text of [H2.why, H3.early, H2.when, H2.prevent, H3.nutrition]) {
    await expect(toc.getByRole("link", { name: text })).toBeVisible();
  }
  const whenLink = toc.getByRole("link", { name: H2.when });
  const href = await whenLink.getAttribute("href");
  expect(href).toMatch(/^#.+/);
  await whenLink.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  const heading = page.getByRole("heading", { level: 2, name: H2.when });
  await expect(heading).toBeInViewport();
  expect(await heading.getAttribute("id")).toBe(href!.slice(1));
  // Kaydirmada aktif baslik vurgulanir.
  await expect(toc.locator('[aria-current="location"]')).toHaveCount(1, { timeout: 5_000 });

  // Yapiskan: asagi kaydirinca yan sutun gorunur kalir.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.6));
  await expect(toc).toBeInViewport();

  // FAQ akordeonu.
  const faq = page.getByTestId("blog-faq");
  await faq.scrollIntoViewIfNeeded();
  await waitHydrated(page, '[data-testid="blog-faq"] button');
  const q1 = faq.getByRole("button", { name: FAQ_EN[0]!.question });
  await expect(q1).toHaveAttribute("aria-expanded", "false");
  await expect(faq.getByText(FAQ_EN[0]!.answer)).toBeHidden();
  await q1.click();
  await expect(q1).toHaveAttribute("aria-expanded", "true");
  await expect(faq.getByText(FAQ_EN[0]!.answer)).toBeVisible();
  await q1.click();
  await expect(q1).toHaveAttribute("aria-expanded", "false");

  // References + sabit uyari.
  const refsHeading = page.getByRole("heading", { name: "References" });
  await expect(refsHeading).toBeVisible();
  const refLink = page.getByRole("link", { name: /QA reference one/ });
  await expect(refLink).toHaveAttribute("href", "https://example.com/reference-one");
  await expect(refLink).toHaveAttribute("rel", /noopener/);
  await expect(page.getByText(/Accessed /).first()).toBeVisible();
  await expect(page.getByTestId("blog-disclaimer")).toHaveText("This article is for general information and is not a substitute for a medical consultation.");

  // Hekim danisma karti + ilgili yazilar.
  await expect(page.getByText("Consult a physician").first()).toBeVisible();
  await expect(page.getByTestId("blog-related")).toBeVisible();
  con.assertClean();
});

test("yazi (mobil): icindekiler acilir kutu olarak gelir, yan sutun gizli", async ({ page }) => {
  const con = trackConsole(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoUntil(page, `/en/blog/${SLUG.a}`, async () => {
    await expect(page.getByRole("heading", { level: 1, name: TITLE_EN.a })).toBeVisible({ timeout: 3_000 });
  });
  await expect(page.getByTestId("blog-toc")).toBeHidden();
  const mobile = page.getByTestId("blog-toc-mobile");
  await expect(mobile).toBeVisible();
  await waitHydrated(page, '[data-testid="blog-toc-mobile"]');
  await mobile.locator("summary").click();
  await expect(mobile.getByRole("link", { name: H2.prevent })).toBeVisible();
  await mobile.getByRole("link", { name: H2.prevent }).click();
  await expect(page.getByRole("heading", { level: 2, name: H2.prevent })).toBeInViewport();
  // Yatay tasma yok.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  con.assertClean();
});

test("yazi SEO: JSON-LD (MedicalWebPage+Article, reviewedBy, lastReviewed, FAQPage) ve hreflang yalniz cevirisi olan dillerde", async ({ page }) => {
  const con = trackConsole(page);
  await gotoUntil(page, `/en/blog/${SLUG.a}`, async () => {
    await expect(page.getByRole("heading", { level: 1, name: TITLE_EN.a })).toBeVisible({ timeout: 3_000 });
  });

  const blocks = await jsonLd(page);
  const main = blocks.find((b) => JSON.stringify(b["@type"]).includes("MedicalWebPage"));
  expect(main, "MedicalWebPage JSON-LD yok").toBeTruthy();
  expect(main!["@type"]).toEqual(expect.arrayContaining(["MedicalWebPage", "Article"]));
  expect(main!.headline).toBe(TITLE_EN.a);
  expect(main!.inLanguage).toBe("en");
  expect(main!.author).toMatchObject({ "@type": "Organization", name: "WM Health Editorial Team" });
  expect(main!.about).toMatchObject({ "@type": "MedicalSpecialty", name: "QA Z1 Cardiology" });
  expect(main!.reviewedBy).toMatchObject({ "@type": "Physician", name: reviewerName });
  expect(String((main!.reviewedBy as { url: string }).url)).toMatch(new RegExp(`/physicians/${DOCTOR_SLUG}$`));
  expect(typeof main!.lastReviewed).toBe("string");
  expect(Number.isNaN(Date.parse(main!.lastReviewed as string))).toBe(false);
  expect(String(main!.url)).toMatch(new RegExp(`/en/blog/${SLUG.a}$`));

  const faq = blocks.find((b) => b["@type"] === "FAQPage");
  expect(faq, "FAQPage JSON-LD yok").toBeTruthy();
  const entities = faq!.mainEntity as { name: string; acceptedAnswer: { text: string } }[];
  expect(entities.map((e) => e.name)).toEqual(FAQ_EN.map((f) => f.question));

  // hreflang: A = tr (varsayilan) + en + ar; de YOK.
  const hreflangsA = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((els) => els.map((e) => e.getAttribute("hreflang")));
  expect(hreflangsA).toEqual(expect.arrayContaining(["tr", "en", "ar"]));
  expect(hreflangsA).not.toContain("de");

  // B: AR cevirisi yok -> ar hreflang'i yok; FAQ yok -> FAQPage yok.
  await gotoUntil(page, `/en/blog/${SLUG.b}`, async () => {
    await expect(page.getByRole("heading", { level: 1, name: TITLE_EN.b })).toBeVisible({ timeout: 3_000 });
  });
  const hreflangsB = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((els) => els.map((e) => e.getAttribute("hreflang")));
  expect(hreflangsB).toEqual(expect.arrayContaining(["tr", "en"]));
  expect(hreflangsB).not.toContain("ar");
  expect(hreflangsB).not.toContain("de");
  const blocksB = await jsonLd(page);
  expect(blocksB.some((b) => b["@type"] === "FAQPage")).toBe(false);

  // Kanonik/OG: robots noindex degil.
  expect((await robotsContent(page)) ?? "").not.toMatch(/noindex/);
  con.assertClean();
});

test("yazi: paylasim baglantilari (kopyala, WhatsApp, e-posta) ve ucuncu taraf script yok", async ({ page, context }) => {
  const con = trackConsole(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  await gotoUntil(page, `/en/blog/${SLUG.a}`, async () => {
    await expect(page.getByTestId("blog-share")).toBeVisible({ timeout: 3_000 });
  });
  const share = page.getByTestId("blog-share");
  const wa = share.getByTestId("blog-share-whatsapp");
  await expect(wa).toHaveAttribute("href", /^https:\/\/wa\.me\//);
  await expect(wa).toHaveAttribute("rel", /noopener/);
  expect(decodeURIComponent((await wa.getAttribute("href"))!)).toContain(`/en/blog/${SLUG.a}`);
  await expect(share.getByTestId("blog-share-email")).toHaveAttribute("href", /^mailto:\?/);
  await waitHydrated(page, '[data-testid="blog-share-copy"]');
  await share.getByTestId("blog-share-copy").click();
  await expect(share.getByRole("status")).toHaveText("Link copied");

  // Ucuncu taraf script yok: tum <script src> ayni "localhost" ailesinden.
  const hosts = await page.evaluate(() => [...document.scripts].map((s) => s.src).filter(Boolean).map((s) => new URL(s).hostname));
  const foreign = hosts.filter((h) => !(h === "localhost" || h.endsWith(".localhost")));
  expect(foreign, `Ucuncu taraf script: ${foreign.join(", ")}`).toEqual([]);
  con.assertClean();
});

test("404: taslak yazi ve cevirisi olmayan dil", async ({ page }) => {
  // Taslak (EN cevirisi var ama yayinda degil).
  expect((await page.goto(`/en/blog/${SLUG.draft}`))?.status()).toBe(404);
  expect((await page.goto(`/blog/${SLUG.draft}`))?.status()).toBe(404);
  // Yayinda ama DE cevirisi yok.
  expect((await page.goto(`/de/blog/${SLUG.a}`))?.status()).toBe(404);
  // B'nin AR cevirisi yok.
  expect((await page.goto(`/ar/blog/${SLUG.b}`))?.status()).toBe(404);
  // Olmayan slug.
  expect((await page.goto(`/en/blog/${Z1_PREFIX}yok-boyle-yazi`))?.status()).toBe(404);
  // Kontrol: cevirisi olan dil 200.
  expect((await page.goto(`/en/blog/${SLUG.a}`))?.status()).toBe(200);
});

test("RTL: /ar/blog ve /ar/blog/<slug> dir=rtl", async ({ page }) => {
  const con = trackConsole(page);
  await gotoUntil(page, "/ar/blog", async () => {
    await expect(page.getByTestId("blog-index")).toBeVisible({ timeout: 3_000 });
  });
  await expect(page.getByTestId("blog-index")).toHaveAttribute("dir", "rtl");
  expect(await page.getByTestId("blog-index").evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
  // Yalniz AR cevirisi olan yazi listelenir.
  await expect(page.getByTestId("blog-featured")).toContainText("دليل صحة القلب QA Z1");
  await expect(page.getByText(TITLE_EN.b)).toHaveCount(0);
  const htmlDir = await page.locator("html").getAttribute("dir");
  test.info().annotations.push({ type: "html-dir", description: `/ar/blog html[dir]=${htmlDir}` });

  await gotoUntil(page, `/ar/blog/${SLUG.a}`, async () => {
    await expect(page.getByTestId("blog-post")).toBeVisible({ timeout: 3_000 });
  });
  await expect(page.getByTestId("blog-post")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("دليل صحة القلب QA Z1");
  expect(await page.getByTestId("blog-post").evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  con.assertClean();
});

// ---------------------------------------------------------------------------------------------------------------------
// Ekran goruntuleri (herkese acik)
// ---------------------------------------------------------------------------------------------------------------------

test("ekran goruntuleri: herkese acik sayfalar (masaustu 1440 / mobil 390)", async ({ browser }) => {
  test.setTimeout(300_000);
  const sizes = [
    { key: "masaustu", width: 1440, height: 900 },
    { key: "mobil", width: 390, height: 844 },
  ] as const;
  for (const size of sizes) {
    const context = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100", viewport: { width: size.width, height: size.height } });
    const page = await context.newPage();
    const con = trackConsole(page);
    await forwardUploads(page);
    const desktop = size.key === "masaustu";
    const prefix = desktop ? "0" : "1";

    await gotoUntil(page, "/en/blog", async () => {
      await expect(page.getByTestId("blog-featured").getByRole("link", { name: "Read the article" })).toHaveAttribute("href", new RegExp(`/en/blog/${SLUG.a}$`), { timeout: 3_000 });
    });
    await shot(page, `${prefix}1-${size.key}-en-blog-latest-izgara-cta-sablon-kapak.png`, { fullPage: true });

    await gotoUntil(page, `/en/blog?topic=${TOPIC.cardio}`, async () => {
      await expect(page.getByTestId("blog-total")).toHaveText("Articles: 2", { timeout: 3_000 });
    await expect(page.getByTestId("blog-topic-group").filter({ hasText: "QA Z1 Cardiology" })).toContainText("(2)", { timeout: 3_000 });
    });
    await shot(page, `${prefix}2-${size.key}-en-blog-konu-filtresi.png`, { fullPage: true });

    await gotoUntil(page, `/en/blog/${SLUG.a}`, async () => {
      await expect(page.getByRole("heading", { level: 1, name: TITLE_EN.a })).toBeVisible({ timeout: 3_000 });
    });
    if (desktop) {
      await page.evaluate(() => window.scrollTo(0, 900));
      await page.waitForTimeout(400);
      await shot(page, "03-masaustu-en-yazi-yapiskan-icindekiler.png");
    } else {
      await waitHydrated(page, '[data-testid="blog-toc-mobile"]');
      await page.getByTestId("blog-toc-mobile").locator("summary").click();
      await page.getByTestId("blog-toc-mobile").scrollIntoViewIfNeeded();
      await shot(page, "13-mobil-en-yazi-acilir-icindekiler.png");
      await shot(page, "13b-mobil-en-yazi-tam-sayfa.png", { fullPage: true });
    }
    const faq = page.getByTestId("blog-faq");
    await faq.scrollIntoViewIfNeeded();
    await waitHydrated(page, '[data-testid="blog-faq"] button');
    await faq.getByRole("button").first().click();
    await faq.getByRole("button").nth(1).click();
    await page.evaluate(() => document.querySelector('[data-testid="blog-faq"]')?.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(400);
    await shot(page, `${prefix}4-${size.key}-en-yazi-faq-acik-kaynaklar.png`);

    await gotoUntil(page, "/ar/blog", async () => {
      await expect(page.getByTestId("blog-index")).toBeVisible({ timeout: 3_000 });
    });
    await shot(page, `${prefix}5-${size.key}-ar-blog-rtl.png`, { fullPage: true });
    await gotoUntil(page, `/ar/blog/${SLUG.a}`, async () => {
      await expect(page.getByTestId("blog-post")).toBeVisible({ timeout: 3_000 });
    });
    await shot(page, `${prefix}6-${size.key}-ar-yazi-rtl.png`, { fullPage: true });
    await gotoUntil(page, `/tr/blog/${SLUG.a}`, async () => {
      await expect(page.getByTestId("blog-post")).toBeVisible({ timeout: 3_000 });
    });
    await shot(page, `${prefix}7-${size.key}-tr-yazi.png`, { fullPage: true });
    con.assertClean();
    await context.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Yayin kurali — uctan uca (admin + doktor paneli + ziyaretci)
// ---------------------------------------------------------------------------------------------------------------------

test("yayin kurali: onaysiz yayinlanamaz -> hekim Request changes -> admin not gorur -> Approve -> yayin -> ziyaretci 'Reviewed by'", async ({ browser }) => {
  test.setTimeout(480_000);
  const slug = `${Z1_PREFIX}flow-post-${RUN}`;
  const titleTr = "QA Z1 Akis Yazisi";
  const titleEn = "QA Z1 Flow Article";
  const note = "Lutfen ikinci bolumdeki rakamlari kaynakla dogrulayin. (QA Z1 notu)";
  const post = await createPost(adminToken, {
    title: titleTr,
    slug,
    excerpt: "Akis ozeti",
    contentHtml: articleHtmlTr("flow"),
    categoryId: medicalCat.id,
    specialtyId: derm.id,
    reviewerDoctorId: doctor.id,
    translations: { en: { title: titleEn, excerpt: "Flow excerpt for the listing.", contentHtml: articleHtmlEn("flow"), keyTakeaways: ["Flow takeaway"] } },
  });
  createdPostIds.push(post.id);

  const admin = await loginAs(browser, ADMIN_EMAIL, ADMIN_PASSWORD);
  const doc = await loginAs(browser, DOCTOR_EMAIL, DOCTOR_PASSWORD, doctorTotpSecret);
  const adminCon = trackConsole(admin.page, /\/admin\/blog\/[0-9a-f-]{36}$/); // bilerek tetiklenen 422 (onaysiz yayin)
  const docCon = trackConsole(doc.page);
  try {
    await admin.page.setViewportSize({ width: 1440, height: 900 });
    await forwardUploads(admin.page);

    // 1) Admin: onaysiz yazi PUBLISHED yapilamaz — alan hatasi gorunur.
    await admin.page.goto(`/admin/blog/${post.id}`);
    const panel = admin.page.getByTestId("blog-review-panel");
    await expect(panel).toBeVisible({ timeout: 60_000 });
    await expect(panel.getByTestId("blog-review-status")).toContainText("Onay bekliyor");
    await panel.scrollIntoViewIfNeeded();
    await shot(admin.page, "21-admin-editor-tibbi-inceleme-paneli.png", { fullPage: true });
    await admin.page.locator("#status").selectOption("PUBLISHED");
    await admin.page.getByRole("button", { name: "Kaydet" }).click();
    const statusError = admin.page.locator("#statusWrite-error");
    await expect(statusError).toBeVisible({ timeout: 20_000 });
    await expect(statusError).toContainText(/approved|onay/i);
    await statusError.scrollIntoViewIfNeeded();
    await shot(admin.page, "22-admin-editor-422-hata-hekim-onayi-gerekli.png", { fullPage: true });
    expect((await getAdminPost(adminToken, post.id)).status).toBe("DRAFT");

    // 2) Doktor paneli: yazi listelenir -> Request changes (not zorunlu).
    const docBase = "/en/doctor/blog-review";
    await doc.page.goto(docBase);
    const card = doc.page.getByTestId("doctor-blog-review-item").filter({ hasText: titleTr });
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText(/Awaiting review|İnceleme bekliyor/);
    await shot(doc.page, "24-doktor-inceleme-listesi.png", { fullPage: true });
    await card.getByRole("button", { name: /^(Request changes|Değişiklik iste)$/ }).click();
    await card.getByRole("button", { name: /^(Send note|Notu gönder)$/ }).click();
    await expect(card.getByRole("alert")).toContainText(/Please write a note|Lütfen bir not yazın/);
    await card.getByLabel(/Note for the editorial team|Editör ekibi için not/).fill(note);
    await shot(doc.page, "25-doktor-degisiklik-iste-not-formu-acik.png", { fullPage: true });
    await card.getByRole("button", { name: /^(Send note|Notu gönder)$/ }).click();
    await expect(doc.page.getByTestId("doctor-blog-review-item").filter({ hasText: titleTr })).toHaveCount(0, { timeout: 20_000 });

    // 3) Admin tarafinda rozet + not.
    await admin.page.goto(`/admin/blog/${post.id}`);
    const status = admin.page.getByTestId("blog-review-status");
    await expect(status).toContainText("Değişiklik istendi", { timeout: 60_000 });
    await expect(admin.page.getByTestId("blog-review-note")).toContainText(note);
    await shot(admin.page, "26-admin-editor-degisiklik-istendi-hekim-notu.png", { fullPage: true });
    // Hala yayinlanamaz.
    await admin.page.locator("#status").selectOption("PUBLISHED");
    await admin.page.getByRole("button", { name: "Kaydet" }).click();
    await expect(admin.page.locator("#statusWrite-error")).toBeVisible({ timeout: 20_000 });
    expect((await getAdminPost(adminToken, post.id)).status).toBe("DRAFT");

    // 4) Doktor: kuyrukta hala (changes_requested) + onceki not -> Approve.
    await doc.page.goto(docBase);
    const card2 = doc.page.getByTestId("doctor-blog-review-item").filter({ hasText: titleTr });
    await expect(card2).toBeVisible({ timeout: 60_000 });
    await expect(card2).toContainText(/Changes requested|Değişiklik istendi/);
    await expect(card2).toContainText(note);
    await card2.getByRole("button", { name: /^(Preview the article|Yazıyı önizle)$/ }).click();
    await expect(card2.getByTestId("doctor-blog-review-preview")).toBeVisible();
    await card2.getByRole("button", { name: /^(Approve|Onayla)$/ }).click();
    await expect(doc.page.getByTestId("doctor-blog-review-item").filter({ hasText: titleTr })).toHaveCount(0, { timeout: 20_000 });

    // 5) Admin: Onaylandi -> yayinlayabilir.
    await admin.page.goto(`/admin/blog/${post.id}`);
    await expect(admin.page.getByTestId("blog-review-status")).toContainText("Onaylandı", { timeout: 60_000 });
    await expect(admin.page.getByTestId("blog-review-status")).toContainText(/Son onay:/);
    await admin.page.locator("#status").selectOption("PUBLISHED");
    await admin.page.getByRole("button", { name: "Kaydet" }).click();
    await expect(admin.page.getByText("Yazı kaydedildi.")).toBeVisible({ timeout: 20_000 });
    expect((await getAdminPost(adminToken, post.id)).status).toBe("PUBLISHED");

    // 6) Ziyaretci: listede "Reviewed by", yazi sayfasinda Last reviewed.
    const visitor = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100", viewport: { width: 1440, height: 900 } });
    const vp = await visitor.newPage();
    const vCon = trackConsole(vp);
    try {
      await gotoUntil(vp, `/en/blog/${slug}`, async () => {
        await expect(vp.getByRole("heading", { level: 1, name: titleEn })).toBeVisible({ timeout: 3_000 });
      });
      await expect(vp.getByTestId("blog-byline-reviewer")).toContainText(reviewerName);
      await expect(vp.getByTestId("blog-last-reviewed")).toContainText(/Last reviewed: .+/);
      const cardOnList = async () => {
        await vp.goto(`/en/blog?topic=${TOPIC.derm}`);
        await expect(vp.getByText(titleEn).first()).toBeVisible({ timeout: 3_000 });
        await expect(vp.getByText(`Reviewed by ${reviewerName}`).first()).toBeVisible({ timeout: 3_000 });
      };
      await expect(cardOnList).toPass({ timeout: 90_000, intervals: [1_000, 3_000, 5_000] });
      vCon.assertClean();
    } finally {
      await visitor.close();
    }

    // 7) Admin kategoriler: Tibbi kategori anahtari.
    await admin.page.goto("/admin/blog/categories");
    const medicalSwitch = admin.page.getByRole("switch", { name: `"QA Z1 Medical guide" kategorisi tıbbi` });
    const travelSwitch = admin.page.getByRole("switch", { name: `"Health travel guide" kategorisi tıbbi` });
    await expect(medicalSwitch).toBeVisible({ timeout: 60_000 });
    await expect(medicalSwitch).toBeChecked();
    await expect(travelSwitch).not.toBeChecked();
    await shot(admin.page, "23-admin-kategoriler-tibbi-kategori-anahtari.png", { fullPage: true });

    adminCon.assertClean();
    docCon.assertClean();
  } finally {
    await admin.close();
    await doc.close();
  }
});
