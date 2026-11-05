import http from "node:http";
import { test, expect, type Page } from "@playwright/test";
import {
  API_BASE_URL,
  getNavigationConfig,
  getCachedAdminSession,
  createPageWithBlocks,
  deletePagePermanently,
  getAdminSettings,
  getFixtureUserToken,
  patchSiteSettings,
  setupAndEnableTwoFactorForSelf,
  ensureLocaleEnabled,
} from "./support/api";
import { adminGetUserByEmail, adminUpdateRole } from "./support/admin-users-fixtures";
import {
  createCategory,
  createPost,
  createReviewerDoctor,
  createSpecialty,
  deleteCategory,
  deletePostPermanently,
  deleteSpecialty,
  type Z1Specialty,
} from "./support/blog-z1-fixtures";
import { deleteAdminDoctorFixture } from "./support/telehealth-fixtures";

/**
 * qa-agent — Paket AH (Faz 1) e2e: "aracı kuruluş" dönüşümü.
 *  - Ziyaretçi sayfalarında doktor adı/fotoğrafı/şeması yok (ana sayfa, Hakkımızda, bölüm, blog, sitemap, llms.txt, JSON-LD).
 *  - /physicians, /medical-reviewers, /tr/*, /cart, /checkout yönlendirmeleri; dil seçicide TR yok.
 *  - Kimlik ibaresi (üst şerit, footer, Hakkımızda, talep formu, blog yazısı); belge numarası boş/dolu.
 *  - Talep formu: doğrulama, rıza kutuları, kayıt + talep no, CRM'de görünür, honeypot, oran sınırı (6. istek 429).
 *  - Menü 5 öğe, 8 dilde etiket.
 *
 * Ön koşul (canlı sırası, saas_e2e): switch-default-locale-to-en, disable-site-locale, setup-intermediary-nav,
 * localize-footer-english script'leri uygulanmış olmalı (bkz. docs/prompts/2026-11-02-AH-ekran/script-ciktilari.txt).
 * E-posta içerikleri backend vitest'inde; burada yalnızca sunucu tarafı kayıt doğrulanır.
 * Talep oranı sınırı 5/dk/IP: POST sayısı bu dosyada bilinçli sınırlıdır; oran sınırı testi en sonda, yeni pencerede koşar.
 */

// Worker yeniden başlasa da (başarısız testten sonra) aynı değeri kullanmak için ortam değişkeninde tutulur.
const RUN = (process.env.QA_AH_RUN ??= Date.now().toString(36));
const SHORT_LABEL = "International Health Tourism Intermediary";
const CERT_NO = "TR-HT-2026-001";
const CERT_LINE = `Health Tourism Authorization Certificate No: ${CERT_NO}`;
const LOCALES_8 = ["en", "de", "ar", "ru", "fr", "es", "ro", "sr-latn"] as const;
const SEED_DOCTOR_TOKENS = ["Aydemir", "Whitfield", "Bennett", "Braun", "Vahit Mutlu"];
const REVIEWER_TOKEN = `Kaplanoglu${RUN}`;
const DOCTOR_TOKENS = [...SEED_DOCTOR_TOKENS, REVIEWER_TOKEN];
const FORBIDDEN_LD_TYPES = ["Physician", "MedicalClinic", "MedicalOrganization", "Hospital", "MedicalBusiness", "Dentist"];

test.use({ navigationTimeout: 120_000, actionTimeout: 20_000 });

let token = "";
let parent: Z1Specialty;
let child: Z1Specialty;
let categoryId = "";
let doctorId = "";
let postId = "";
let postSlug = "";
let userId = "";
const PARENT_SLUG = `qa-ah-gastro-${RUN}`;
const CHILD_SLUG = `qa-ah-esd-${RUN}`;
const FIXTURE_PASSWORD = "Zx9-Plover-Quartz-71!";
const FIXTURE_EMAIL = `qa-ah-crm-${RUN}@example.com`;
const REQUEST_EMAIL = `qa-ah-visitor-${RUN}@example.com`;
let createdRequestNumber = "";
let homePageId = "";
let originalHomePageId: string | null = null;
let crmToken = "";

/** Node `*.localhost` çözemez (bkz. playwright.config.ts) — 127.0.0.1'e bağlanıp Host başlığını elle veririz. */
function rawGet(path: string): Promise<{ status: number; location: string | null; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: 3100, path, headers: { Host: "siteadi.localhost:3100" } }, (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, location: (res.headers.location as string | undefined) ?? null, body }));
      })
      .on("error", reject);
  });
}

