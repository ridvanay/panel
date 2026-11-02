import path from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { API_BASE_URL, getCachedAdminSession, getFixtureUserToken, nextTotpCode, setupAndEnableTwoFactorForSelf } from "./support/api";
import { adminGetUserByEmail, adminUpdateRole, adminUpdateStatus } from "./support/admin-users-fixtures";
import { createCategory, createPost, deleteCategory, deletePostPermanently } from "./support/blog-z1-fixtures";
import { assertAiState, deactivateNonAiSpecialties, ensureTopicServiceLinks, pickTopicBySearch, reactivateSpecialties, walkWizardToResult } from "./support/ai-services-fixtures";

/**
 * qa-agent — Paket AJ ekran görüntüleri + AJ-9 görsel kalite turu (EN + AR).
 * Yalnızca `AJ_SHOTS=1` ile koşar. Çıktı: docs/prompts/2026-11-02-AJ-ekran/ (ana, 1440 + 390) ve
 * docs/prompts/2026-11-02-AJ-ekran/kalite-turu/ (matris: 1440/1280/1024/768/390 + bulgular.json).
 * Yalnızca okur ve ölçer; uygulama kodunu DEĞİŞTİRMEZ. Eski fixture uzmanlıkları yalnızca süre boyunca pasife alınır, sonda geri açılır.
 * Ölçümler: yatay taşma, kesik metin adayı, mor/indigo kalıntı, AJ-9 yasak ifadeler, ziyaretçiye doktor ifadesi, Türkçe harf.
 */
test.skip(process.env.AJ_SHOTS !== "1", "AJ_SHOTS=1 ile koşar");
test.use({ navigationTimeout: 120_000, actionTimeout: 20_000 });
test.describe.configure({ mode: "serial" });

const OUT = path.resolve(__dirname, "../../../docs/prompts/2026-11-02-AJ-ekran");
const MATRIX = path.join(OUT, "kalite-turu");
const LANGS = [
  { code: "en", prefix: "" },
  { code: "ar", prefix: "/ar" },
] as const;
const WIDTHS = [1440, 1280, 1024, 768, 390] as const;
const SECTION = "surgical-oncology";

let token = "";
let deactivated: string[] = [];
let blogSlug = "";
let categoryId = "";
let postId = "";
let supportBefore: { supportLanguages: string[]; supportHours: Record<string, string>; interpreterIncluded: boolean } | null = null;
const RUN = Date.now().toString(36);
const POST_SLUG = `what-to-prepare-before-treatment-${RUN}`;
const CRM_EMAIL = `qa-aj-crm-${RUN}@example.com`;
const CRM_PASSWORD = "Zx9!Lantern-Orbit-742";
const SUPPORT_LANGS = ["en", "ar", "de", "fr", "ru", "es", "ro", "sr"];

