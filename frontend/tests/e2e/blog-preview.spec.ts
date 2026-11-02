import path from "node:path";
import { mkdirSync } from "node:fs";
import { test, expect, type Page, type Browser, type BrowserContext } from "@playwright/test";
import { getCachedAdminSession, getSiteModules, patchSiteModule, setupAndEnableTwoFactorForSelf, nextTotpCode, API_BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD } from "./support/api";
import { adminGetUserByEmail } from "./support/admin-users-fixtures";
import { linkDoctorUserRaw, deleteAdminDoctorFixture } from "./support/telehealth-fixtures";
import {
  createSpecialty,
  deleteSpecialty,
  createCategory,
  deleteCategory,
  createReviewerDoctor,
  createPost,
  deletePostPermanently,
  type Z1Specialty,
  type Z1Category,
  type Z1Doctor,
  type Z1Post,
} from "./support/blog-z1-fixtures";
import { fixtureUserTokenWithRetry } from "./support/blog-z1ek-fixtures";
import {
  PV_PREFIX,
  postDbState,
  dbRows,
  expirePreviewTokenInDb,
  createShareLink,
  getShareLinkStatus,
  adminPreviewSession,
  doctorPreviewSession,
  publicPreview,
} from "./support/blog-preview-fixtures";

/**
 * qa-agent — Blog taslak onizleme e2e (kontrat: Z-ONIZLEME-KONTRAT.md).
 *
 * Yerel ortam: saas_e2e varsayilan dili TR; EN icerik `translations.en`, AR icerik `translations.ar`. Onizleme sayfasi her
 * zaman `?t=<belirtec>` ile acilir. Admin editorunun urettigi paylasim adresi `NEXT_PUBLIC_SITE_URL` kokludur (dev sunucuda
 * test tabanindan farkli olabilir); test yalnizca yol+sorguyu alip test tabanina oturtur.
 *
 * Veri: describe-seviyesi `beforeAll` tibbi kategori, tibbi olmayan kategori, uzmanlik, atanan hekim (+2FA kullanici),
 * atanmamis ikinci hekim (+2FA kullanici), bir DRAFT/pending yazi, ikinci bir DRAFT yazi (belirtec karistirma testi) ve bir
 * PUBLISHED yazi kurar; `afterAll` hepsini siler. Hekim kullanicilari (User) diger fixture kullanicilari gibi kalici birakilir.
 * Testler birbirine bagimlidir (seri).
 */
const RUN = Date.now().toString(36);
const DOCTOR_A_EMAIL = `qa-e2e-pv-doctor-a-${RUN}@example.com`;
const DOCTOR_B_EMAIL = `qa-e2e-pv-doctor-b-${RUN}@example.com`;
const DOCTOR_PASSWORD = "Mellow-Harbor-4471-Vq!";
const SHOT_DIR = path.resolve(process.cwd(), "..", "docs", "prompts", "2026-11-02-blog-onizleme-ekran");
const BASE = process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100";

const TITLE = { tr: "QA PV Taslak Rehberi", en: "QA PV Draft Guide", ar: "دليل المعاينة QA PV" };
const H2_EN = ["Why previews matter", "Reviewing before publishing"];

test.use({ navigationTimeout: 120_000, actionTimeout: 20_000, baseURL: BASE });
// Seri degil: dogrulanan hata (doktor yonlendirmesi) sonraki testleri atlatmasin; testler zaten tek worker ile sirali kosar.

let adminToken: string;
let initialTelehealthEnabled = true;
let doctorAToken: string;
let doctorBToken: string;
let doctorATotp: string;
let specialty: Z1Specialty;
let medicalCat: Z1Category;
let plainCat: Z1Category;
let doctorA: Z1Doctor;
let doctorB: Z1Doctor;
let draft: Z1Post;
let other: Z1Post;
let published: Z1Post;
let defaultLocale = "en";
let reviewerDisplay = "";
const createdPostIds: string[] = [];
const initialViews: { value: number } = { value: -1 };
const ctx: { admin?: { page: Page; context: BrowserContext }; shareUrl?: string; shareToken?: string; doctorPopupFinalUrl?: string } = {};

// ---------------------------------------------------------------------------------------------------------------------
// Yardimcilar
// ---------------------------------------------------------------------------------------------------------------------

function paragraphs(n: number, topic: string): string {
  return Array.from({ length: n }, (_, i) => `<p>${topic} paragraph ${i + 1}. Neutral fixture text for automated tests only; it is not medical advice.</p>`).join("");
}