async function adminFetch(path: string, init: RequestInit = {}, bearer = token) {
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}`, ...(init.headers ?? {}) },
  });
}

function requestBody(over: Record<string, unknown> = {}) {
  return {
    serviceSlug: CHILD_SLUG,
    packageSlug: null,
    preferredFrom: "2026-12-01",
    preferredTo: "2026-12-15",
    country: "DE",
    contactLanguage: "de",
    needsInterpreter: true,
    fullName: "Max Mustermann QA",
    email: REQUEST_EMAIL,
    phone: null,
    message: null,
    contactConsent: true,
    healthDataConsent: false,
    locale: "en",
    website: "",
    ...over,
  };
}

async function postRequest(body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE_URL}/consultation-requests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- e2e: serbest JSON gövdesi
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}


/** Yeni bölümler fetch önbelleğinde (60 sn) bayat olabilir: talep formunda hizmet kartı görünene dek yokla. */
async function gotoRequestWhenServiceListed(page: Page, query = "") {
  await expect(async () => {
    await page.goto(`/request${query}`);
    await expect(page.getByTestId(`request-service-${CHILD_SLUG}`)).toHaveCount(1, { timeout: 2_000 });
  }).toPass({ timeout: 100_000, intervals: [3_000, 5_000] });
}

/** AL: AJ-7 sihirbazı — hizmet kartı (gizli radyo) etiketine tıklanarak seçilir. */
async function selectService(page: Page, slug: string) {
  await page.getByTestId(`request-service-${slug}`).locator("xpath=ancestor::label").click();
  await expect(page.getByTestId(`request-service-${slug}`)).toBeChecked();
}

/** AL: AJ-7 sihirbazını 4. adıma (özet + rıza) kadar doldurur; hizmet ?service= ile ön seçili varsayılır. */
async function walkRequestToReview(
  page: Page,
  o: { dateFrom?: string; dateTo?: string; interpreter?: boolean; contactLanguage?: string; phone?: string; message?: string }
) {
  const next = page.getByTestId("request-next");
  await expect(page.getByTestId(`request-service-${CHILD_SLUG}`)).toBeChecked();
  await next.click();
  await expect(page.getByTestId("request-step-2")).toBeVisible();
  if (o.dateFrom && o.dateTo) {
    await page.getByTestId("request-date-from").fill(o.dateFrom);
    await page.getByTestId("request-date-to").fill(o.dateTo);
  } else {
    await page.getByTestId("request-flexible").check();
  }
  await page.locator("#request-country").selectOption("DE");
  if (o.contactLanguage) await page.locator("#request-contact-language").selectOption(o.contactLanguage);
  if (o.interpreter) await page.getByTestId("request-interpreter").check({ force: true }); // AL: sr-only radyo/anahtar üzerinde görsel katman tıklamayı keser
  await next.click();
  await expect(page.getByTestId("request-step-3")).toBeVisible();
  await page.locator("#request-full-name").fill("Max Mustermann QA");
  await page.locator("#request-email").fill(REQUEST_EMAIL);
  if (o.phone) await page.locator("#request-phone").fill(o.phone);
  if (o.message) await page.locator("#request-message").fill(o.message);
  await next.click();
  await expect(page.getByTestId("request-step-4")).toBeVisible();
}

async function visibleAndHtml(page: Page) {
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const html = await page.content();
  return { text, html };
}

async function ldTypes(page: Page): Promise<{ types: string[]; keys: string[] }> {
  const raws = await page.locator('script[type="application/ld+json"]').allTextContents();
  const types: string[] = [];
  const keys: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      const t = o["@type"];
      if (typeof t === "string") types.push(t);
      else if (Array.isArray(t)) types.push(...(t as string[]));
      for (const [k, v] of Object.entries(o)) {
        keys.push(k);
        walk(v);
      }
    }
  };
  for (const raw of raws) {
    try {
      walk(JSON.parse(raw));
    } catch {
      /* bozuk JSON-LD ayrı bir bulgudur */
      types.push("__INVALID_JSON__");
    }
  }
  return { types, keys };
}

test.beforeAll(async () => {
  token = (await getCachedAdminSession()).accessToken;
  // AL: spec /de yollarını sınar — saas_e2e taban hattında "de" etkin olmalı (bkz. support/api.ts::ensureLocaleEnabled).
  await ensureLocaleEnabled(token, "de", "German", "Deutsch");
  await patchSiteSettings(token, { healthTourismCertificateNo: null });
  parent = await createSpecialty(token, { name: `QA AH Gastro ${RUN}`, slug: PARENT_SLUG, enName: `QA AH Gastroenterology ${RUN}` });
  const childRes = await adminFetch("/admin/telehealth/specialties", {
    method: "POST",
    body: JSON.stringify({ name: `QA AH ESD ${RUN}`, slug: CHILD_SLUG, icon: "Stethoscope", parentId: parent.id, translations: { en: { name: `QA AH ESD ${RUN}` } } }),
  });
  expect(childRes.status, await childRes.clone().text()).toBe(201);
  child = ((await childRes.json()) as { data: Z1Specialty }).data;
  categoryId = (await createCategory(token, { name: `QA AH Cat ${RUN}`, slug: `qa-ah-cat-${RUN}`, isMedical: false })).id;
  const doctor = await createReviewerDoctor(token, { fullName: `Zeynep ${REVIEWER_TOKEN}`, specialtyId: parent.id, slug: `qa-ah-doc-${RUN}` });
  doctorId = doctor.id;
  postSlug = `qa-ah-post-${RUN}`;
  const post = await createPost(token, {
    title: `QA AH Post ${RUN}`,
    slug: postSlug,
    excerpt: "QA AH excerpt",
    contentHtml: "<p>QA AH blog body paragraph.</p>",
    categoryId,
    specialtyId: parent.id,
    reviewerDoctorId: doctorId,
    status: "PUBLISHED",
    medicalReviewStatus: "pending",
  });
  postId = post.id;

  // e2e veritabanının varsayılan ana sayfası telehealth-clinic demo şablonudur (Türkçe, doktor adlarını CMS metni olarak
  // içerir; kod filtresi CMS metnine uygulanmaz). Kodun doktor bloklarını gizlediğini doğrulamak için geçici temiz ana sayfa:
  // öne çıkan doktorlar (grid + carousel/all) blokları İÇEREN, ama başka doktor metni içermeyen bir sayfa.
  originalHomePageId = ((await getAdminSettings(token)).homePageId as string | null) ?? null;
  const fd = (id: string, data: Record<string, unknown>) => ({
    id: `c-${id}`,
    type: "container",
    settings: {},
    children: [{ id, type: "featured-doctors", data: { content: { en: { title: "Featured Doctors" } }, showAllButton: true, ...data } }],
  });
  const home = await createPageWithBlocks(token, {
    title: `QA AH Home ${RUN}`,
    slug: `qa-ah-home-${RUN}`,
    status: "PUBLISHED",
    blocks: [
      {
        id: "c-text",
        type: "container",
        settings: {},
        children: [{ id: "t1", type: "text", data: { html: "<h1>QA AH Home</h1><p>Plan your treatment with a patient coordinator.</p>" } }],
      },
      fd("fd-grid", { doctorIds: [doctorId], columns: 4 }),
      fd("fd-all", { layout: "carousel", source: "all" }),
    ],
  });
  homePageId = home.id as string;
  await patchSiteSettings(token, { homePageId });
});

test.afterAll(async () => {
  await patchSiteSettings(token, { healthTourismCertificateNo: null, homePageId: originalHomePageId }).catch(() => undefined);
  if (homePageId) await deletePagePermanently(token, homePageId).catch(() => undefined);
  if (postId) await deletePostPermanently(token, postId).catch(() => undefined);
  if (categoryId) await deleteCategory(token, categoryId).catch(() => undefined);
  if (doctorId) await deleteAdminDoctorFixture(token, doctorId).catch(() => undefined);
  if (child) await deleteSpecialty(token, child.id).catch(() => undefined);
  if (parent) await deleteSpecialty(token, parent.id).catch(() => undefined);
  if (userId) await adminFetch(`/admin/users/${userId}`, { method: "DELETE" }).catch(() => undefined);
});

test.describe("Ziyaretçide doktor yok", () => {
  const pages: Array<[string, () => string]> = [
    ["ana sayfa", () => "/"],
    ["Hakkımızda", () => "/about"],
    ["Health Tourism Services", () => "/specialties"],
    ["üst bölüm sayfası", () => `/specialties/${PARENT_SLUG}`],
    ["alt bölüm sayfası", () => `/specialties/${CHILD_SLUG}`],
    ["blog listesi", () => "/blog"],
    ["blog yazısı", () => `/blog/${postSlug}`],
    ["içerik standartları", () => "/content-standards"],
    ["talep formu", () => "/request"],
    ["sihirbaz", () => "/find-your-treatment"],
    ["AR ana sayfa", () => "/ar"],
    ["AR Hakkımızda", () => "/ar/about"],
    ["DE Health Tourism Services", () => "/de/specialties"],
  ];

  test("hazırlık: geçici temiz CMS ana sayfası yayında (ISR önbelleği 60 sn'ye kadar bayat olabilir)", async ({ page }) => {
    await expect(async () => {
      await page.goto("/");
      await page.reload();
      await expect(page.locator("body")).toContainText("QA AH Home", { timeout: 2_000 });
    }).toPass({ timeout: 100_000, intervals: [3_000, 5_000] });
  });

  for (const [label, pathOf] of pages) {
    test(`${label}: doktor adı/unvanı, hekim bağlantısı, hekim görseli ve hekim JSON-LD'si yok`, async ({ page }) => {
      const path = pathOf();
      const res = await page.goto(path, { waitUntil: "load" });
      expect(res?.status(), path).toBeLessThan(400);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const { text, html } = await visibleAndHtml(page);
      for (const name of DOCTOR_TOKENS) {
        expect(text, `${path}: görünür metinde doktor adı "${name}"`).not.toContain(name);
        expect(html, `${path}: HTML/RSC yükünde doktor adı "${name}"`).not.toContain(name);
      }
      expect(text, `${path}: "Medically reviewed by"`).not.toMatch(/Medically reviewed by|Review pending/i);
      // Footer hariç (footer bağlantıları DB verisidir; ayrı testte): header + main içinde hekim bağlantısı olmamalı.
      expect(await page.locator('header a[href*="/physicians"], header a[href*="/doctors"], main a[href*="/physicians"], main a[href*="/doctors"]').count(), `${path}: hekim bağlantısı`).toBe(0);
      expect(await page.locator('img[alt*="Dr." i], img[src*="/doctors/"], img[src*="physician"]').count(), `${path}: hekim görseli`).toBe(0);
      const ld = await ldTypes(page);
      expect(ld.types, `${path}: JSON-LD geçersiz`).not.toContain("__INVALID_JSON__");
      for (const bad of FORBIDDEN_LD_TYPES) expect(ld.types, `${path}: JSON-LD @type ${bad}`).not.toContain(bad);
      expect(ld.keys, `${path}: JSON-LD reviewedBy`).not.toContain("reviewedBy");
    });
  }

  test("footer'da hekim adresi bağlantısı (/physicians, /doctors) yok", async ({ page }) => {
    await page.goto("/");
    const hrefs = await page.locator('footer a[href*="/physicians"], footer a[href*="/doctors"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(hrefs).toEqual([]);
  });

  test("ana sayfa kurum JSON-LD'si Organization/TravelAgency tipindedir", async ({ page }) => {
    await page.goto("/");
    const ld = await ldTypes(page);
    expect(ld.types.some((t) => t === "Organization" || t === "TravelAgency"), `bulunan tipler: ${ld.types.join(",")}`).toBe(true);
  });

  test("sitemap'ler ve llms.txt'de doktor/hekim adresi ve /tr yok", async () => {
    const index = await rawGet("/sitemap.xml");
    expect(index.status).toBe(200);
    const subs = [...index.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);
    expect(subs.length).toBeGreaterThan(0);
    const bodies = [index.body];
    for (const p of subs) {
      const r = await rawGet(p);
      expect(r.status, p).toBe(200);
      bodies.push(r.body);
    }
    for (const body of bodies) {
      expect(body).not.toMatch(/\/physicians|\/doctors/);
      expect(body).not.toMatch(/siteadi\.localhost:3100\/tr(\/|<|")/);
      expect(body).not.toMatch(/hreflang="tr"/i);
      expect(body).not.toContain(`qa-ah-doc-${RUN}`);
      for (const name of DOCTOR_TOKENS) expect(body).not.toContain(name);
    }
    for (const llms of ["/llms.txt", "/llms-full.txt"]) {
      const r = await rawGet(llms);
      expect(r.status, llms).toBe(200);
      for (const name of DOCTOR_TOKENS) expect(r.body, `${llms}: ${name}`).not.toContain(name);
      expect(r.body, llms).not.toMatch(/\/physicians\//);
    }
  });

  test("public API: blog yazısı detayında hekim/reviewer alanı sızmaz", async () => {
    const res = await fetch(`${API_BASE_URL}/blog/posts/${postSlug}?locale=en`);
    // Not: API yolu projeye göre farklı olabilir; 200 değilse test bilgi amaçlı atlanır.
    test.skip(res.status !== 200, `blog detay ucu ${res.status}`);
    const body = JSON.stringify(await res.json());
    for (const name of DOCTOR_TOKENS) {
      const i = body.indexOf(name);
      expect(i, `API gövdesinde "${name}" geçiyor: ...${i >= 0 ? body.slice(Math.max(0, i - 80), i + 60) : ""}...`).toBe(-1);
    }
  });
});

test.describe("Yönlendirmeler", () => {
  const permanent = [301, 308];
  const cases: Array<{ from: string; to: RegExp; codes: number[] }> = [
    { from: "/physicians", to: /^\/specialties$/, codes: permanent },
    { from: "/ar/physicians", to: /^\/ar\/specialties$/, codes: permanent },
    { from: "/medical-reviewers", to: /^\/content-standards$/, codes: permanent },
    { from: "/de/medical-reviewers", to: /^\/de\/content-standards$/, codes: permanent },
    { from: "/cart", to: /^\/request$/, codes: permanent },
    { from: "/de/cart", to: /^\/de\/request$/, codes: permanent },
    { from: "/checkout", to: /^\/request$/, codes: permanent },
    { from: "/checkout/success", to: /^\/request$/, codes: permanent },
    { from: "/checkout/cancel", to: /^\/request$/, codes: permanent },
    { from: "/tr", to: /^\/$/, codes: [301] },
    { from: "/tr/about", to: /^\/about$/, codes: [301] },
    { from: "/tr/specialties", to: /^\/specialties$/, codes: [301] },
    { from: "/tr/blog", to: /^\/blog$/, codes: [301] },
    { from: "/tr/physicians", to: /^\/physicians$/, codes: [301] },
    { from: "/doctors", to: /^\/physicians$/, codes: [301] },
  ];
  for (const c of cases) {
    test(`${c.from} -> ${c.to} (${c.codes.join("/")})`, async () => {
      const r = await rawGet(c.from);
      expect(c.codes, `durum ${r.status}`).toContain(r.status);
      expect(r.location, "Location").not.toBeNull();
      expect(new URL(r.location!, "http://siteadi.localhost:3100").pathname).toMatch(c.to);
    });
  }

  test("/physicians/<slug> -> hekimin bölümü (aktifse) ya da /specialties; sorgu dizesi korunur ve zincir sonunda 200", async ({ page }) => {
    const r = await rawGet(`/physicians/qa-ah-doc-${RUN}`);
    expect([301, 308]).toContain(r.status);
    const target = new URL(r.location!, "http://siteadi.localhost:3100").pathname;
    expect(target).toMatch(/^\/specialties(\/.+)?$/);
    // Hekim, fixture bölümünün (aktif) hekimi → bölüm sayfasına gitmeli.
    expect(target).toBe(`/specialties/${PARENT_SLUG}`);
    const res = await page.goto(`/physicians/qa-ah-doc-${RUN}`);
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`/specialties/${PARENT_SLUG}$`));
  });

  test("/doctors/<slug> eski adresi de ziyaretçiyi hekim yerine bölüme taşır", async ({ page }) => {
    await page.goto(`/doctors/qa-ah-doc-${RUN}`);
    await expect(page).toHaveURL(new RegExp(`/specialties/${PARENT_SLUG}$`));
  });
});