async function api(pathname: string, init: RequestInit = {}) {
  return fetch(`${API_BASE_URL}${pathname}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
}

interface Finding {
  lang: string;
  width: number;
  page: string;
  kind: string;
  detail: string;
}
interface Row {
  lang: string;
  width: number;
  page: string;
  overflow: boolean;
  scrollWidth: number;
  clientWidth: number;
  status: number;
  file: string;
}
const findings: Finding[] = [];
const rows: Row[] = [];

test.beforeAll(async () => {
  test.setTimeout(240_000);
  mkdirSync(MATRIX, { recursive: true });
  token = (await getCachedAdminSession()).accessToken;
  await assertAiState();
  await ensureTopicServiceLinks(token);
  deactivated = await deactivateNonAiSpecialties(token);
  // Koordinatör bandı destek dili seçiliyken görünür: süre boyunca 8 dil + tercüman açılır, sonda geri alınır.
  const th = (await (await fetch(`${API_BASE_URL}/telehealth/theme`)).json()) as { data: { languageSupport: NonNullable<typeof supportBefore> } };
  supportBefore = th.data.languageSupport;
  await api("/admin/telehealth/settings/language-support", { method: "PATCH", body: JSON.stringify({ supportLanguages: SUPPORT_LANGS, supportHours: { en: "Mon–Sat 09:00–21:00 (GMT+3)" }, interpreterIncluded: true }) });
  // Blog yazısı (saas_e2e'de yayımlı yazı yoksa) geçici fixture.
  const cat = await createCategory(token, { name: "Planning your trip", slug: `planning-your-trip-${RUN}`, isMedical: false, translations: { ar: { name: "تخطيط رحلتك" } } });
  categoryId = cat.id;
  const post = await createPost(token, {
    title: "What to prepare before travelling for treatment",
    slug: POST_SLUG,
    excerpt: "A practical checklist for international patients planning treatment in Türkiye.",
    contentHtml: "<p>Planning treatment abroad involves more than choosing a service. This guide lists the practical points that international patients usually ask about before they travel.</p><h2>Documents</h2><p>Keep a valid passport and a list of the medicines you currently take.</p>",
    categoryId,
    status: "PUBLISHED",
    medicalReviewStatus: "not_required",
    translations: { ar: { title: "ما الذي تحضّره قبل السفر للعلاج", excerpt: "قائمة عملية للمرضى الدوليين.", contentHtml: "<p>لا يقتصر التخطيط للعلاج في الخارج على اختيار الخدمة.</p><h2>المستندات</h2><p>احتفظ بجواز سفر ساري.</p>" } },
  } as Parameters<typeof createPost>[1]);
  postId = post.id;
  blogSlug = POST_SLUG;
});

test.afterAll(async () => {
  test.setTimeout(240_000);
  token = (await getCachedAdminSession()).accessToken; // koşu 15 dk erişim token'ı süresini aşar
  await reactivateSpecialties(token, deactivated);
  if (supportBefore) {
    const clearHours = Object.fromEntries(Object.keys({ en: 1 }).map((k) => [k, supportBefore!.supportHours[k] ?? null]));
    await api("/admin/telehealth/settings/language-support", { method: "PATCH", body: JSON.stringify({ supportLanguages: supportBefore.supportLanguages, supportHours: clearHours, interpreterIncluded: supportBefore.interpreterIncluded }) }).catch(() => undefined);
  }
  if (postId) await deletePostPermanently(token, postId).catch(() => undefined);
  if (categoryId) await deleteCategory(token, categoryId).catch(() => undefined);
  // Kısmi koşuların (-g) önceki ölçümleri silmemesi için mevcut dosyayla birleştirilir (aynı dil/genişlik/sayfa anahtarı yenilenir).
  const file = path.join(MATRIX, "bulgular.json");
  let prev: { rows: Row[]; findings: Finding[] } = { rows: [], findings: [] };
  try {
    prev = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    /* ilk koşu */
  }
  const key = (x: { lang: string; width: number; page: string }) => `${x.lang}|${x.width}|${x.page}`;
  const fresh = new Set([...rows.map(key), ...findings.map(key)]);
  writeFileSync(
    file,
    JSON.stringify({ rows: [...prev.rows.filter((r) => !fresh.has(key(r))), ...rows], findings: [...prev.findings.filter((f) => !fresh.has(key(f))), ...findings] }, null, 2)
  );
});

async function prepare(context: BrowserContext) {
  // Kaspersky enjeksiyonu LCP/yerleşimi bozar; yerel medya URL'leri 3100'de 404 olabilir -> 4001'e yönlendir.
  await context.route(/kaspersky-labs\.com/, (r) => r.abort());
  await context.route(/\/uploads\//, async (route) => {
    const u = new URL(route.request().url());
    try {
      await route.fulfill({ response: await route.fetch({ url: `http://localhost:4001${u.pathname}${u.search}` }) });
    } catch {
      await route.continue();
    }
  });
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  await page.waitForTimeout(500);
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ["uydurma-istatistik", /\b\d[\d.,]*\s?\+?\s*(patients|happy|years of|hospitals|procedures|clients|مريض|عام)\b/i],
  ["akreditasyon/odul", /\b(JCI|ISO\s?\d{4,5}|award[- ]winning|accredited by|certified by)\b/i],
  ["hastane/klinik/doktor iddiasi", /\b(our|my) (doctors|physicians|hospitals?|clinics?|surgeons)\b|أطباؤنا|مستشفانا|عيادتنا/i],
  ["garanti", /\bguarantee[sd]?\b|\bmoney[- ]back\b|نضمن|ضمان/i],
  ["fiyat", /[€$₺£]\s?\d|\b\d[\d.,]*\s?(USD|EUR|TL|TRY)\b|\bstarting (from|at)\b|\bfrom\s?[€$£]/i],
  ["doktor-ifadesi", /\b(doctors?|physicians?|Dr\.|Prof\.|Consult Physicians|Find a physician)\b|طبيب|أطباء|الأطباء|دكتور/i],
];