async function fetchDefaultLocale(): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/locales`);
  const body = (await res.json()) as { data: { code: string; isDefault: boolean }[] };
  return body.data.find((l) => l.isDefault)?.code ?? "en";
}

/** Paylasim adresinden yalnizca yol+sorguyu alip test tabanina oturtur. */
function toBaseUrl(raw: string): string {
  const u = new URL(raw);
  return `${BASE}${u.pathname}${u.search}`;
}

function tokenOf(raw: string): string {
  return new URL(raw).searchParams.get("t") ?? "";
}

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: false, animations: "disabled" });
}

/** Ayni sayfanin masaustu (1440) ve mobil (390) goruntusunu alir. */
async function shotBoth(page: Page, baseName: string, prepare?: () => Promise<void>): Promise<void> {
  for (const [label, vp] of [
    ["masaustu", { width: 1440, height: 900 }],
    ["mobil", { width: 390, height: 844 }],
  ] as const) {
    await page.setViewportSize(vp);
    if (prepare) await prepare();
    await page.waitForTimeout(400);
    await shot(page, `${baseName}-${label}.png`);
  }
}

/** Yerel `/uploads` adreslerini backend'e yonlendirir. */
async function forwardUploads(page: Page): Promise<void> {
  await page.route("**/uploads/**", async (route) => {
    const url = new URL(route.request().url());
    await route.continue({ url: `http://localhost:4001${url.pathname}${url.search}` }).catch(() => route.abort());
  });
}

async function loginAs(browser: Browser, email: string, password: string, totpSecret?: string): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, locale: "tr-TR" });
  const page = await context.newPage();
  await forwardUploads(page);
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
  return { page, context };
}

async function adminUi(browser: Browser): Promise<{ page: Page; context: BrowserContext }> {
  if (!ctx.admin) ctx.admin = await loginAs(browser, ADMIN_EMAIL, ADMIN_PASSWORD);
  return ctx.admin;
}

/** Oturumsuz, yepyeni bir tarayici baglami. */
async function anonContext(browser: Browser, viewport = { width: 1440, height: 900 }): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: BASE, viewport, locale: "en-US" });
  await forwardUploads(await context.newPage());
  return context;
}

async function openAdminEditor(page: Page, postId: string): Promise<void> {
  await page.goto(`/admin/blog/${postId}`);
  await expect(page.getByTestId("blog-preview-controls")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("blog-preview-link-status").or(page.getByTestId("blog-preview-link-none"))).toBeVisible({ timeout: 20_000 });
}

/** Kimlik dogrulama uclari sabit kotalidir (429); kota penceresi dolana kadar bekleyip yeniden dener. */
async function with429Retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 3 || !/429|RATE_LIMITED/.test(String(err))) throw err;
      await new Promise((r) => setTimeout(r, 65_000));
    }
  }
}

function assertNotPreviewable(res: { status: number }) {
  expect(res.status).toBe(404);
}

// ---------------------------------------------------------------------------------------------------------------------
// Kurulum / temizlik
// ---------------------------------------------------------------------------------------------------------------------

