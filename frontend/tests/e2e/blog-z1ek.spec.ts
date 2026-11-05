import path from "node:path";
import { mkdirSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession, getSiteModules, patchSiteModule, setupAndEnableTwoFactorForSelf } from "./support/api";
import { adminGetUserByEmail } from "./support/admin-users-fixtures";
import { linkDoctorUserRaw, deleteAdminDoctorFixture } from "./support/telehealth-fixtures";
import { createCategory, deleteCategory, createPost, patchPost, doctorApprove, deletePostPermanently, publicPosts, deleteSpecialty, type Z1Category } from "./support/blog-z1-fixtures";
import {
  Z1EK_PREFIX,
  fixtureUserTokenWithRetry,
  createSpecialtyI18n,
  createDoctorWithAvatar,
  findMediaIdByFilename,
  publicReviewers,
  createCmsPage,
  deleteCmsPage,
  findAdminPageIdBySlug,
  type Z1ekSpecialty,
  type Z1ekDoctor,
} from "./support/blog-z1ek-fixtures";
import { SHOT_PAGES, shotBuilderBlocks, shotLegalBlocks } from "./support/blog-z1ek-shot-content";

// AL (İş 2) ATLA: blog yazısında hekim onayı/inceleme akışı: 'blogMedicalReviewRequired' ayarı varsayılan KAPALI (AH kararı: hekim onayı şartı bayrakla kapandı, kod silinmedi). Bu spec hekim onayı bekleyen yazı, reviewer adı/rozeti ve 'physicians' boş durum metnini sınıyor
// Açmak için: admin ayarlarında blogMedicalReviewRequired=true (ve doktorların ziyaretçiye açılması: DOCTORS_VISIBLE_TO_VISITORS=true).
test.skip(true, "AL: blog yazısında hekim onayı/inceleme akışı: 'blogMedicalReviewRequired' ayarı varsayılan KAPALI (AH kararı: hekim onayı şartı bayrakla kapandı, kod silinmedi). Bu spec hekim onayı bekleyen yazı, reviewer adı/rozeti ve 'physicians' boş durum metnini sınıyor (admin ayarlarında blogMedicalReviewRequired=true (ve doktorların ziyaretçiye açılması: DOCTORS_VISIBLE_TO_VISITORS=true))");

/**
 * qa-agent — Paket Z1-ek e2e (docs/prompts/2026-11-01-Z1-ek-blog-tasarim.md "Testler" + "Ekran goruntuleri").
 *
 * Yerel ortam: saas_e2e'de VARSAYILAN DIL TR'dir (canlida EN) -> TR adresleri oneksizdir (`/blog`), EN `/en/blog`.
 * Kanonik metin TR, EN/AR metinleri `translations` ile verilir. Liste/konu/hekim onbellegi ~60 sn -> poll (toPass + reload).
 *
 * Testler SIRALIDIR ve birbirine baglidir (1: bos durum -> 2: kurulum -> ...). Tum veri `qa-z1ek-` onekli, afterAll siler.
 * Hekim kullanicilari (User) projedeki diger fixture kullanicilari gibi kalici birakilir (silme ucu yok).
 */
const RUN = Date.now().toString(36);
const BASE = process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100";
const SHOT_DIR = path.resolve(process.cwd(), "..", "docs", "prompts", "2026-11-01-Z1-ek-ekran");
const DOCTOR_PASSWORD = "Mellow-Harbor-4471-Vq!";
const DOC_A = { slug: `${Z1EK_PREFIX}doctor-a-${RUN}`, email: `qa-e2e-z1ek-doc-a-${RUN}@example.com`, fullName: "Selin Örnekoğlu", title: "Prof. Dr.", avatar: "avatar-elif-aydemir.png" };
const DOC_B = { slug: `${Z1EK_PREFIX}doctor-b-${RUN}`, email: `qa-e2e-z1ek-doc-b-${RUN}@example.com`, fullName: "Mert Denemeci", title: "Doç. Dr.", avatar: "avatar-james-whitfield.png" };

test.use({ navigationTimeout: 120_000, actionTimeout: 20_000 });

type Lang = "tr" | "en" | "ar";
type L3 = Record<Lang, string>;
const LANGS: Lang[] = ["en", "tr", "ar"];
const SIZES = [
  { key: "masaustu", width: 1440, height: 900 },
  { key: "mobil", width: 390, height: 844 },
] as const;

/** Varsayilan dil TR: `/blog`; digerleri `/en/blog`. */
function p(lang: Lang, pathname: string): string {
  return lang === "tr" ? pathname : `/${lang}${pathname}`;
}

const SPEC_DEF: Record<"cardio" | "derm" | "neuro" | "empty", { slug: string; icon: string; name: L3 }> = {
  cardio: { slug: `${Z1EK_PREFIX}cardiology-${RUN}`, icon: "heart-pulse", name: { tr: "Kardiyoloji (QA Z1ek)", en: "Cardiology (QA Z1ek)", ar: "أمراض القلب (QA Z1ek)" } },
  derm: { slug: `${Z1EK_PREFIX}dermatology-${RUN}`, icon: "scan-face", name: { tr: "Dermatoloji (QA Z1ek)", en: "Dermatology (QA Z1ek)", ar: "الأمراض الجلدية (QA Z1ek)" } },
  neuro: { slug: `${Z1EK_PREFIX}neurology-${RUN}`, icon: "brain", name: { tr: "Nöroloji (QA Z1ek)", en: "Neurology (QA Z1ek)", ar: "طب الأعصاب (QA Z1ek)" } },
  empty: { slug: `${Z1EK_PREFIX}pediatrics-${RUN}`, icon: "baby", name: { tr: "Çocuk Sağlığı (QA Z1ek boş)", en: "Pediatrics (QA Z1ek empty)", ar: "طب الأطفال (QA Z1ek فارغ)" } },
};