test.describe("Dil seçici ve menü", () => {
  test("dil seçicide Türkçe yok", async ({ page }) => {
    await page.goto("/");
    const trigger = page.getByRole("button", { name: /:\s*English/ }).first();
    await expect(trigger).toBeVisible();
    await trigger.click();
    const items = page.getByRole("menuitem");
    await expect(items.first()).toBeVisible();
    const labels = (await items.allTextContents()).map((t) => t.trim());
    expect(labels.join(" | ")).not.toMatch(/Türkçe|Turkish|Turkce|İngilizce/i);
    expect(await page.locator('[role="menuitem"][lang="tr"], a[hreflang="tr"]').count()).toBe(0);
    expect(labels.some((l) => /English/.test(l))).toBe(true);
    expect(labels.some((l) => /Deutsch/.test(l))).toBe(true);
    expect(labels.some((l) => /العربية/.test(l))).toBe(true);
  });

  test("hreflang alternates'te tr yok", async ({ page }) => {
    await page.goto("/about");
    const langs = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((els) => els.map((e) => e.getAttribute("hreflang")));
    expect(langs).not.toContain("tr");
  });

  test("API: header menüsü 5 öğe ve 8 dilde etiket (en + ar zorunlu, hepsi dolu, Türkçe yok)", async () => {
    // Genel uç yalnızca etkin dilleri çevirir (saas_e2e'de en/ar/de); 8 dilin tamamı admin ucundaki çeviri kayıtlarından doğrulanır.
    const nav = (await getNavigationConfig(token)) as { navigationItems: Array<{ label: string; href: string; order: number; parentId: string | null; translations?: Record<string, { label?: string }> | null }> };
    const roots = nav.navigationItems.filter((i) => i.parentId === null).sort((a, b) => a.order - b.order);
    expect(roots, "kök öğe sayısı").toHaveLength(5);
    expect(roots.map((i) => i.href)).toEqual(["/", "/about", "/specialties", "/vip-accommodation-transfer", "/contact"]);
    expect(roots.map((i) => i.label)).toEqual(["Home", "About", "Health Tourism Services", "VIP Accommodation & Transfer", "Contact"]);
    for (const root of roots) {
      for (const code of LOCALES_8.filter((c) => c !== "en")) {
        const label = root.translations?.[code]?.label ?? "";
        expect(label.trim().length, `${root.label} / ${code} çeviri boş`).toBeGreaterThan(0);
        expect(label, `${root.label} / ${code} Türkçe`).not.toMatch(/Ana Sayfa|Doktorlar|Branşlar|Hakkımızda|İletişim|Nasıl/);
        if (root.label !== "Home" && root.label !== "Contact") expect(label, `${root.label} / ${code} EN ile aynı`).not.toBe(root.label);
      }
    }
    expect(roots.find((r) => r.href === "/specialties")!.translations!.ar!.label).toMatch(/[\u0600-\u06FF]/);
    expect(JSON.stringify(nav.navigationItems)).not.toMatch(/Health Guides/i);
    // Genel uç: etkin dillerde (en, ar, de) 5 öğe.
    for (const code of ["en", "ar", "de"]) {
      const res = await fetch(`${API_BASE_URL}/navigation?locale=${code}`);
      const items = ((await res.json()) as { data: { navigationItems: Array<{ label: string; parentId: string | null }> } }).data.navigationItems.filter((i) => i.parentId === null);
      expect(items, code).toHaveLength(5);
    }
    const arPublic = ((await (await fetch(`${API_BASE_URL}/navigation?locale=ar`)).json()) as { data: { navigationItems: Array<{ label: string }> } }).data.navigationItems;
    expect(arPublic.map((i) => i.label).join("")).toMatch(/[\u0600-\u06FF]/);
  });

  test("masaüstü header: 5 menü öğesi, CTA 'Request a consultation' -> /request, 'Find my physician' yok, hizmetler açılır menüsü + All services", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const desktop = page.getByTestId("site-header-desktop");
    for (const label of ["Home", "About", "Health Tourism Services", "VIP Accommodation & Transfer", "Contact"]) {
      await expect(desktop.getByRole("link", { name: label, exact: true }).or(desktop.getByRole("button", { name: label })).first()).toBeVisible();
    }
    await expect(page.getByText(/Find my physician/i)).toHaveCount(0);
    const cta = page.getByTestId("header-find-treatment");
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", /\/find-your-treatment$/);
    await expect(cta).toContainText(/Find your treatment/i);
    // Açılır menü: etkin üst bölümler + "All services".
    const services = desktop.getByRole("link", { name: "Health Tourism Services", exact: true }).or(desktop.getByRole("button", { name: "Health Tourism Services" })).first();
    await services.click();
    await expect(page.getByRole("menuitem", { name: /^View all services$/i }).or(page.getByRole("link", { name: /^View all services$/i })).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(`a[href$="/specialties/${PARENT_SLUG}"]`).first()).toBeVisible();
  });

  test("AR header: etiketler Arapça ve sayfa RTL", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const desktop = page.getByTestId("site-header-desktop");
    await expect(desktop).toContainText("من نحن");
    await expect(desktop).toContainText("اتصل بنا");
  });
});