/** Sayfada ölçüm: taşma, kesik metin adayları, mor kalıntı, yasak ifadeler. */
async function measure(page: Page, lang: string, width: number, name: string, status: number, file: string) {
  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const vw = window.innerWidth;
    const desc = (el: Element) => {
      const h = el as HTMLElement;
      const tid = h.getAttribute("data-testid");
      return `${el.tagName.toLowerCase()}${tid ? `[${tid}]` : ""}${typeof h.className === "string" && h.className ? "." + h.className.split(/\s+/).slice(0, 3).join(".") : ""}`;
    };
    const offenders: string[] = [];
    const clipped: string[] = [];
    const purple: string[] = [];
    const PURPLES = ["rgb(79, 70, 229)", "rgb(124, 58, 237)"];
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const h = el as HTMLElement;
      const cs = getComputedStyle(h);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = h.getBoundingClientRect();
      if (r.width > 0 && (r.right > vw + 1 || r.left < -1) && cs.position !== "fixed" && offenders.length < 6 && !h.closest("[aria-hidden='true']")) {
        // üst öğe zaten kırpıyorsa (overflow hidden/auto) görsel taşma değildir
        let p = h.parentElement;
        let clippedByParent = false;
        while (p && p !== document.body) {
          const o = getComputedStyle(p).overflowX;
          if (o === "hidden" || o === "auto" || o === "scroll" || o === "clip") {
            clippedByParent = true;
            break;
          }
          p = p.parentElement;
        }
        if (!clippedByParent) offenders.push(`${desc(el)} sağ=${Math.round(r.right)} sol=${Math.round(r.left)}`);
      }
      const srOnly = /sr-only|-start-\[|-left-\[/.test(typeof h.className === "string" ? h.className : "") || !!h.closest(".sr-only");
      if (!srOnly && (cs.overflow === "hidden" || cs.overflowX === "hidden" || cs.textOverflow === "ellipsis") && h.scrollWidth > h.clientWidth + 1 && (h.textContent ?? "").trim().length > 0 && clipped.length < 6) {
        clipped.push(`${desc(el)} "${(h.textContent ?? "").trim().slice(0, 50)}" sw=${h.scrollWidth} cw=${h.clientWidth}`);
      }
      if (purple.length < 6) {
        for (const prop of ["color", "backgroundColor", "borderTopColor", "outlineColor", "fill", "stroke"] as const) {
          const v = cs[prop];
          if (v && PURPLES.some((p) => v.startsWith(p))) {
            purple.push(`${desc(el)} ${prop}=${v}`);
            break;
          }
        }
      }
    }
    const lowText = document.body.innerText;
    return { sw: de.scrollWidth, cw: de.clientWidth, offenders, clipped, purple, text: lowText };
  });
  rows.push({ lang, width, page: name, overflow: m.sw > m.cw, scrollWidth: m.sw, clientWidth: m.cw, status, file });
  const add = (kind: string, detail: string) => findings.push({ lang, width, page: name, kind, detail });
  if (m.sw > m.cw) add("yatay-tasma", `scrollWidth=${m.sw} clientWidth=${m.cw}; ${m.offenders.join(" | ")}`);
  else if (m.offenders.length) add("tasan-oge-kirpilmamis", m.offenders.join(" | "));
  for (const c of m.clipped) add("kesik-metin-adayi", c);
  for (const p of m.purple) add("mor-indigo-kalinti", p);
  for (const [label, re] of FORBIDDEN) {
    const hit = m.text.match(re);
    if (hit) {
      const i = hit.index ?? 0;
      add(`yasak:${label}`, `"${m.text.slice(Math.max(0, i - 40), i + 70).replace(/\s+/g, " ")}"`);
    }
  }
  if (lang === "en") {
    const cleaned = m.text.replace(/T[üu]rkiye/gi, "");
    const tr = cleaned.match(/[ıİşŞğĞ]/g);
    if (tr) add("turkce-harf", `${tr.length} adet; örn: ${cleaned.slice(Math.max(0, cleaned.search(/[ıİşŞğĞ]/) - 30), cleaned.search(/[ıİşŞğĞ]/) + 40).replace(/\s+/g, " ")}`);
  }
}