interface PostDef {
  key: string;
  slug: string;
  title: L3;
  spec: "cardio" | "derm" | "neuro" | null;
  cover: "access" | "security" | null;
  featured?: boolean;
  reviewer: "A" | "B" | null;
  faq?: boolean;
}
const POSTS: PostDef[] = [
  { key: "p1", slug: `${Z1EK_PREFIX}p1-${RUN}`, spec: "cardio", cover: "access", featured: true, reviewer: "A", faq: true, title: { tr: "Kardiyoloji randevusuna hazırlanma rehberi", en: "How to prepare for a cardiology appointment", ar: "دليل الاستعداد لموعد طبيب القلب" } },
  { key: "p2", slug: `${Z1EK_PREFIX}p2-${RUN}`, spec: "cardio", cover: null, reviewer: "A", title: { tr: "Kontrol sonuçlarınızı anlamak", en: "Understanding your check-up results", ar: "فهم نتائج الفحص الدوري" } },
  { key: "p3", slug: `${Z1EK_PREFIX}p3-${RUN}`, spec: "cardio", cover: "security", reviewer: "A", title: { tr: "Hekiminize sorabileceğiniz sorular", en: "Questions you can ask your physician", ar: "أسئلة يمكنك طرحها على طبيبك" } },
  { key: "p4", slug: `${Z1EK_PREFIX}p4-${RUN}`, spec: "derm", cover: null, reviewer: "B", title: { tr: "Dermatoloji ziyaretine hazırlık", en: "Getting ready for a dermatology visit", ar: "التحضير لزيارة طبيب الجلدية" } },
  { key: "p5", slug: `${Z1EK_PREFIX}p5-${RUN}`, spec: "derm", cover: "access", reviewer: "B", title: { tr: "Ziyaret öncesi not defteri tutmak", en: "Keeping a notebook before your visit", ar: "الاحتفاظ بدفتر ملاحظات قبل الزيارة" } },
  { key: "p6", slug: `${Z1EK_PREFIX}p6-${RUN}`, spec: "neuro", cover: null, reviewer: "A", title: { tr: "Nöroloji görüşmesine neler getirilmeli", en: "What to bring to a neurology consultation", ar: "ما الذي تحضره إلى استشارة الأعصاب" } },
  { key: "p7", slug: `${Z1EK_PREFIX}p7-${RUN}`, spec: "neuro", cover: "security", reviewer: "A", title: { tr: "Tıbbi kayıtlarınızı düzenlemek", en: "Organising your medical records", ar: "تنظيم سجلاتك الطبية" } },
  { key: "p8", slug: `${Z1EK_PREFIX}p8-${RUN}`, spec: null, cover: null, reviewer: null, title: { tr: "Sağlık seyahati planlama kontrol listesi", en: "A checklist for planning health travel", ar: "قائمة تحقق لتخطيط السفر العلاجي" } },
];
const post = (key: string) => POSTS.find((x) => x.key === key)!;

const TXT: Record<Lang, { intro: string; para: string; h2a: string; h2b: string; h2c: string; h3: string; take: string[]; excerpt: string; faqQ: string; faqA: string }> = {
  en: {
    intro: "Introduction to this fixture guide.",
    para: "This is neutral fixture text written for automated tests only and does not contain medical advice. It gives the page some length so the layout can be reviewed.",
    h2a: "Why preparation helps",
    h2b: "What to bring",
    h2c: "After the visit",
    h3: "A simple checklist",
    take: ["Write your questions down beforehand", "Bring a list of your current medicines"],
    excerpt: "A short, neutral summary of this fixture guide for the listing page.",
    faqQ: "Is this fixture real advice?",
    faqA: "No, it is only a test fixture.",
  },
  tr: {
    intro: "Bu örnek rehbere giriş.",
    para: "Bu metin yalnızca otomatik testler için yazılmış nötr bir örnek metindir; tıbbi tavsiye içermez. Sayfa düzeninin incelenebilmesi için uzunluk kazandırır.",
    h2a: "Hazırlık neden yardımcı olur",
    h2b: "Neler getirilmeli",
    h2c: "Ziyaretten sonra",
    h3: "Basit bir kontrol listesi",
    take: ["Sorularınızı önceden yazın", "Kullandığınız ilaçların listesini getirin"],
    excerpt: "Liste sayfası için bu örnek rehberin kısa ve nötr özeti.",
    faqQ: "Bu örnek gerçek bir tavsiye midir?",
    faqA: "Hayır, yalnızca bir test örneğidir.",
  },
  ar: {
    intro: "مقدمة لهذا الدليل التجريبي.",
    para: "هذا نص تجريبي محايد كُتب لأغراض الاختبار الآلي فقط ولا يتضمن أي نصيحة طبية. يمنح الصفحة طولاً كافياً لمراجعة التصميم.",
    h2a: "لماذا يساعد الاستعداد",
    h2b: "ما الذي تحضره",
    h2c: "بعد الزيارة",
    h3: "قائمة تحقق بسيطة",
    take: ["اكتب أسئلتك مسبقاً", "أحضر قائمة بالأدوية التي تستخدمها"],
    excerpt: "ملخص قصير ومحايد لهذا الدليل التجريبي في صفحة القائمة.",
    faqQ: "هل هذه نصيحة حقيقية؟",
    faqA: "لا، إنه مجرد نموذج اختبار.",
  },
};

function articleHtml(lang: Lang): string {
  const t = TXT[lang];
  const paras = (n: number) => Array.from({ length: n }, () => `<p>${t.para}</p>`).join("");
  return `<p>${t.intro}</p><h2>${t.h2a}</h2>${paras(3)}<h3>${t.h3}</h3>${paras(2)}<h2>${t.h2b}</h2>${paras(3)}<h2>${t.h2c}</h2>${paras(3)}`;
}

const REFERENCES = [
  { title: "Example reference one", publisher: "Example Society", url: "https://example.com/reference-one", accessedAt: "2026-10-01" },
  { title: "Example reference two", publisher: "Example Journal", url: "https://example.com/reference-two", accessedAt: "2026-10-02" },
];

// ---------------------------------------------------------------------------------------------------------------------
// Durum
// ---------------------------------------------------------------------------------------------------------------------
let adminToken = "";
let initialTelehealthEnabled = true;
let medicalCat: Z1Category | undefined;
let travelCat: Z1Category | undefined;
const specs = {} as Record<keyof typeof SPEC_DEF, Z1ekSpecialty>;
let docA: Z1ekDoctor | undefined;
let docB: Z1ekDoctor | undefined;
let tokenA = "";
let tokenB = "";
const postIds: Record<string, string> = {};
const pageIds: string[] = [];
let covers: { access?: string; security?: string } = {};
let nameA = "";
let nameB = "";
let seeded = false;