test.beforeAll(async () => {
  test.setTimeout(360_000);
  adminToken = (await getCachedAdminSession()).accessToken;
  defaultLocale = await fetchDefaultLocale();
  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  if (!initialTelehealthEnabled) await patchSiteModule(adminToken, "telehealth", true);

  specialty = await createSpecialty(adminToken, { name: "QA PV Kardiyoloji", slug: `${PV_PREFIX}cardio-${RUN}`, enName: "QA PV Cardiology" });
  medicalCat = await createCategory(adminToken, { name: "QA PV Medical guide", slug: `${PV_PREFIX}medical-${RUN}`, isMedical: true });
  plainCat = await createCategory(adminToken, { name: "QA PV Travel guide", slug: `${PV_PREFIX}travel-${RUN}`, isMedical: false });

  doctorA = await createReviewerDoctor(adminToken, { fullName: "Pelin Qapreview", specialtyId: specialty.id, slug: `${PV_PREFIX}doctor-a-${RUN}` });
  doctorB = await createReviewerDoctor(adminToken, { fullName: "Berk Qaother", specialtyId: specialty.id, slug: `${PV_PREFIX}doctor-b-${RUN}` });

  doctorAToken = await fixtureUserTokenWithRetry(DOCTOR_A_EMAIL, DOCTOR_PASSWORD, "Bulut Hekim A");
  const userA = await adminGetUserByEmail(adminToken, DOCTOR_A_EMAIL);
  if (!userA) throw new Error("PV doktor A kullanicisi bulunamadi.");
  await linkDoctorUserRaw(adminToken, doctorA.id, userA.id);
  doctorATotp = (await with429Retry(() => setupAndEnableTwoFactorForSelf(doctorAToken, DOCTOR_PASSWORD))).secret;

  doctorBToken = await fixtureUserTokenWithRetry(DOCTOR_B_EMAIL, DOCTOR_PASSWORD, "Bulut Hekim B");
  const userB = await adminGetUserByEmail(adminToken, DOCTOR_B_EMAIL);
  if (!userB) throw new Error("PV doktor B kullanicisi bulunamadi.");
  await linkDoctorUserRaw(adminToken, doctorB.id, userB.id);
  await with429Retry(() => setupAndEnableTwoFactorForSelf(doctorBToken, DOCTOR_PASSWORD));

  draft = await createPost(adminToken, {
    title: TITLE.tr,
    slug: `${PV_PREFIX}draft-${RUN}`,
    excerpt: "Taslak onizleme ozeti",
    contentHtml: `<p>Giris metni.</p><h2>Onizleme neden onemli</h2><p>Test icerigi.</p><h2>Yayindan once inceleme</h2><p>Test icerigi.</p>`,
    categoryId: medicalCat.id,
    specialtyId: specialty.id,
    reviewerDoctorId: doctorA.id,
    keyTakeaways: ["Birinci madde", "Ikinci madde"],
    faq: [{ question: "Bu gercek bir tavsiye mi?", answer: "Hayir, yalnizca test verisidir." }],
    references: [{ title: "QA reference one", publisher: "Example Society", url: "https://example.com/reference-one", accessedAt: "2026-10-01" }],
    translations: {
      en: {
        title: TITLE.en,
        excerpt: "Draft preview excerpt for the test.",
        contentHtml: `<p>Introduction.</p><h2>${H2_EN[0]}</h2>${paragraphs(3, "preview")}<h2>${H2_EN[1]}</h2>${paragraphs(3, "review")}`,
        keyTakeaways: ["First fixture takeaway", "Second fixture takeaway"],
        faq: [{ question: "Is this real advice?", answer: "No, it is only a test fixture." }],
      },
      ar: {
        title: TITLE.ar,
        excerpt: "ملخص تجريبي للمعاينة.",
        contentHtml: "<p>مقدمة تجريبية.</p><h2>لماذا تهم المعاينة</h2><p>نص تجريبي للاختبار فقط.</p><h2>المراجعة قبل النشر</h2><p>نص تجريبي للاختبار فقط.</p>",
        keyTakeaways: ["النقطة الأولى", "النقطة الثانية"],
      },
    },
  });
  createdPostIds.push(draft.id);

  other = await createPost(adminToken, {
    title: "QA PV Diger Taslak",
    slug: `${PV_PREFIX}other-${RUN}`,
    contentHtml: "<p>Baska yazi.</p><h2>Baslik</h2><p>Test.</p>",
    categoryId: medicalCat.id,
    specialtyId: specialty.id,
    reviewerDoctorId: doctorA.id,
  });
  createdPostIds.push(other.id);

  published = await createPost(adminToken, {
    title: "QA PV Yayindaki Yazi",
    slug: `${PV_PREFIX}published-${RUN}`,
    contentHtml: "<p>Yayinda.</p><h2>Baslik</h2><p>Test.</p>",
    categoryId: plainCat.id,
    medicalReviewStatus: "not_required",
    status: "PUBLISHED",
  });
  createdPostIds.push(published.id);

  initialViews.value = postDbState(draft.id).viewCount;
  const reviewerRow = await publicPreview(draft.id, null);
  expect(reviewerRow.status).toBe(404);
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
  if (ctx.admin) await attempt("admin baglami", () => ctx.admin!.context.close());
  for (const id of createdPostIds) await attempt(`yazi ${id}`, () => deletePostPermanently(adminToken, id));
  if (doctorA) await attempt("hekim A", () => deleteAdminDoctorFixture(adminToken, doctorA.id));
  if (doctorB) await attempt("hekim B", () => deleteAdminDoctorFixture(adminToken, doctorB.id));
  if (specialty) await attempt("uzmanlik", () => deleteSpecialty(adminToken, specialty.id));
  if (medicalCat) await attempt("kategori medical", () => deleteCategory(adminToken, medicalCat.id));
  if (plainCat) await attempt("kategori plain", () => deleteCategory(adminToken, plainCat.id));
  await attempt("telehealth modul", async () => {
    if (!initialTelehealthEnabled) await patchSiteModule(adminToken, "telehealth", false);
  });
  expect(errors, `Temizlik hatalari:\n${errors.join("\n")}`).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------------
// Oturumsuz erisim
// ---------------------------------------------------------------------------------------------------------------------

test("oturumsuz: belirtecsiz, bozuk ve baska yazinin belirteci 404 (API ve sayfa)", async ({ browser }) => {
  const otherLink = await createShareLink(adminToken, other.id);

  // API
  assertNotPreviewable(await publicPreview(draft.id, null));
  assertNotPreviewable(await publicPreview(draft.id, "s_bozuk-belirtec"));
  assertNotPreviewable(await publicPreview(draft.id, "garbage"));
  assertNotPreviewable(await publicPreview(draft.id, otherLink.token));
  // Basarili cevap ile ayni govde: ayrim sizdirilmaz (gecersiz belirtec ile belirtecsiz ayni 404 govdesi).
  const a = await fetch(`${API_BASE_URL}/blog/preview/${draft.id}`);
  const b = await fetch(`${API_BASE_URL}/blog/preview/${draft.id}?t=s_bozuk`);
  expect(await a.text()).toBe(await b.text());
  expect(a.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(a.headers.get("cache-control")).toBe("no-store");

  // Sayfa (oturumsuz baglam)
  const context = await anonContext(browser);
  const page = await context.newPage();
  try {
    for (const url of [`/en/blog/preview/${draft.id}`, `/en/blog/preview/${draft.id}?t=s_bozuk-belirtec`, `/en/blog/preview/${draft.id}?t=${encodeURIComponent(otherLink.token)}`]) {
      const res = await page.goto(url);
      expect(res?.status(), url).toBe(404);
      await expect(page.getByTestId("blog-preview-banner")).toHaveCount(0);
    }
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Admin editoru: baglanti olusturma + oturumsuz goruntuleme
// ---------------------------------------------------------------------------------------------------------------------

test("admin editor: 'Onizleme baglantisi olustur' adresi gosterir; DB'de yalnizca ozet tutulur", async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await adminUi(browser);
  await openAdminEditor(admin.page, draft.id);
  await expect(admin.page.getByTestId("blog-preview-link-none")).toBeVisible();

  await admin.page.getByRole("button", { name: "Önizleme bağlantısı oluştur" }).click();
  const input = admin.page.locator(`#preview-link-${draft.id}`);
  await expect(input).toBeVisible({ timeout: 20_000 });
  const raw = await input.inputValue();
  expect(raw).toContain(`/blog/preview/${draft.id}`);
  ctx.shareToken = tokenOf(raw);
  expect(ctx.shareToken).toMatch(/^s_/);
  ctx.shareUrl = toBaseUrl(raw);
  await expect(admin.page.getByTestId("blog-preview-link-fresh")).toContainText("Son geçerlilik");

  // DB: ham belirtec saklanmaz, yalniz ozet ve son gecerlilik.
  const state = postDbState(draft.id);
  expect(state.previewTokenHash).toBeTruthy();
  expect(state.previewTokenHash).not.toBe(ctx.shareToken);
  expect(JSON.stringify(dbRows(`SELECT * FROM blog_posts WHERE id = '${draft.id}'`))).not.toContain(ctx.shareToken.slice(2));
  const days = (new Date(state.previewTokenExpiresAt!).getTime() - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(6.9);
  expect(days).toBeLessThan(7.1);

  await shotBoth(admin.page, "07-admin-editor-onizleme-karti-baglanti-olusturuldu", async () => {
    await admin.page.getByTestId("blog-preview-controls").scrollIntoViewIfNeeded();
  });

  // Etkin baglanti durumu (yeniden yukle: tam adres artik gosterilmez).
  await openAdminEditor(admin.page, draft.id);
  await expect(admin.page.getByTestId("blog-preview-link-status")).toContainText("Bağlantı etkin");
  await expect(admin.page.getByTestId("blog-preview-link-fresh")).toHaveCount(0);
  await expect(admin.page.getByRole("button", { name: "Bağlantıyı iptal et" })).toBeVisible();
  await shotBoth(admin.page, "09-admin-editor-onizleme-karti-etkin-baglanti", async () => {
    await admin.page.getByTestId("blog-preview-controls").scrollIntoViewIfNeeded();
  });
});

test("oturumsuz yeni baglam: paylasim adresi 200; serit, 'Review pending', noindex, JSON-LD/paylasim/canonical/hreflang yok; basliklar", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await anonContext(browser);
  const page = await context.newPage();
  try {
    // 1) Admin editorunun urettigi adres oldugu gibi (varsayilan dil yolu).
    const first = await page.goto(ctx.shareUrl!);
    expect(first?.status()).toBe(200);
    await expect(page.getByTestId("blog-preview-banner")).toBeVisible({ timeout: 60_000 });

    // 2) EN gorunum (ayni belirtec).
    const enUrl = `/en/blog/preview/${draft.id}?t=${encodeURIComponent(ctx.shareToken!)}`;
    const res = await page.goto(enUrl);
    expect(res?.status()).toBe(200);
    const headers = res!.headers();
    expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(headers["referrer-policy"]).toBe("no-referrer");

    await expect(page.getByTestId("blog-preview-banner")).toContainText("awaiting physician approval");
    await expect(page.getByRole("heading", { level: 1, name: TITLE.en })).toBeVisible();
    const pending = page.getByTestId("blog-byline-pending-reviewer");
    await expect(pending).toBeVisible();
    await expect(pending).toContainText(/Review pending: .*Qapreview/);
    reviewerDisplay = ((await pending.innerText()).match(/Review pending: (.*)/)?.[1] ?? "").trim();
    await expect(page.getByTestId("blog-byline-reviewer")).toHaveCount(0);
    await expect(page.getByText("Medically reviewed by")).toHaveCount(0);
    await expect(page.getByTestId("blog-last-reviewed")).toHaveCount(0);

    // Yayindaki sayfa tasarimi: H2 basliklari, ozet maddeler, SSS, kaynaklar gorunur.
    for (const h of H2_EN) await expect(page.getByRole("heading", { level: 2, name: h })).toBeVisible();
    await expect(page.getByTestId("blog-key-takeaways")).toBeVisible();
    await expect(page.getByTestId("blog-references")).toBeVisible();

    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
    await expect(page.getByTestId("blog-share")).toHaveCount(0);
    await expect(page.getByTestId("blog-share-copy")).toHaveCount(0);

    const robots = await page.locator('meta[name="robots"]').first().getAttribute("content");
    expect(robots).toMatch(/noindex/);
    expect(robots).toMatch(/nofollow/);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(0);
    await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);

    // Ekran goruntuleri: EN, TR (varsayilan dil), AR.
    await shotBoth(page, "01-onizleme-en", async () => {
      await expect(page.getByTestId("blog-preview-banner")).toBeVisible();
    });

    const trPath = defaultLocale === "tr" ? "" : "/tr";
    await page.goto(`${trPath}/blog/preview/${draft.id}?t=${encodeURIComponent(ctx.shareToken!)}`);
    await expect(page.getByTestId("blog-preview-banner")).toContainText("hekim onayı bekliyor");
    await expect(page.getByTestId("blog-byline-pending-reviewer")).toContainText(/İnceleme bekliyor: .*Qapreview/);
    await shotBoth(page, "03-onizleme-tr");

    await page.goto(`/ar/blog/preview/${draft.id}?t=${encodeURIComponent(ctx.shareToken!)}`);
    await expect(page.getByTestId("blog-preview-banner")).toContainText("بانتظار موافقة الطبيب");
    await expect(page.getByTestId("blog-byline-pending-reviewer")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await shotBoth(page, "05-onizleme-ar");
  } finally {
    await context.close();
  }
  expect(reviewerDisplay).toContain("Qapreview");
});

// ---------------------------------------------------------------------------------------------------------------------
// Iptal + yeniden olusturma + sure dolumu
// ---------------------------------------------------------------------------------------------------------------------

test("iptal: 'Baglantiyi iptal et' -> ayni adres 404; yeniden olusturma eskisini gecersiz kilar", async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = await adminUi(browser);
  await openAdminEditor(admin.page, draft.id);
  await admin.page.getByRole("button", { name: "Bağlantıyı iptal et" }).click();
  const dialog = admin.page.getByRole("alertdialog").or(admin.page.getByRole("dialog"));
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Bağlantıyı iptal et" }).click();
  await expect(admin.page.getByTestId("blog-preview-link-none")).toBeVisible({ timeout: 20_000 });

  expect((await getShareLinkStatus(adminToken, draft.id)).active).toBe(false);
  const dbAfter = postDbState(draft.id);
  expect(dbAfter.previewTokenHash).toBeNull();
  expect(dbAfter.previewTokenExpiresAt).toBeNull();

  assertNotPreviewable(await publicPreview(draft.id, ctx.shareToken!));
  const context = await anonContext(browser);
  const page = await context.newPage();
  try {
    const res = await page.goto(ctx.shareUrl!);
    expect(res?.status()).toBe(404);
    await expect(page.getByTestId("blog-preview-banner")).toHaveCount(0);
    await shotBoth(page, "15-404-iptal-edilmis-baglanti");

    // Yeniden olusturma (UI): eski belirtec gecersiz, yeni gecerli; bir kez daha olusturunca bir oncekiyle degisir.
    await admin.page.getByRole("button", { name: "Önizleme bağlantısı oluştur" }).click();
    const input = admin.page.locator(`#preview-link-${draft.id}`);
    await expect(input).toBeVisible({ timeout: 20_000 });
    const urlV2 = await input.inputValue();
    const tokenV2 = tokenOf(urlV2);
    expect(tokenV2).not.toBe(ctx.shareToken);
    expect((await publicPreview(draft.id, tokenV2)).status).toBe(200);
    expect((await publicPreview(draft.id, ctx.shareToken!)).status).toBe(404);

    await admin.page.getByRole("button", { name: "Önizleme bağlantısı oluştur" }).click();
    await expect(input).not.toHaveValue(urlV2, { timeout: 20_000 });
    const tokenV3 = tokenOf(await input.inputValue());
    expect(tokenV3).not.toBe(tokenV2);
    expect((await publicPreview(draft.id, tokenV2)).status).toBe(404);
    expect((await publicPreview(draft.id, tokenV3)).status).toBe(200);
    const pageRes = await page.goto(`${toBaseUrl(urlV2)}`);
    expect(pageRes?.status()).toBe(404);
    ctx.shareToken = tokenV3;
    ctx.shareUrl = toBaseUrl(await input.inputValue());
    const ok = await page.goto(ctx.shareUrl);
    expect(ok?.status()).toBe(200);
  } finally {
    await context.close();
  }
});

test("suresi dolmus: previewTokenExpiresAt gecmise cekilince 404 ve admin durumu 'etkin degil'", async ({ browser }) => {
  expect((await publicPreview(draft.id, ctx.shareToken!)).status).toBe(200);
  expirePreviewTokenInDb(draft.id);
  assertNotPreviewable(await publicPreview(draft.id, ctx.shareToken!));
  expect((await getShareLinkStatus(adminToken, draft.id)).active).toBe(false);

  const context = await anonContext(browser);
  const page = await context.newPage();
  try {
    const res = await page.goto(ctx.shareUrl!);
    expect(res?.status()).toBe(404);
  } finally {
    await context.close();
  }
  // Bir sonraki testler icin taze baglanti.
  const fresh = await createShareLink(adminToken, draft.id);
  ctx.shareToken = fresh.token;
  expect((await publicPreview(draft.id, fresh.token)).status).toBe(200);
});

// ---------------------------------------------------------------------------------------------------------------------
// Oturum belirteci: admin "Onizle"
// ---------------------------------------------------------------------------------------------------------------------

test("admin editor 'Onizle' (oturum belirteci) yeni sekmede 200 acar; belirtec 'p_' onekli ve baska yazida gecersiz", async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await adminUi(browser);
  await openAdminEditor(admin.page, draft.id);

  const [popup] = await Promise.all([
    admin.context.waitForEvent("page"),
    admin.page.getByTestId("blog-preview-controls").getByRole("button", { name: "Önizle", exact: true }).click(),
  ]);
  await popup.waitForURL(/\/blog\/preview\//, { timeout: 30_000 });
  const url = new URL(popup.url());
  expect(url.pathname).toContain(`/blog/preview/${draft.id}`);
  const sessionToken = url.searchParams.get("t") ?? "";
  expect(sessionToken).toMatch(/^p_/);
  await expect(popup.getByTestId("blog-preview-banner")).toBeVisible({ timeout: 60_000 });
  await expect(popup.getByTestId("blog-byline-pending-reviewer")).toBeVisible();
  expect((await popup.reload())?.status()).toBe(200);
  await popup.close();

  expect((await publicPreview(draft.id, sessionToken)).status).toBe(200);
  expect((await publicPreview(other.id, sessionToken)).status).toBe(404);
  // Oturum belirteci yazi durumunu/paylasim baglantisini degistirmez.
  expect((await getShareLinkStatus(adminToken, draft.id)).active).toBe(true);
});

// ---------------------------------------------------------------------------------------------------------------------
// Admin blog listesi
// ---------------------------------------------------------------------------------------------------------------------

test("admin blog listesi: taslak satirinda 'Onizle' var, yayindaki satirda yok; tiklayinca 200", async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await adminUi(browser);
  const page = admin.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/blog");
  const draftRow = page.getByRole("row").filter({ hasText: TITLE.tr });
  const publishedRow = page.getByRole("row").filter({ hasText: "QA PV Yayindaki Yazi" });
  await expect(draftRow).toBeVisible({ timeout: 60_000 });
  await expect(publishedRow).toBeVisible();

  await draftRow.hover();
  await expect(draftRow.getByRole("button", { name: "Önizle", exact: true })).toBeVisible();
  await publishedRow.hover();
  await expect(publishedRow.getByRole("button", { name: "Önizle", exact: true })).toHaveCount(0);
  await expect(publishedRow.getByText("Önizle", { exact: true })).toHaveCount(0);

  await draftRow.scrollIntoViewIfNeeded();
  await draftRow.hover();
  await page.waitForTimeout(400);
  await shot(page, "11-admin-blog-listesi-onizle-masaustu.png");
  // Mobil: kartli gorunum; "Önizle" satir islem menusundedir.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: `${TITLE.tr} için işlemler` }).click();
  const menuItem = page.getByRole("menuitem", { name: "Önizle", exact: true });
  await expect(menuItem).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, "11-admin-blog-listesi-onizle-mobil.png");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: `QA PV Yayindaki Yazi için işlemler` })).toBeVisible();
  await page.getByRole("button", { name: `QA PV Yayindaki Yazi için işlemler` }).click();
  await expect(page.getByRole("menuitem", { name: "Önizle", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1440, height: 900 });
  await draftRow.hover();
  const [popup] = await Promise.all([admin.context.waitForEvent("page"), draftRow.getByRole("button", { name: "Önizle", exact: true }).click()]);
  await popup.waitForURL(/\/blog\/preview\//, { timeout: 30_000 });
  expect(new URL(popup.url()).searchParams.get("t")).toMatch(/^p_/);
  await expect(popup.getByTestId("blog-preview-banner")).toBeVisible({ timeout: 60_000 });
  expect((await popup.reload())?.status()).toBe(200);
  await popup.close();
});

// ---------------------------------------------------------------------------------------------------------------------
// Doktor paneli
// ---------------------------------------------------------------------------------------------------------------------

test("doktor paneli: atanan hekim 'Preview' ile onizlemeyi acar (200); atanmamis hekim oturum belirteci alamaz (404)", async ({ browser }) => {
  test.setTimeout(240_000);
  // API: atanmamis hekim (B) 404, atanan hekim (A) 200 ve 'p_' belirteci.
  const denied = await doctorPreviewSession(doctorBToken, draft.id);
  expect(denied.status).toBe(404);
  const allowed = await doctorPreviewSession(doctorAToken, draft.id);
  expect(allowed.status).toBe(200);
  expect(allowed.token).toMatch(/^p_/);
  // Baska bir hekimin belirteci ile baska yazi / rastgele id de calismaz.
  expect((await doctorPreviewSession(doctorBToken, other.id)).status).toBe(404);
  expect((await doctorPreviewSession(doctorAToken, "00000000-0000-0000-0000-000000000000")).status).toBe(404);
  // Admin oturumu olmayan hekim belirteci admin ucunu acamaz.
  expect((await adminPreviewSession(doctorAToken, draft.id)).status).toBeGreaterThanOrEqual(401);

  // UI
  const doc = await loginAs(browser, DOCTOR_A_EMAIL, DOCTOR_PASSWORD, doctorATotp);
  try {
    await doc.page.goto("/en/doctor/blog-review");
    const card = doc.page.getByTestId("doctor-blog-review-item").filter({ hasText: TITLE.tr });
    await expect(card).toBeVisible({ timeout: 60_000 });
    const button = card.getByRole("button", { name: new RegExp(`^(Preview|Önizle): ${TITLE.tr}$`) });
    await expect(button).toBeVisible();
    await shotBoth(doc.page, "13-doktor-paneli-onizleme", async () => {
      await card.scrollIntoViewIfNeeded();
    });
    await doc.page.setViewportSize({ width: 1440, height: 900 });

    const [popup] = await Promise.all([doc.context.waitForEvent("page"), button.click()]);
    await popup.waitForURL(/\/blog\/preview\//, { timeout: 30_000 });
    const popupUrl = popup.url();
    expect(new URL(popupUrl).searchParams.get("t")).toMatch(/^p_/);
    expect(new URL(popupUrl).pathname).toContain(`/blog/preview/${draft.id}`);

    // Sunucu yaniti: ayni adres oturumsuz baglamda 200 (belirtec yeterli) -- hekim oturumundan bagimsiz dogrulama.
    const anon = await anonContext(browser);
    try {
      const anonPage = await anon.newPage();
      expect((await anonPage.goto(popupUrl))?.status()).toBe(200);
      await expect(anonPage.getByTestId("blog-preview-banner")).toContainText(/awaiting physician approval|hekim onayı bekliyor/);
      await expect(anonPage.getByTestId("blog-byline-pending-reviewer")).toContainText("Qapreview");
    } finally {
      await anon.close();
    }

    // UYGULAMA HATASI (bkz. rapor): doktor oturumu aciksa (site) grubundaki DoctorPortalRouteGuard onizleme sekmesini
    // kisa sure sonra /doctor portalina geri yonlendirir. Onizleme sekmesi acik kalmali.
    await popup.waitForLoadState("networkidle").catch(() => undefined);
    await popup.waitForTimeout(4_000);
    ctx.doctorPopupFinalUrl = popup.url();
    await popup.close();
  } finally {
    await doc.context.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Durum degismez + sitemap/llms
// ---------------------------------------------------------------------------------------------------------------------

test("onizleme yazi durumunu degistirmez: DRAFT, pending, viewCount ayni", async () => {
  // Bu noktaya kadar onlarca onizleme goruntulemesi yapildi.
  const state = postDbState(draft.id);
  expect(state.status).toBe("DRAFT");
  expect(state.medicalReviewStatus).toBe("pending");
  expect(state.viewCount).toBe(initialViews.value);
  // Bir kez daha goruntule, sayac yine ayni.
  expect((await publicPreview(draft.id, ctx.shareToken!)).status).toBe(200);
  expect(postDbState(draft.id).viewCount).toBe(initialViews.value);
});

test("API sozlesmesi: onizleme DTO'su preview:true, reviewer:null, pendingReviewer dolu, reviewApproved:false", async () => {
  const res = await publicPreview(draft.id, ctx.shareToken!, "en");
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  const data = res.data!;
  expect(data.preview).toBe(true);
  expect(data.reviewer).toBeNull();
  expect(data.reviewApproved).toBe(false);
  const pending = data.pendingReviewer as { name: string; slug: string } | null;
  expect(pending?.name).toContain("Qapreview");
  expect(pending?.slug).toBe(doctorA.slug);
  expect(data.title).toBe(TITLE.en);
  // Yayindaki yazinin detay ucu taslagi yine de vermez.
  const pub = await fetch(`${API_BASE_URL}/blog/posts/${PV_PREFIX}draft-${RUN}?locale=en`);
  expect(pub.status).toBe(404);
  // Cop kutusundaki yazi icin onizleme baglantisi uretilemez (kontrat) -> bu testte kullanilmaz; yalniz admin ucu 404 kontrolu.
  const missing = await fetch(`${API_BASE_URL}/admin/blog/00000000-0000-0000-0000-000000000000/preview-link`, { method: "POST", headers: { Authorization: `Bearer ${adminToken}` } });
  expect(missing.status).toBe(404);
  // Yetkisiz (oturumsuz) admin ucu.
  const anon = await fetch(`${API_BASE_URL}/admin/blog/${draft.id}/preview-link`, { method: "POST" });
  expect(anon.status).toBe(401);
});

test("/sitemap.xml ve /llms.txt (+ blog listesi) '/blog/preview' ve taslak yazi icermez", async ({ browser }) => {
  const context = await anonContext(browser);
  const page = await context.newPage();
  try {
    for (const p of ["/sitemap.xml", "/llms.txt", "/en/blog", "/blog"]) {
      const res = await page.goto(p);
      expect(res?.status(), p).toBeLessThan(400);
      const body = await res!.text();
      if (p === "/sitemap.xml") expect(body.length).toBeGreaterThan(100);
      expect(body, `${p} icinde /blog/preview`).not.toContain("/blog/preview");
      expect(body, `${p} icinde taslak slug`).not.toContain(`${PV_PREFIX}draft-${RUN}`);
      expect(body, `${p} icinde paylasim belirteci`).not.toContain(ctx.shareToken!);
    }
  } finally {
    await context.close();
  }
});

// Bilerek EN SONDA: basarisiz olursa worker yeniden baslar; sonraki testlerin ortak durumunu bozmasin.
test("doktor onizleme sekmesi (site) grubundaki doktor yonlendirmesiyle portala atilmaz [UYGULAMA HATASI: DoctorPortalRouteGuard]", async () => {
  expect(ctx.doctorPopupFinalUrl, "doktor testi calismadi").toBeTruthy();
  expect(ctx.doctorPopupFinalUrl!, "Doktor onizleme sekmesi portala geri yonlendirildi").toContain("/blog/preview/");
});