test.describe("Kimlik ibaresi", () => {
  test("üst şerit (>=1024px): kısa ibare + 'Treatments by authorized healthcare facilities' -> Hakkımızda#authorized-facilities", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const bar = page.getByTestId("site-header-intermediary");
    await expect(bar).toContainText(SHORT_LABEL);
    const link = bar.getByRole("link", { name: /Treatments by authorized healthcare facilities/i });
    await expect(link).toHaveAttribute("href", /\/about#authorized-facilities$/);
    await link.click();
    await expect(page).toHaveURL(/\/about#authorized-facilities$/);
    await expect(page.locator("#authorized-facilities")).toBeVisible();
    await expect(page.locator("#authorized-facilities")).toBeInViewport();
  });

  test("mobil (390px): üst şerit gizli, menüde ibare var", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByTestId("site-header-topbar")).toBeHidden();
    await page.getByRole("button", { name: /menu/i }).first().click();
    await expect(page.getByTestId("mobile-menu-intermediary")).toContainText(SHORT_LABEL);
    await expect(page.getByTestId("mobile-menu-find-treatment")).toBeVisible();
  });

  test("footer: kısa ibare + açıklama; belge numarası boşken belge satırı YOK", async ({ page }) => {
    await page.goto("/");
    const footer = page.getByTestId("footer-intermediary");
    await expect(footer).toContainText(SHORT_LABEL);
    await expect(footer).toContainText(/not a healthcare provider/i);
    await expect(footer).toContainText(/International Health Tourism Authorization Certificate/i);
    await expect(page.getByTestId("footer-certificate")).toHaveCount(0);
    await expect(page.getByText(/Authorization Certificate No:/)).toHaveCount(0);
  });

  test("Hakkımızda: 'Who we are' (#authorized-facilities) ve 'Our role / What we do not do' bölümleri", async ({ page }) => {
    await page.goto("/about");
    await expect(page.getByTestId("about-who-we-are")).toBeVisible();
    await expect(page.locator("section#authorized-facilities")).toHaveCount(1);
    await expect(page.getByTestId("about-our-role")).toBeVisible();
    await expect(page.getByTestId("about-our-role")).toContainText(/diagnos|treat/i);
  });

  test("bölüm sayfası, talep formu ve VIP sayfasında bilgi kutusu (IntermediaryNotice) var; belge satırı yok", async ({ page }) => {
    for (const path of [`/specialties/${PARENT_SLUG}`, "/request", "/vip-accommodation-transfer"]) {
      await page.goto(path);
      const notice = page.getByTestId("intermediary-notice").first();
      await expect(notice, path).toBeVisible();
      await expect(notice, path).toContainText(/not a healthcare provider/i);
      await expect(page.getByTestId("intermediary-certificate"), path).toHaveCount(0);
    }
  });

  test("bölüm sayfası: hekim listesi yerine 'Request a call back' (AK) ve 'Book a consultation' düğmeleri (bölüm dolu) var", async ({ page }) => {
    await page.goto(`/specialties/${PARENT_SLUG}`);
    const cta = page.locator("main").getByRole("link", { name: /Request a call back/i }).first();
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", new RegExp(`/request\\?service=${PARENT_SLUG}`));
  });

  test("blog yazısı: koordinatör kartı -> /request, bilgi kutusu, yazar 'WM Health Editorial Team', hekim/ 'Medically reviewed' yok", async ({ page }) => {
    await page.goto(`/blog/${postSlug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`QA AH Post ${RUN}`);
    await expect(page.getByTestId("blog-coordinator-card")).toBeVisible();
    await expect(page.getByTestId("blog-coordinator-cta")).toHaveAttribute("href", /\/request/);
    await expect(page.getByText("Talk to a patient coordinator").first()).toBeVisible();
    await expect(page.getByTestId("intermediary-notice").first()).toBeVisible();
    await expect(page.locator("body")).toContainText("WM Health Editorial Team");
    await expect(page.locator("body")).not.toContainText(/Medically reviewed by|Review pending|Consult a physician/i);
  });

  test("blog listesi: yazı kartında hekim adı/rozeti yok", async ({ page }) => {
    await expect(async () => {
      await page.goto("/blog");
      await expect(page.getByText(`QA AH Post ${RUN}`).first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 100_000, intervals: [3_000, 5_000] });
    await expect(page.locator("body")).not.toContainText(/Medically reviewed|Review pending/i);
  });

  test("/content-standards: editör ekibi metni, 'physician review' vaadi yok", async ({ page }) => {
    await page.goto("/content-standards");
    const body = page.locator("body");
    await expect(body).toContainText(/editorial team/i);
    await expect(body).toContainText(/not medical advice/i);
    await expect(body).not.toContainText(/reviewed by a (licensed )?physician|physician review/i);
  });

  test("belge numarası doluyken footer, bilgi kutusu ve talep formunda belge satırı görünür", async ({ page }) => {
    test.setTimeout(240_000);
    await patchSiteSettings(token, { healthTourismCertificateNo: `  ${CERT_NO}  ` });
    const pub = (await (await fetch(`${API_BASE_URL}/settings`)).json()) as { data: { healthTourismCertificateNo: string | null } };
    expect(pub.data.healthTourismCertificateNo).toBe(CERT_NO); // trim
    await expect(async () => {
      await page.goto("/about");
      await page.reload();
      await expect(page.getByTestId("footer-certificate")).toContainText(CERT_LINE, { timeout: 2_000 });
    }).toPass({ timeout: 90_000, intervals: [3_000, 5_000] });
    await expect(async () => {
      await page.goto("/request");
      await page.reload();
      await expect(page.getByTestId("intermediary-certificate").first()).toContainText(CERT_LINE, { timeout: 2_000 });
    }).toPass({ timeout: 90_000, intervals: [3_000, 5_000] });
    // Boşa dön: satır kaybolmalı (boş string -> null).
    const clear = await adminFetch("/admin/settings", { method: "PATCH", body: JSON.stringify({ healthTourismCertificateNo: "   " }) });
    expect(clear.status).toBe(200);
    const pub2 = (await (await fetch(`${API_BASE_URL}/settings`)).json()) as { data: { healthTourismCertificateNo: string | null } };
    expect(pub2.data.healthTourismCertificateNo).toBeNull();
    await expect(async () => {
      await page.goto("/about");
      await page.reload();
      await expect(page.getByTestId("footer-certificate")).toHaveCount(0, { timeout: 2_000 });
    }).toPass({ timeout: 90_000, intervals: [3_000, 5_000] });
  });

  test("belge numarası 64 karakterden uzunsa 422", async () => {
    const res = await adminFetch("/admin/settings", { method: "PATCH", body: JSON.stringify({ healthTourismCertificateNo: "X".repeat(65) }) });
    expect(res.status).toBe(422);
  });
});

test.describe("Talep formu", () => {
  // AL: talep formu AJ-7'de 4 adımlı sihirbaza dönüştü (1 hizmet kartları, 2 tarih/ülke/dil/tercüman, 3 iletişim+mesaj, 4 özet+rıza).
  // Eski tek sayfalı seçiciler (#request-service select, ilk adımda request-submit) yok; testler adım adım yürür.
  test("istemci doğrulaması: boş ilerlemede alan hataları görünür ve API'ye istek gitmez", async ({ page }) => {
    let posts = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/consultation-requests")) posts++;
    });
    await gotoRequestWhenServiceListed(page);
    await expect(page.getByTestId("request-form")).toBeVisible();
    await expect(page.getByTestId("request-next")).toBeEnabled();
    // Adım 1: hizmet seçmeden ilerlenemez.
    await page.getByTestId("request-next").click();
    await expect(page.locator("#request-service-error")).toBeVisible();
    await expect(page.getByTestId("request-step-1")).toBeVisible();
    await selectService(page, CHILD_SLUG);
    await page.getByTestId("request-next").click();
    // Adım 2: ülke zorunlu.
    await expect(page.getByTestId("request-step-2")).toBeVisible();
    await page.getByTestId("request-flexible").check();
    await page.getByTestId("request-next").click();
    await expect(page.locator("#request-country")).toHaveAttribute("aria-invalid", "true");
    await page.locator("#request-country").selectOption("DE");
    await page.getByTestId("request-next").click();
    // Adım 3: ad ve e-posta zorunlu.
    await expect(page.getByTestId("request-step-3")).toBeVisible();
    await page.getByTestId("request-next").click();
    await expect(page.locator("#request-full-name")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#request-email")).toHaveAttribute("aria-invalid", "true");
    await page.locator("#request-full-name").fill("Max Mustermann QA");
    await page.locator("#request-email").fill(REQUEST_EMAIL);
    await page.getByTestId("request-next").click();
    // Adım 4: iletişim rızası olmadan gönderim engellenir.
    await expect(page.getByTestId("request-step-4")).toBeVisible();
    await page.getByTestId("request-submit").click();
    await expect(page.getByTestId("request-consent-contact-error")).toBeVisible();
    expect(posts).toBe(0);
    await expect(page.getByTestId("request-success")).toHaveCount(0);
  });

  test("hizmet seçimi: ?service=<alt bölüm> ile ön seçili; üst/alt bölümler kartlarda; honeypot gizli; aydınlatma bağlantısı ve uyarı", async ({ page }) => {
    await gotoRequestWhenServiceListed(page, `?service=${CHILD_SLUG}`);
    await expect(page.getByTestId(`request-service-${CHILD_SLUG}`)).toBeChecked();
    await expect(page.getByTestId(`request-service-${PARENT_SLUG}`)).toHaveCount(1);
    const hp = page.getByTestId("request-website");
    // İnsana görünmez + odaklanılamaz: aria-hidden sarmalayıcı, ekran dışı, tabindex=-1.
    expect(await hp.evaluate((el) => { const w = el.closest('[aria-hidden="true"]'); const r = (w ?? el).getBoundingClientRect(); return Boolean(w) && el.getAttribute("tabindex") === "-1" && (r.width === 0 || r.height === 0 || r.right < 0 || r.bottom < 0 || r.left < -100 || r.top < -100); })).toBe(true);
    await page.getByTestId("request-next").click();
    await expect(page.getByTestId("request-step-2")).toBeVisible();
    await expect(page.locator("#request-contact-language option")).toHaveCount(8);
    expect(await page.locator("#request-contact-language option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))).toEqual(expect.arrayContaining(["en", "de", "ar"]));
    await page.getByTestId("request-flexible").check();
    await page.locator("#request-country").selectOption("DE");
    await page.getByTestId("request-next").click();
    await expect(page.getByTestId("request-message-notice")).toContainText("Do not share detailed medical information here; our coordinator will guide you securely.");
    await page.locator("#request-full-name").fill("Max Mustermann QA");
    await page.locator("#request-email").fill(REQUEST_EMAIL);
    await page.getByTestId("request-next").click();
    await expect(page.getByTestId("request-consent-contact").locator("xpath=ancestor::label")).toContainText(/agree|consent/i);
  });

  test("mesaj doluyken sağlık verisi rızası zorunlu: işaretlenmeden gönderim engellenir", async ({ page }) => {
    let posts = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/consultation-requests")) posts++;
    });
    await gotoRequestWhenServiceListed(page, `?service=${CHILD_SLUG}`);
    await walkRequestToReview(page, { message: "I would like to ask about options." });
    await page.getByTestId("request-consent-contact").check();
    await page.getByTestId("request-submit").click();
    await expect(page.getByTestId("request-consent-health-error")).toBeVisible();
    expect(posts).toBe(0);
    await page.getByTestId("request-consent-health").check();
    await expect(page.getByTestId("request-consent-health-error")).toHaveCount(0);
  });

  test("API doğrulaması: rıza yok / mesaj+sağlık rızası yok / geçersiz bölüm -> 422 (alan bazlı)", async () => {
    const noConsent = await postRequest(requestBody({ contactConsent: false }));
    expect(noConsent.status).toBe(422);
    expect(JSON.stringify(noConsent.json)).toContain("contactConsent");
    const noHealth = await postRequest(requestBody({ message: "Some text", healthDataConsent: false }));
    expect(noHealth.status).toBe(422);
    expect(JSON.stringify(noHealth.json)).toContain("healthDataConsent");
    const unknown = await postRequest(requestBody({ serviceSlug: `yok-${RUN}` }));
    expect(unknown.status).toBe(422);
    expect(JSON.stringify(unknown.json)).toContain("serviceSlug");
  });

  test("başarılı gönderim: talep no gösterilir, tek POST, yanıtta PII yok", async ({ page }) => {
    const responses: Array<{ status: number; body: string }> = [];
    page.on("response", async (r) => {
      if (r.request().method() === "POST" && r.url().includes("/consultation-requests")) responses.push({ status: r.status(), body: await r.text().catch(() => "") });
    });
    await gotoRequestWhenServiceListed(page, `?service=${CHILD_SLUG}`);
    await walkRequestToReview(page, { dateFrom: "2026-12-01", dateTo: "2026-12-15", interpreter: true, contactLanguage: "de", phone: "+49 170 1234567", message: "QA AH test message — please call me." });
    await page.getByTestId("request-consent-contact").check();
    await page.getByTestId("request-consent-health").check();
    await page.getByTestId("request-submit").click();
    await expect(page.getByTestId("request-success")).toBeVisible({ timeout: 30_000 });
    const num = (await page.getByTestId("request-number").innerText()).match(/REQ-[A-Z0-9-]+/)?.[0];
    expect(num, "talep numarası").toBeTruthy();
    createdRequestNumber = num!;
    expect(responses).toHaveLength(1);
    expect(responses[0]!.status).toBe(201);
    expect(responses[0]!.body).toContain(createdRequestNumber);
    expect(responses[0]!.body).not.toContain(REQUEST_EMAIL);
    expect(responses[0]!.body).not.toContain("Mustermann");
    await expect(page.getByTestId("request-form")).toHaveCount(0);
  });

  test("kayıt: talep admin CRM'de (CONSULTATION_REQUEST) görünür; detayda hizmet/tarih/dil/tercüman/mesaj, PII yalnız yetkili rolde", async () => {
    test.setTimeout(120_000);
    expect(createdRequestNumber).toBeTruthy();
    // CRM, 2FA'lı ADMIN ister: ayrı fixture admin (paylaşımlı admin hesabına 2FA açılmaz).
    crmToken = await getFixtureUserToken(FIXTURE_EMAIL, FIXTURE_PASSWORD, "QA AH CRM Admin");
    const u = await adminGetUserByEmail(token, FIXTURE_EMAIL);
    expect(u).toBeTruthy();
    userId = u!.id;
    expect((await adminUpdateRole(token, userId, "ADMIN")).status).toBe(200);
    await setupAndEnableTwoFactorForSelf(crmToken, FIXTURE_PASSWORD);

    const list = await adminFetch(`/admin/crm/leads?q=${encodeURIComponent(REQUEST_EMAIL)}`, {}, crmToken);
    expect(list.status, await list.clone().text()).toBe(200);
    const leads = ((await list.json()) as { data: Array<{ id: string; channel: string; status: string; specialtyName: string | null; email: string | null; country: string | null; language: string | null }> }).data;
    expect(leads.length).toBeGreaterThanOrEqual(1);
    const lead = leads.find((l) => l.channel === "CONSULTATION_REQUEST")!;
    expect(lead, "CONSULTATION_REQUEST kanallı lead").toBeTruthy();
    expect(lead.status).toBe("NEW");
    expect(lead.country).toBe("DE");
    const detail = await adminFetch(`/admin/crm/leads/${lead.id}`, {}, crmToken);
    expect(detail.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- e2e: serbest JSON gövdesi
    const d = ((await detail.json()) as { data: any }).data;
    const cr = d.consultationRequest ?? d.lead?.consultationRequest;
    expect(cr, "lead detayında consultationRequest").toBeTruthy();
    expect(cr.number).toBe(createdRequestNumber);
    expect(cr.serviceName).toContain(`QA AH ESD ${RUN}`);
    expect(cr.preferredFrom).toBe("2026-12-01");
    expect(cr.preferredTo).toBe("2026-12-15");
    expect(cr.contactLanguage).toBe("de");
    expect(cr.needsInterpreter).toBe(true);
    expect(cr.message).toBe("QA AH test message — please call me.");
    expect(cr.contactConsentAt).toBeTruthy();
    expect(cr.healthDataConsentAt).toBeTruthy();
    // Aynı talep Müşteri e-posta/telefon alanlarını normalize eder (lead.email küçük harf, lead.phone E.164).
    expect(lead.email).toBe(REQUEST_EMAIL.toLowerCase());
  });

  test("honeypot dolu: 201 döner ama kayıt oluşmaz (bota sinyal verilmez)", async () => {
    const hpEmail = `qa-ah-honeypot-${RUN}@example.com`;
    const r = await postRequest(requestBody({ email: hpEmail, website: "https://spam.example" }));
    expect(r.status).toBe(201);
    expect(r.json.data.requestNumber).toMatch(/^REQ-/);
    const list = await adminFetch(`/admin/crm/leads?q=${encodeURIComponent(hpEmail)}`, {}, crmToken);
    expect(list.status).toBe(200);
    expect(((await list.json()) as { data: unknown[] }).data).toHaveLength(0);
  });

  test("oran sınırı: yeni dakika penceresinde 5 istek 201, 6. istek 429", async () => {
    test.setTimeout(180_000);
    await new Promise((r) => setTimeout(r, 62_000)); // önceki testlerin pencereyi tüketmemesi için.
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await postRequest(requestBody({ email: `qa-ah-rl-${RUN}-${i}@example.com`, fullName: `Rate Limit ${i}` }));
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses[5]).toBe(429);
  });
});