// ---------------------------------------------------------------------------------------------------------------------
// Yardimcilar
// ---------------------------------------------------------------------------------------------------------------------
function trackConsole(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // /uploads goreli medya :3100'de 404 verir (bilinen, ilgisiz); anonim ziyaretcide /auth/refresh|me 401.
    if (/Failed to load resource/.test(m.text()) && /\/uploads\/|favicon|\/auth\/(refresh|me)/.test(m.location().url)) return;
    errors.push(`console.error: ${m.text()} @ ${m.location().url}`);
  });
  return { assertClean: () => expect(errors, `Konsol hatalari:\n${errors.join("\n")}`).toEqual([]) };
}

async function gotoUntil(page: Page, url: string, ready: () => Promise<void>, timeout = 120_000): Promise<void> {
  await expect(async () => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await ready();
  }).toPass({ timeout, intervals: [1_000, 3_000, 5_000] });
}

async function jsonLd(page: Page): Promise<Record<string, unknown>[]> {
  const raw = await page.locator('script[type="application/ld+json"]').allTextContents();
  return raw.map((r) => JSON.parse(r) as Record<string, unknown>);
}

async function forwardUploads(page: Page): Promise<void> {
  await page.route("**/uploads/**", async (route) => {
    const url = new URL(route.request().url());
    await route.continue({ url: `http://localhost:4001${url.pathname}${url.search}` }).catch(() => route.abort());
  });
}

async function settle(page: Page): Promise<void> {
  // Tembel gorselleri tetikle, hepsinin yuklenmesini bekle, basa don.
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += 700) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await page
    .waitForFunction(() => [...document.images].every((i) => i.complete), undefined, { timeout: 15_000 })
    .catch(() => undefined);
  await page.waitForTimeout(400);
}

async function shot(page: Page, name: string, opts: { fullPage?: boolean; dir?: string } = {}): Promise<void> {
  const dir = opts.dir ?? SHOT_DIR;
  mkdirSync(dir, { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal{display:none !important}" }); // Next dev gostergesi goruntuye girmesin
  await page.screenshot({ path: path.join(dir, name), fullPage: opts.fullPage ?? true, animations: "disabled" });
}

/** Test veritabaninda 180 uzmanlik var; ekran goruntusunde yalnizca fixture kartlari + 4 diger kart birakilir (yalniz gorunum). */
async function trimSpecialtyCards(page: Page): Promise<void> {
  const keep = (Object.values(SPEC_DEF) as { name: L3 }[]).flatMap((s) => Object.values(s.name));
  await page.evaluate((names) => {
    let others = 0;
    for (const card of document.querySelectorAll('[data-testid="blog-specialty-card"]')) {
      const li = card.closest("li") as HTMLElement | null;
      if (!li) continue;
      if (names.some((n) => (card.textContent ?? "").includes(n))) continue;
      others += 1;
      if (others > 4) li.style.display = "none";
    }
  }, keep);
}

async function noHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

function blogReady(page: Page, lang: Lang) {
  return async () => {
    await expect(page.getByTestId("blog-featured")).toContainText(post("p1").title[lang], { timeout: 3_000 });
  };
}

async function ensureShotPages(token: string): Promise<void> {
  for (const slug of [SHOT_PAGES.builder.slug, SHOT_PAGES.legal.slug]) {
    const id = await findAdminPageIdBySlug(token, slug);
    if (id) await deleteCmsPage(token, id);
  }
  const builder = await createCmsPage(token, {
    title: SHOT_PAGES.builder.title.tr,
    slug: SHOT_PAGES.builder.slug,
    blocks: shotBuilderBlocks("tr"),
    translations: { en: { title: SHOT_PAGES.builder.title.en, blocks: shotBuilderBlocks("en") } },
  });
  const legal = await createCmsPage(token, {
    title: SHOT_PAGES.legal.title.tr,
    slug: SHOT_PAGES.legal.slug,
    isLegalDocument: true,
    blocks: shotLegalBlocks("tr"),
    translations: { en: { title: SHOT_PAGES.legal.title.en, blocks: shotLegalBlocks("en") } },
  });
  pageIds.push(builder.id, legal.id);
}

// ---------------------------------------------------------------------------------------------------------------------
// Temizlik
// ---------------------------------------------------------------------------------------------------------------------
test.afterAll(async () => {
  test.setTimeout(300_000);
  if (!adminToken) return;
  const errors: string[] = [];
  const attempt = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      errors.push(`${label}: ${String(err)}`);
    }
  };
  for (const id of Object.values(postIds)) await attempt(`yazi ${id}`, () => deletePostPermanently(adminToken, id));
  for (const id of pageIds) await attempt(`sayfa ${id}`, () => deleteCmsPage(adminToken, id));
  if (docA) await attempt("hekim A", () => deleteAdminDoctorFixture(adminToken, docA!.id));
  if (docB) await attempt("hekim B", () => deleteAdminDoctorFixture(adminToken, docB!.id));
  for (const s of Object.values(specs)) await attempt(`uzmanlik ${s.slug}`, () => deleteSpecialty(adminToken, s.id));
  if (medicalCat) await attempt("kategori medical", () => deleteCategory(adminToken, medicalCat!.id));
  if (travelCat) await attempt("kategori travel", () => deleteCategory(adminToken, travelCat!.id));
  await attempt("telehealth modul", async () => {
    if (!initialTelehealthEnabled) await patchSiteModule(adminToken, "telehealth", false);
  });
  expect(errors, `Temizlik hatalari:\n${errors.join("\n")}`).toEqual([]);
});

test.describe.configure({ mode: "serial" });