async function walkRequest(page: Page, upTo: 1 | 2 | 3 | 4) {
  const next = page.getByTestId("request-next");
  if (upTo === 1) return;
  await next.click();
  await expect(page.getByTestId("request-step-2")).toBeVisible();
  if (upTo === 2) return;
  await page.getByTestId("request-flexible").check();
  await page.locator("#request-country").selectOption("DE");
  await next.click();
  await expect(page.getByTestId("request-step-3")).toBeVisible();
  if (upTo === 3) return;
  await page.locator("#request-full-name").fill("Sample Visitor");
  await page.locator("#request-email").fill("qa-aj-shot@example.com");
  await next.click();
  await expect(page.getByTestId("request-step-4")).toBeVisible();
}

interface PageDef {
  name: string;
  viewportOnly?: boolean;
  run: (page: Page, prefix: string) => Promise<number>;
}
async function go(page: Page, url: string): Promise<number> {
  const res = await page.goto(url);
  return res?.status() ?? 0;
}
const PAGES: PageDef[] = [
  { name: "01-ana-sayfa", run: (p, x) => go(p, x || "/") },
  {
    name: "02-request-adim1",
    run: async (p, x) => {
      const s = await go(p, `${x}/request?service=${SECTION}`);
      await expect(p.getByTestId("request-form")).toBeVisible();
      return s;
    },
  },
  {
    name: "03-request-adim4",
    run: async (p, x) => {
      const s = await go(p, `${x}/request?service=${SECTION}`);
      await expect(p.getByTestId("request-form")).toBeVisible();
      await walkRequest(p, 4);
      return s;
    },
  },
  { name: "04-vip", run: (p, x) => go(p, `${x}/vip-accommodation-transfer`) },
  { name: "05-specialties", run: (p, x) => go(p, `${x}/specialties`) },
  { name: "06-bolum-sayfasi", run: (p, x) => go(p, `${x}/specialties/${SECTION}`) },
  {
    name: "07-find-your-treatment",
    run: async (p, x) => {
      const s = await go(p, `${x}/find-your-treatment`);
      await expect(p.getByTestId("physician-matcher")).toBeVisible();
      return s;
    },
  },
  {
    name: "08-bolum-finder-modal",
    viewportOnly: true,
    run: async (p, x) => {
      const s = await go(p, `${x}/specialties/${SECTION}?finder=1`);
      await expect(p.getByTestId("matcher-dialog").or(p.getByTestId("matcher-modal")).first()).toBeVisible({ timeout: 30_000 });
      return s;
    },
  },
  { name: "09-about", run: (p, x) => go(p, `${x}/about`) },
  { name: "10-blog", run: (p, x) => go(p, `${x}/blog`) },
  {
    name: "11-blog-yazisi",
    run: async (p, x) => {
      if (!blogSlug) {
        await p.goto(`${x}/blog`);
        const hrefs = await p.locator("main a[href*='/blog/']").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
        const h = hrefs.find((u) => /\/blog\/[^/?#]+$/.test(u) && !/\/(category|tag|page)\b/.test(u));
        blogSlug = h ? h.replace(/^.*\/blog\//, "") : "";
      }
      if (!blogSlug) return 0; // yazı yok
      return go(p, `${x}/blog/${blogSlug}`);
    },
  },
  { name: "12-contact", run: (p, x) => go(p, `${x}/contact`) },
  { name: "13-content-standards", run: (p, x) => go(p, `${x}/content-standards`) },
  { name: "14-404", run: (p, x) => go(p, `${x}/aj-yok-boyle-bir-sayfa`) },
];

// ---- Kalite turu matrisi ----
for (const lang of LANGS) {
  for (const width of WIDTHS) {
    test(`matris ${lang.code} ${width}`, async ({ browser }) => {
      test.setTimeout(600_000);
      const context = await browser.newContext({ viewport: { width, height: width >= 1024 ? 900 : 844 }, baseURL: process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100" });
      await prepare(context);
      const page = await context.newPage();
      try {
        for (const def of PAGES.filter((d) => !process.env.AJ_ONLY || d.name.startsWith(process.env.AJ_ONLY))) {
          let status = 0;
          try {
            status = await def.run(page, lang.prefix);
          } catch (e) {
            findings.push({ lang: lang.code, width, page: def.name, kind: "yapilamadi", detail: String(e).split("\n")[0].slice(0, 200) });
            continue;
          }
          await settle(page);
          if (def.name === "11-blog-yazisi" && status === 0) {
            findings.push({ lang: lang.code, width, page: def.name, kind: "yapilamadi", detail: "blog yazisi bulunamadi" });
            continue;
          }
          const file = `${lang.code}-${width}-${def.name}.png`;
          await page.screenshot({ path: path.join(MATRIX, file), fullPage: !def.viewportOnly });
          await measure(page, lang.code, width, def.name, status, file);
        }
      } finally {
        await context.close();
      }
    });
  }
}

// ---- Ana görüntüler: 1440 ve 390 ----
for (const lang of LANGS) {
  for (const dev of [
    { name: "masaustu", width: 1440, height: 900 },
    { name: "mobil", width: 390, height: 844 },
  ] as const) {
    test(`ana ${lang.code} ${dev.name}`, async ({ browser }) => {
      test.setTimeout(300_000);
      const context = await browser.newContext({ viewport: { width: dev.width, height: dev.height }, baseURL: process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100" });
      await prepare(context);
      const page = await context.newPage();
      const tag = `${lang.code}-${dev.name}`;
      const shot = async (name: string, fullPage: boolean) => {
        await settle(page);
        await page.screenshot({ path: path.join(OUT, `${tag}-${name}.png`), fullPage });
      };
      try {
        // Ana sayfa: üst şerit, koordinatör bandı, footer
        await page.goto(lang.prefix || "/");
        await shot("01-ana-sayfa-ust", false);
        await shot("02-ana-sayfa-tam", true);
        const band = page.getByTestId("support-languages-band").first();
        if (await band.count()) {
          await band.scrollIntoViewIfNeeded();
          await settle(page);
          await band.screenshot({ path: path.join(OUT, `${tag}-03-koordinator-bandi.png`) });
        } else {
          findings.push({ lang: lang.code, width: dev.width, page: "ana", kind: "yapilamadi", detail: "koordinator bandi testid bulunamadi (tam sayfa goruntusunde var)" });
        }
        const footer = page.locator("footer").first();
        await footer.scrollIntoViewIfNeeded();
        await settle(page);
        await footer.screenshot({ path: path.join(OUT, `${tag}-04-footer.png`) });

        // Talep: adım 1, 4, başarı
        await page.goto(`${lang.prefix}/request?service=${SECTION}`);
        await expect(page.getByTestId("request-form")).toBeVisible();
        await shot("05-talep-adim1", true);
        await walkRequest(page, 2);
        await shot("06-talep-adim2", true);
        await page.getByTestId("request-flexible").check();
        await page.locator("#request-country").selectOption("DE");
        await page.getByTestId("request-next").click();
        await page.locator("#request-full-name").fill("Sample Visitor");
        await page.locator("#request-email").fill(`qa-aj-shot-${tag}@example.com`);
        await shot("07-talep-adim3", true);
        await page.getByTestId("request-next").click();
        await expect(page.getByTestId("request-step-4")).toBeVisible();
        await shot("08-talep-adim4", true);
        await page.getByTestId("request-consent-contact").check();
        await page.getByTestId("request-consent-health").check().catch(() => undefined);
        await page.getByTestId("request-submit").click();
        await expect(page.getByTestId("request-success")).toBeVisible({ timeout: 30_000 });
        await shot("09-talep-basari", false);

        // Find your treatment modalı: başlangıç + sonuç (bölüm sayfası ?finder=1)
        await page.goto(`${lang.prefix}/specialties/${SECTION}?finder=1`);
        const dlg = page.getByTestId("matcher-dialog").or(page.getByTestId("matcher-modal")).first();
        await expect(dlg).toBeVisible({ timeout: 30_000 });
        await shot("10-finder-modal-baslangic", false);
        await pickTopicBySearch(page, "obesity", lang.code === "en" ? /Obesity \/ weight/i : /./);
        await walkWizardToResult(page);
        await shot("11-finder-modal-sonuc", false);
      } catch (e) {
        findings.push({ lang: lang.code, width: dev.width, page: "ana-goruntuler", kind: "yapilamadi", detail: String(e).split("\n")[0].slice(0, 240) });
        await page.screenshot({ path: path.join(OUT, `${tag}-HATA-son-durum.png`) }).catch(() => undefined);
      } finally {
        await context.close();
      }
    });
  }
}

// ---- Admin: Talepler listesi + detay (1440) ----
// CRM yalnızca ADMIN + 2FA'ya açıktır: ortak qa admin'in 2FA'sı AÇILMAZ (diğer spec'lerin girişini bozar); bu koşuya özel yeni bir ADMIN
// kullanıcı oluşturulur, 2FA'sı etkinleştirilir; sonda askıya alınır (veri silinmez).
test("admin /admin/crm/requests liste + detay 1440", async ({ browser }) => {
  test.setTimeout(240_000);
  token = (await getCachedAdminSession()).accessToken;
  const userToken = await getFixtureUserToken(CRM_EMAIL, CRM_PASSWORD, "QA AJ CRM Admin");
  const u = await adminGetUserByEmail(token, CRM_EMAIL);
  if (!u) throw new Error("CRM fixture kullanıcısı bulunamadı");
  await adminUpdateRole(token, u.id, "ADMIN");
  const { secret } = await setupAndEnableTwoFactorForSelf(userToken, CRM_PASSWORD);

  const context = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100", viewport: { width: 1440, height: 900 }, locale: "tr-TR" });
  const page = await context.newPage();
  try {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(CRM_EMAIL);
    await page.locator('input[type="password"]').fill(CRM_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.getByLabel(/Authenticator/).fill(await nextTotpCode(secret));
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((url) => url.pathname !== "/login", { timeout: 30_000 });
    await page.goto("/admin/crm/requests");
    await settle(page);
    await page.screenshot({ path: path.join(OUT, "admin-masaustu-01-talepler-liste.png"), fullPage: true });
    await measure(page, "tr-admin", 1440, "admin-crm-requests", 200, "admin-masaustu-01-talepler-liste.png");
    const link = page.locator("a[href*='/admin/crm/requests/']").first();
    if (await link.count()) {
      await link.click();
      await page.waitForURL(/\/admin\/crm\/requests\/[^/]+$/);
      await settle(page);
      await page.screenshot({ path: path.join(OUT, "admin-masaustu-02-talep-detay.png"), fullPage: true });
      await measure(page, "tr-admin", 1440, "admin-crm-request-detay", 200, "admin-masaustu-02-talep-detay.png");
    } else {
      findings.push({ lang: "admin", width: 1440, page: "admin-crm-request-detay", kind: "yapilamadi", detail: "listede talep baglantisi yok" });
    }
  } finally {
    await context.close();
    await adminUpdateStatus(token, u.id, "SUSPENDED" as never).catch(() => undefined);
  }
});