// ---------------------------------------------------------------------------------------------------------------------
// 1) Bos durum — kurulumdan ONCE (ortamda hic yayinli yazi yoksa)
// ---------------------------------------------------------------------------------------------------------------------
test("blog bos durum: 0 yazida bos durum + 'Find my physician' + koordinator CTA, 'Articles: 0' yok (+ bos hekim izgarasi)", async ({ browser }) => {
  test.setTimeout(300_000);
  const totals = await Promise.all(LANGS.map(async (l) => (await publicPosts(l)).total));
  test.skip(
    totals.some((n) => n > 0),
    `Ortamda baska yayinli yazilar var (${totals.join("/")}); gercek 0-yazi durumu kurulamaz — bilesen duzeyindeki birim testleri kapsar.`
  );

  for (const size of SIZES) {
    const context = await browser.newContext({ baseURL: BASE, viewport: { width: size.width, height: size.height } });
    const page = await context.newPage();
    const con = trackConsole(page);
    await forwardUploads(page);
    for (const lang of LANGS) {
      await gotoUntil(page, p(lang, "/blog"), async () => {
        await expect(page.getByTestId("blog-empty")).toBeVisible({ timeout: 3_000 });
      });
      if (lang === "en" && size.key === "masaustu") {
        const empty = page.getByTestId("blog-empty");
        await expect(empty).toContainText("Our first guides are being reviewed by our physicians.");
        await expect(empty.getByRole("button", { name: "Find my physician" }).or(empty.getByRole("link", { name: "Find my physician" })).first()).toBeVisible();
        await expect(page.getByTestId("blog-coordinator-cta")).toContainText("Talk to a patient coordinator");
        await expect(page.getByTestId("blog-total")).toHaveCount(0);
        await expect(page.getByTestId("blog-grid")).toHaveCount(0);
        await expect(page.getByText(/Articles:\s*0/)).toHaveCount(0);
        await expect(page.getByRole("heading", { level: 1, name: "Health Guides" })).toBeVisible();
        await expect(page.getByTestId("blog-trust-line").or(page.getByTestId("blog-hero").locator('a[href$="/content-standards"]')).first()).toBeVisible();
      }
      await settle(page);
      await trimSpecialtyCards(page);
      await shot(page, `blog-bos-hal-${lang}-${size.key}.png`);
    }
    con.assertClean();
    await context.close();
  }

  // Onayli yazisi olan hekim yoksa izgara yerine notr cumle (yalnizca API de bos donuyorsa kesin).
  if ((await publicReviewers("en")).length === 0) {
    const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await gotoUntil(page, "/en/medical-reviewers", async () => {
      await expect(page.getByTestId("trust-reviewers-empty")).toBeVisible({ timeout: 3_000 });
    });
    await expect(page.getByTestId("trust-reviewers-empty")).toHaveText("Our physicians review each guide before publication.");
    await expect(page.getByTestId("trust-reviewer-grid")).toHaveCount(0);
    await context.close();
  } else {
    test.info().annotations.push({ type: "atlandi", description: "Ortamda onayli hekim var: bos hekim izgarasi kontrolu atlandi." });
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// 2) Kurulum
// ---------------------------------------------------------------------------------------------------------------------
test("kurulum: 4 uzmanlik, 2 hekim (fotografli), 8 yazi (6 yayinli + onayli, 2'si B hekiminde bekliyor)", async () => {
  test.setTimeout(900_000);
  adminToken = (await getCachedAdminSession()).accessToken;
  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  if (!initialTelehealthEnabled) await patchSiteModule(adminToken, "telehealth", true);

  for (const key of Object.keys(SPEC_DEF) as (keyof typeof SPEC_DEF)[]) {
    const d = SPEC_DEF[key];
    specs[key] = await createSpecialtyI18n(adminToken, { slug: d.slug, tr: d.name.tr, en: d.name.en, ar: d.name.ar, icon: d.icon });
  }
  medicalCat = await createCategory(adminToken, {
    // Blog kategorisinin ceviri alani yok (yalniz `name`); tum dillerde okunabilir kisa bir ad kullanilir.
    name: "Patient guide",
    slug: `${Z1EK_PREFIX}medical-${RUN}`,
    isMedical: true,
  });
  travelCat = await createCategory(adminToken, {
    name: "Health travel",
    slug: `${Z1EK_PREFIX}travel-${RUN}`,
    isMedical: false,
  });

  const avatarA = await findMediaIdByFilename(adminToken, DOC_A.avatar);
  const avatarB = await findMediaIdByFilename(adminToken, DOC_B.avatar);
  const cov = {
    access: await findMediaIdByFilename(adminToken, "support-access.png"),
    security: await findMediaIdByFilename(adminToken, "support-security.png"),
  };
  covers = { access: cov.access?.url, security: cov.security?.url };
  if (!avatarA || !avatarB || !cov.access || !cov.security) test.info().annotations.push({ type: "uyari", description: "Mevcut avatar/kapak medyasi bulunamadi; ilgili alanlar bos birakildi." });

  docA = await createDoctorWithAvatar(adminToken, { title: DOC_A.title, fullName: DOC_A.fullName, slug: DOC_A.slug, specialtyId: specs.cardio.id, avatarMediaId: avatarA?.id ?? null });
  docB = await createDoctorWithAvatar(adminToken, { title: DOC_B.title, fullName: DOC_B.fullName, slug: DOC_B.slug, specialtyId: specs.derm.id, avatarMediaId: avatarB?.id ?? null });

  tokenA = await fixtureUserTokenWithRetry(DOC_A.email, DOCTOR_PASSWORD, "Z1ek Hekim A");
  const userA = await adminGetUserByEmail(adminToken, DOC_A.email);
  if (!userA) throw new Error("Hekim A kullanicisi bulunamadi.");
  await linkDoctorUserRaw(adminToken, docA.id, userA.id);
  await setupAndEnableTwoFactorForSelf(tokenA, DOCTOR_PASSWORD);

  tokenB = await fixtureUserTokenWithRetry(DOC_B.email, DOCTOR_PASSWORD, "Z1ek Hekim B");
  const userB = await adminGetUserByEmail(adminToken, DOC_B.email);
  if (!userB) throw new Error("Hekim B kullanicisi bulunamadi.");
  await linkDoctorUserRaw(adminToken, docB.id, userB.id);
  await setupAndEnableTwoFactorForSelf(tokenB, DOCTOR_PASSWORD);

  for (const def of POSTS) {
    const translations: Record<string, Record<string, unknown>> = {};
    for (const lang of ["en", "ar"] as const) {
      const t = TXT[lang];
      translations[lang] = {
        title: def.title[lang],
        excerpt: t.excerpt,
        contentHtml: articleHtml(lang),
        keyTakeaways: t.take,
        ...(def.faq ? { faq: [{ question: t.faqQ, answer: t.faqA }] } : {}),
      };
    }
    const cover = def.cover ? covers[def.cover] : undefined;
    const reviewerDoc = def.reviewer === "A" ? docA : def.reviewer === "B" ? docB : null;
    const created = await createPost(adminToken, {
      title: def.title.tr,
      slug: def.slug,
      excerpt: TXT.tr.excerpt,
      contentHtml: articleHtml("tr"),
      categoryId: (def.reviewer ? medicalCat : travelCat)!.id,
      specialtyId: def.spec ? specs[def.spec].id : null,
      reviewerDoctorId: reviewerDoc?.id ?? null,
      isFeatured: def.featured ?? false,
      keyTakeaways: TXT.tr.take,
      references: REFERENCES,
      translations,
      ...(def.reviewer ? {} : { medicalReviewStatus: "not_required" as const }),
      ...(cover ? ({ coverImageUrl: cover } as Record<string, unknown>) : {}),
    } as Parameters<typeof createPost>[1]);
    postIds[def.key] = created.id;
    if (def.reviewer === "A") {
      await doctorApprove(tokenA, created.id);
      await patchPost(adminToken, created.id, { status: "PUBLISHED" });
    } else if (!def.reviewer) {
      await patchPost(adminToken, created.id, { status: "PUBLISHED" });
    }
    // reviewer B: onay bekleyen taslak (hekim B henuz hicbir yaziyi onaylamadi).
  }
  seeded = true;

  const revs = await publicReviewers("en");
  nameA = revs.find((r) => r.slug === DOC_A.slug)?.name ?? "";
  expect(nameA, "Hekim A, onayladigi yazilar nedeniyle API'de listelenmeli").not.toBe("");
  expect(revs.find((r) => r.slug === DOC_B.slug), "Hekim B hicbir yazi onaylamadi -> listede olmamali").toBeUndefined();
});

// ---------------------------------------------------------------------------------------------------------------------
// 3) Guven sayfalari (en, tr, ar)
// ---------------------------------------------------------------------------------------------------------------------
const TRUST_TITLES: Record<Lang, { cs: string; mr: string; dir: "ltr" | "rtl" }> = {
  en: { cs: "Content standards", mr: "Authors & medical reviewers", dir: "ltr" },
  tr: { cs: "İçerik standartları", mr: "Yazarlar ve tıbbi gözden geçirenler", dir: "ltr" },
  ar: { cs: "معايير المحتوى", mr: "الكتّاب والمراجعون الطبيون", dir: "rtl" },
};

for (const lang of LANGS) {
  for (const key of ["cs", "mr"] as const) {
    const slug = key === "cs" ? "content-standards" : "medical-reviewers";
    test(`guven sayfasi /${lang}/${slug}: 200, tek H1 (baslik tekrari yok), paylasim yok, WebPage JSON-LD, hreflang, ${TRUST_TITLES[lang].dir}`, async ({ page }) => {
      test.skip(!seeded, "Kurulum yapilmadi.");
      const con = trackConsole(page);
      const title = TRUST_TITLES[lang][key];
      const res = await page.goto(p(lang, `/${slug}`));
      expect(res?.status()).toBe(200);
      const root = page.getByTestId(key === "cs" ? "trust-content-standards" : "trust-medical-reviewers");
      await expect(root).toBeVisible();
      await expect(root).toHaveAttribute("dir", TRUST_TITLES[lang].dir);

      // Tek H1 ve baslik tekrari yok.
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(page.getByRole("heading", { name: title, exact: true })).toHaveCount(1);

      // Paylasim ikonu yok.
      await expect(page.locator('[data-testid^="blog-share"]')).toHaveCount(0);
      await expect(page.locator('a[href*="wa.me"], a[href*="facebook.com/sharer"], a[href*="twitter.com/intent"], a[href*="x.com/intent"], a[href*="linkedin.com/sharing"]')).toHaveCount(0);

      // JSON-LD.
      const web = (await jsonLd(page)).find((b) => b["@type"] === "WebPage");
      expect(web, "WebPage JSON-LD yok").toBeTruthy();
      expect(web!.name).toBe(title);
      expect(web!.inLanguage).toBe(lang);
      expect(String(web!.url)).toMatch(new RegExp(`${lang === "tr" ? "" : `/${lang}`}/${slug}$`));

      // hreflang + canonical.
      const hreflangs = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((els) => els.map((e) => e.getAttribute("hreflang")));
      expect(hreflangs).toEqual(expect.arrayContaining(["en", "tr", "ar", "x-default"]));
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${lang === "tr" ? "" : `/${lang}`}/${slug}$`));

      // Sayfa yapisi.
      await expect(page.getByTestId("trust-updated")).toBeVisible();
      if (key === "cs") {
        await expect(page.getByTestId("trust-card")).toHaveCount(5);
        await expect(page.getByTestId("trust-step")).toHaveCount(5);
        await expect(page.getByTestId("trust-alert")).toBeVisible();
        const ctas = page.getByTestId("trust-ctas").getByRole("link").or(page.getByTestId("trust-ctas").getByRole("button"));
        // "Read our health guides" (baglanti) + "Find my physician" (sihirbaz dugmesi).
        expect(await ctas.count()).toBe(2);
        await expect(page.getByTestId("trust-ctas").getByRole("link")).toHaveAttribute("href", new RegExp(`${lang === "tr" ? "" : `/${lang}`}/blog$`));
        // 44 px dokunma alani.
        for (const link of await ctas.all()) expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);
      } else {
        await expect(page.getByTestId("trust-editorial")).toBeVisible();
        await expect(page.getByTestId("trust-covers").locator("li")).toHaveCount(3);
      }

      // Mobilde yatay tasma yok.
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await noHorizontalOverflow(page)).toBe(true);
      con.assertClean();
    });
  }
}

test("hekim izgarasi: yalniz onayli yazisi olan hekim gorunur; B bir yazi onaylayinca listeye girer", async ({ page }) => {
  test.setTimeout(480_000);
  test.skip(!seeded, "Kurulum yapilmadi.");
  const card = (slug: string) => page.getByTestId("trust-reviewer-card").filter({ has: page.locator(`a[href$="/physicians/${slug}"]`) });

  // Oncesi: A var (en az 1 onayi var), B yok (yalniz onay bekleyen taslagi var).
  await gotoUntil(page, "/en/medical-reviewers", async () => {
    await expect(card(DOC_A.slug)).toHaveCount(1, { timeout: 3_000 });
  });
  await expect(card(DOC_B.slug)).toHaveCount(0);
  const cardA = card(DOC_A.slug);
  await expect(cardA).toContainText(nameA);
  await expect(cardA.getByRole("link")).toHaveAttribute("href", new RegExp(`/physicians/${DOC_A.slug}$`));
  expect(await cardA.locator("img").count(), "hekim fotografi").toBeGreaterThan(0);
  await expect(cardA).toContainText(/\d+/); // onayladigi yazi sayisi

  // B'nin bir yazisini onayla (hekim kuyrugu ucu) -> B listeye girer (onbellek icin poll).
  await doctorApprove(tokenB, postIds.p4!);
  await gotoUntil(page, "/en/medical-reviewers", async () => {
    await expect(card(DOC_B.slug)).toHaveCount(1, { timeout: 3_000 });
  });
  await expect(card(DOC_A.slug)).toHaveCount(1);
  const revs = await publicReviewers("en");
  nameB = revs.find((r) => r.slug === DOC_B.slug)?.name ?? "";
  expect(nameB).not.toBe("");
  await expect(card(DOC_B.slug)).toContainText(nameB);

  // Gerisi: B'nin iki yazisi da yayinda olsun (blog/yazi testleri ve ekran goruntuleri icin).
  await patchPost(adminToken, postIds.p4!, { status: "PUBLISHED" });
  await doctorApprove(tokenB, postIds.p5!);
  await patchPost(adminToken, postIds.p5!, { status: "PUBLISHED" });
});

// ---------------------------------------------------------------------------------------------------------------------
// 4) Blog ana sayfasi — yazi varken
// ---------------------------------------------------------------------------------------------------------------------
test("blog dolu: ust bant + guven satiri, one cikan yazi, kart izgarasi (kapakli/sablon), kartta hekim, uzmanlik kartlari", async ({ page }) => {
  test.setTimeout(480_000);
  test.skip(!seeded, "Kurulum yapilmadi.");
  const con = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoUntil(page, "/en/blog", async () => {
    await expect(page.getByTestId("blog-featured")).toContainText(post("p1").title.en, { timeout: 3_000 });
    await expect(page.getByTestId("blog-grid")).toContainText(post("p5").title.en, { timeout: 3_000 });
  });

  // Ust bant.
  const hero = page.getByTestId("blog-hero");
  await expect(hero.getByRole("heading", { level: 1, name: "Health Guides" })).toBeVisible();
  await expect(hero.getByText("Reviewed by physicians")).toBeVisible();
  await expect(hero.locator('a[href$="/content-standards"]').first()).toBeVisible();
  await expect(hero.getByRole("searchbox").or(hero.getByLabel("Search articles")).first()).toBeVisible();
  await expect(page.getByTestId("blog-empty")).toHaveCount(0);

  // One cikan + izgara (featured tekrarlanmaz).
  const featured = page.getByTestId("blog-featured");
  await expect(featured.getByTestId("blog-featured-reviewer")).toHaveText(`Reviewed by ${nameA}`);
  const grid = page.getByTestId("blog-grid");
  await expect(grid).not.toContainText(post("p1").title.en);
  await expect(grid).toContainText(post("p3").title.en);
  // 7 kart: ilk 6'si `blog-grid` icinde, kalani "Find my physician" CTA'sindan sonraki ikinci izgarada.
  await expect(page.getByTestId("blog-card")).toHaveCount(7);
  // Karttaki hekim.
  const cardP2 = page.getByTestId("blog-card").filter({ hasText: post("p2").title.en });
  await expect(cardP2.getByTestId("blog-card-reviewer")).toContainText(nameA);
  const cardP5 = page.getByTestId("blog-card").filter({ hasText: post("p5").title.en });
  await expect(cardP5.getByTestId("blog-card-reviewer")).toContainText(nameB);
  // Sablon kapak (kapaksiz yazi) ve gercek kapak (kapakli yazi).
  expect(await page.getByTestId("blog-cover-template").count()).toBeGreaterThan(0);
  expect(await page.getByTestId("blog-card").filter({ hasText: post("p3").title.en }).locator("img").count()).toBeGreaterThan(0);

  // Toplam sayi API ile birebir; "Articles: 0" yok.
  const apiTotal = (await publicPosts("en", { pageSize: "1" })).total;
  expect(apiTotal).toBe(8);
  await expect(page.getByTestId("blog-total")).toHaveText(`Articles: ${apiTotal}`);
  await expect(page.getByText(/Articles:\s*0/)).toHaveCount(0);
  await expect(page.getByTestId("blog-find-physician-cta")).toBeVisible();

  // "Browse by specialty": yazisi olan kart filtreye gider ve API sayisini gosterir; yazisi olmayanda sayi yok.
  // Kullanici karari (2026-11-01, 88989d9): yalnizca en az bir AKTIF hekimi olan uzmanliklar gosterilir.
  // Fixture'da aktif hekim yalnizca cardio (docA) ve derm (docB) uzmanliklarinda; neuro'nun yazisi olsa da hekimi yok.
  const cards = page.getByTestId("blog-specialty-card");
  for (const key of ["cardio", "derm"] as const) {
    const apiCount = (await publicPosts("en", { topic: SPEC_DEF[key].slug, pageSize: "1" })).total;
    expect(apiCount).toBeGreaterThan(0);
    const c = cards.filter({ hasText: SPEC_DEF[key].name.en });
    await expect(c).toHaveCount(1);
    await expect(c.getByTestId("blog-specialty-meta")).toHaveText(`Guides: ${apiCount}`);
    await expect(c).toHaveAttribute("href", new RegExp(`/en/blog\\?topic=${SPEC_DEF[key].slug}$`));
    await expect(c).toHaveAttribute("data-has-posts", "true");
  }
  // Aktif hekimi olmayan uzmanliklar (yazisi olsa da olmasa da) kart olarak cizilmez.
  expect((await publicPosts("en", { topic: SPEC_DEF.neuro.slug, pageSize: "1" })).total).toBeGreaterThan(0);
  await expect(cards.filter({ hasText: SPEC_DEF.neuro.name.en })).toHaveCount(0);
  await expect(cards.filter({ hasText: SPEC_DEF.empty.name.en })).toHaveCount(0);
  // Toplamda, yazisi olmayan hicbir kartta rakam yok.
  for (const meta of await page.locator('[data-testid="blog-specialty-card"][data-has-posts="false"] [data-testid="blog-specialty-meta"]').allTextContents()) {
    expect(meta).not.toMatch(/\d/);
  }
  expect(await noHorizontalOverflow(page)).toBe(true);
  con.assertClean();

  // RTL + TR kisa kontrol.
  await gotoUntil(page, "/ar/blog", async () => {
    await expect(page.getByTestId("blog-featured")).toContainText(post("p1").title.ar, { timeout: 3_000 });
  });
  await expect(page.getByTestId("blog-index")).toHaveAttribute("dir", "rtl");
  await gotoUntil(page, "/blog", async () => {
    await expect(page.getByTestId("blog-featured")).toContainText(post("p1").title.tr, { timeout: 3_000 });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 5) Yazi sayfasi
// ---------------------------------------------------------------------------------------------------------------------
test("yazi sayfasi: 'Medically reviewed by' satiri (foto/ad/tarih/profil), okuma ilerleme cubugu, yazar kutusu, Z1 bolumleri", async ({ page }) => {
  test.setTimeout(300_000);
  test.skip(!seeded, "Kurulum yapilmadi.");
  const con = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const def = post("p1");
  await gotoUntil(page, `/en/blog/${def.slug}`, async () => {
    await expect(page.getByRole("heading", { level: 1, name: def.title.en })).toBeVisible({ timeout: 3_000 });
  });

  const row = page.getByTestId("blog-byline-reviewer");
  await expect(row).toContainText("Medically reviewed by");
  await expect(row).toContainText(nameA);
  expect(await row.locator("img").count(), "hekim fotografi").toBeGreaterThan(0);
  const profile = row.getByRole("link", { name: new RegExp(nameA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
  await expect(profile).toHaveAttribute("href", new RegExp(`/physicians/${DOC_A.slug}$`));
  await expect(page.getByTestId("blog-last-reviewed")).toContainText(/Last reviewed: .+/);
  await expect(page.getByTestId("blog-byline")).toContainText("WM Health Editorial Team");

  // Yazar kutusu + Content standards baglantisi.
  const author = page.getByTestId("blog-author-box");
  await author.scrollIntoViewIfNeeded();
  await expect(author).toContainText("WM Health Editorial Team");
  await expect(author.locator('a[href$="/content-standards"]')).toBeVisible();
  await expect(author.locator('a[href$="/medical-reviewers"]')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));

  // Okuma ilerleme cubugu: baslangicta 0, kaydirinca artar, sonda ~100; yalnizca yazi sayfasinda.
  const bar = page.getByTestId("blog-reading-progress");
  await expect(bar).toHaveAttribute("role", "progressbar");
  await expect.poll(async () => Number(await bar.getAttribute("aria-valuenow"))).toBe(0);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.5));
  await expect.poll(async () => Number(await bar.getAttribute("aria-valuenow")), { timeout: 10_000 }).toBeGreaterThan(5);
  const mid = Number(await bar.getAttribute("aria-valuenow"));
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(async () => Number(await bar.getAttribute("aria-valuenow")), { timeout: 10_000 }).toBeGreaterThan(mid);

  // Z1 bolumleri duruyor.
  await expect(page.getByTestId("blog-key-takeaways")).toContainText(TXT.en.take[0]!);
  await expect(page.getByTestId("blog-toc")).toBeVisible();
  await expect(page.getByTestId("blog-faq")).toContainText(TXT.en.faqQ);
  await expect(page.getByTestId("blog-references")).toBeVisible();
  await expect(page.getByTestId("blog-disclaimer")).toBeVisible();
  await expect(page.getByTestId("blog-consult-card").first()).toBeVisible();
  await expect(page.getByTestId("blog-related")).toBeVisible();
  await expect(page.getByTestId("blog-share")).toBeVisible();
  const ld = (await jsonLd(page)).find((b) => JSON.stringify(b["@type"]).includes("MedicalWebPage"));
  expect(ld, "MedicalWebPage JSON-LD").toBeTruthy();
  expect(ld!.reviewedBy).toMatchObject({ "@type": "Physician", name: nameA });

  // Ilerleme cubugu liste sayfasinda yok.
  await page.goto("/en/blog");
  await expect(page.getByTestId("blog-reading-progress")).toHaveCount(0);
  con.assertClean();

  // Mobil: tek kolon, tasma yok.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/en/blog/${def.slug}`);
  await expect(page.getByTestId("blog-byline-reviewer")).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
});

// ---------------------------------------------------------------------------------------------------------------------
// 6) CMS sayfa gorunumu
// ---------------------------------------------------------------------------------------------------------------------
test("CMS: icerik H1'i sayfa basligiyla ayniysa gizlenir; yasal sayfa metni degismez", async ({ page }) => {
  test.setTimeout(300_000);
  test.skip(!seeded, "Kurulum yapilmadi.");
  const con = trackConsole(page);

  const titles = {
    block: { tr: `Z1ek Blok Baslik ${RUN}`, en: `Z1ek Block Title ${RUN}` },
    html: { tr: `Z1ek Metin Baslik ${RUN}`, en: `Z1ek Html Title ${RUN}` },
    legal: { tr: `Z1ek Yasal Metin ${RUN}`, en: `Z1ek Legal Text ${RUN}` },
  };
  const slugs = { block: `${Z1EK_PREFIX}cms-block-${RUN}`, html: `${Z1EK_PREFIX}cms-html-${RUN}`, legal: `${Z1EK_PREFIX}cms-legal-${RUN}` };
  const marker = (k: string, l: "tr" | "en") => `Z1EK-${k}-${l}-${RUN}`;
  const h = (id: string, text: string, level: number) => ({ id, type: "heading", data: { text, level, align: "left", underline: false } });
  const tx = (id: string, html: string) => ({ id, type: "text", data: { html } });

  const mk = async (k: "block" | "html") => {
    const blocksFor = (l: "tr" | "en") =>
      k === "block"
        ? [h("b1", titles.block[l], 1), tx("b2", `<p>${marker("block", l)} giris</p>`), h("b3", `Farkli baslik ${l}`, 2), tx("b4", `<p>${marker("block2", l)}</p>`)]
        : [tx("b1", `<h1>${titles.html[l]}</h1><p>${marker("html", l)} giris</p><h2>Farkli baslik ${l}</h2><p>${marker("html2", l)}</p>`)];
    const created = await createCmsPage(adminToken, { title: titles[k].tr, slug: slugs[k], blocks: blocksFor("tr"), translations: { en: { title: titles[k].en, blocks: blocksFor("en") } } });
    pageIds.push(created.id);
  };
  await mk("block");
  await mk("html");

  // Hukuki belge: icerik H1'i sayfa basligiyla AYNI; metne dokunulmamali (H1 korunur).
  const legalHtml = (l: "tr" | "en") => `<h1>${titles.legal[l]}</h1><p>${marker("legal", l)} ilk paragraf.</p><h2>1. Kapsam</h2><p>${marker("legal2", l)} ikinci paragraf.</p>`;
  const legal = await createCmsPage(adminToken, {
    title: titles.legal.tr,
    slug: slugs.legal,
    isLegalDocument: true,
    blocks: [tx("l1", legalHtml("tr"))],
    translations: { en: { title: titles.legal.en, blocks: [tx("l1", legalHtml("en"))] } },
  });
  pageIds.push(legal.id);

  for (const l of ["tr", "en"] as const) {
    for (const k of ["block", "html"] as const) {
      await gotoUntil(page, p(l, `/${slugs[k]}`), async () => {
        await expect(page.getByText(marker(k, l))).toBeVisible({ timeout: 3_000 });
      });
      // Baslik tekrari yok: tek H1 ve sayfa basligi baska bir basliga kopyalanmamis.
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(titles[k][l]);
      await expect(page.getByRole("heading", { name: titles[k][l], exact: true })).toHaveCount(1);
      // Farkli basliklar ve metin korunur.
      await expect(page.getByRole("heading", { level: 2, name: `Farkli baslik ${l}` })).toBeVisible();
      await expect(page.getByText(marker(`${k}2`, l))).toBeVisible();
    }

    await gotoUntil(page, p(l, `/${slugs.legal}`), async () => {
      await expect(page.getByText(marker("legal", l))).toBeVisible({ timeout: 3_000 });
    });
    // Hukuki belge: baslik bandi H1'i + icerikteki H1 (iki H1) — metin degismez.
    await expect(page.getByRole("heading", { level: 1, name: titles.legal[l], exact: true })).toHaveCount(2);
    await expect(page.locator("p", { hasText: marker("legal", l) })).toHaveText(`${marker("legal", l)} ilk paragraf.`);
    await expect(page.locator("p", { hasText: marker("legal2", l) })).toHaveText(`${marker("legal2", l)} ikinci paragraf.`);
    await expect(page.getByRole("heading", { level: 2, name: "1. Kapsam" })).toBeVisible();
  }
  con.assertClean();
});

// ---------------------------------------------------------------------------------------------------------------------
// 7) Ekran goruntuleri (SONRA) — blog dolu, yazi, guven sayfalari, once/sonra eslesmeleri
// ---------------------------------------------------------------------------------------------------------------------
test("ekran goruntuleri: blog dolu, yazi sayfasi, iki guven sayfasi (EN/TR/AR, 1440 + 390) ve once/sonra 'SONRA' goruntuleri", async ({ browser }) => {
  test.setTimeout(900_000);
  test.skip(!seeded, "Kurulum yapilmadi.");
  await ensureShotPages(adminToken);
  const sizeLabel = (s: (typeof SIZES)[number]) => s.key;

  for (const size of SIZES) {
    const context = await browser.newContext({ baseURL: BASE, viewport: { width: size.width, height: size.height } });
    const page = await context.newPage();
    const con = trackConsole(page);
    await forwardUploads(page);

    for (const lang of LANGS) {
      await gotoUntil(page, p(lang, "/blog"), async () => {
        await blogReady(page, lang)();
        await expect(page.getByTestId("blog-grid")).toContainText(post("p5").title[lang], { timeout: 3_000 });
      });
      await settle(page);
      await trimSpecialtyCards(page);
      await shot(page, `blog-dolu-hal-${lang}-${sizeLabel(size)}.png`);

      await gotoUntil(page, p(lang, `/blog/${post("p1").slug}`), async () => {
        await expect(page.getByRole("heading", { level: 1, name: post("p1").title[lang] })).toBeVisible({ timeout: 3_000 });
      });
      await settle(page);
      await shot(page, `yazi-sayfasi-${lang}-${sizeLabel(size)}.png`);
      if (lang === "en") {
        // Okuma ilerleme cubugu gorunur halde (sayfanin ortasinda, goruntu alani).
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.45));
        await page.waitForTimeout(500);
        await shot(page, `yazi-sayfasi-okuma-ilerleme-cubugu-${lang}-${sizeLabel(size)}.png`, { fullPage: false });
      }

      await gotoUntil(page, p(lang, "/content-standards"), async () => {
        await expect(page.getByTestId("trust-content-standards")).toBeVisible({ timeout: 3_000 });
      });
      await settle(page);
      await shot(page, `guven-sayfasi-icerik-standartlari-${lang}-${sizeLabel(size)}.png`);

      await gotoUntil(page, p(lang, "/medical-reviewers"), async () => {
        await expect(page.getByTestId("trust-reviewer-card")).toHaveCount(2, { timeout: 3_000 });
      });
      await settle(page);
      await shot(page, `guven-sayfasi-yazarlar-ve-hekimler-${lang}-${sizeLabel(size)}.png`);
    }

    // Once/sonra: "SONRA" (EN). Eslesen "ONCE" goruntuleri blog-z1ek-once.spec.ts ile master uzerinde alinir.
    const pairs: [string, string][] = [
      ["hakkimizda", "/en/about"],
      ["yasal-sayfa", `/en/${SHOT_PAGES.legal.slug}`],
      ["genel-cms-sayfasi", `/en/${SHOT_PAGES.builder.slug}`],
      ["guven-sayfasi-icerik-standartlari", "/en/content-standards"],
      ["guven-sayfasi-yazarlar-ve-hekimler", "/en/medical-reviewers"],
    ];
    for (const [name, url] of pairs) {
      await gotoUntil(page, url, async () => {
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 3_000 });
      });
      await settle(page);
      await shot(page, `once-sonra-${name}-en-${sizeLabel(size)}-SONRA.png`);
    }
    con.assertClean();
    await context.close();
  }
});
