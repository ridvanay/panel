import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { ensureLocaleEnabled, getCachedAdminSession } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";
import { assertAiState, deactivateNonAiSpecialties, reactivateSpecialties } from "./support/ai-services-fixtures";
import { DOCTOR_WORDS, TURKISH_CHARS, ensureDeskAndCoordinator, prepareContext, setBookingEnabled, settle } from "./support/ai3-service-fixtures";
import {
  ADDRESS,
  FIXTURE_PHONE,
  PACKAGE_SLUG,
  backupAkState,
  createTestPackage,
  deleteTestPackage,
  flushFrontendCache,
  homePageId,
  installLiveLikeContact,
  installLiveLikeHome,
  latestScriptBackup,
  querySql,
  resetScriptBackups,
  restoreAkState,
  runAkScript,
  setFlagsDirect,
} from "./support/ak-fixtures";

/**
 * qa-agent - Paket AK (musteri revizeleri) uctan uca testi + ekran goruntuleri. YALNIZCA saas_e2e.
 * Ana sayfa canliya benzer SERBEST bloklu bir fixture ile degistirilir (eski, doktor ifadeli metinler) ve sonda birebir geri yuklenir.
 * Ekran goruntuleri `docs/prompts/2026-11-04-AK-ekran/` altina yazilir; uygulama kodu DEGISTIRILMEZ.
 * ISR/ayar onbellegi 60 sn: ayar degisikligi sonrasi beklemeler toPass + reload ile yoklanir (sabit bekleme yok).
 */
test.use({ navigationTimeout: 120_000, actionTimeout: 20_000 });
test.describe.configure({ mode: "serial" });

const OUT = path.resolve(__dirname, "../../../docs/prompts/2026-11-04-AK-ekran");
const SERVICE_SLUG = "surgical-oncology";
const LANGS = [
  { code: "en", prefix: "" },
  { code: "ar", prefix: "/ar" },
] as const;
const WIDTHS = [1440, 390] as const;
const POLL = { timeout: 150_000, intervals: [2_000, 5_000, 10_000] };
const FIND_OR_BOOK_HREF = /find-your-treatment|\/book-consultation(?!\/manage)/;

let adminToken = "";
let deactivated: string[] = [];
let packageId = "";
const findings: Array<{ severity: string; lang: string; width: number; step: string; file: string; kind: string; detail: string }> = [];

function shotsEnabled(): boolean {
  return process.env.AK_SHOTS !== "0";
}

async function newVisitor(browser: Browser, width: number): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100",
    viewport: { width, height: width === 390 ? 844 : 900 },
    ...(width === 390 ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}),
  });
  await prepareContext(context);
  return { context, page: await context.newPage() };
}

/** Node `*.localhost` cozemez: 127.0.0.1'e baglanip Host basligini elle veririz (ai-services-menu.spec.ts ile ayni desen). */
function rawGetOnce(p: string): Promise<{ status: number; location: string | null }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: 3100, path: p, headers: { Host: "siteadi.localhost:3100" } }, (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0, location: (res.headers.location as string | undefined) ?? null }));
      })
      .on("error", reject);
  });
}

/** Dev sunucusu bellek esiginde yeniden basladiginda (ECONNRESET/ECONNREFUSED) birkac kez yeniden dener. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 6; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
  throw last;
}
const rawGet = (p: string) => withRetry(() => rawGetOnce(p));
const rawBody = (p: string) => withRetry(() => rawBodyOnce(p));

/** Govde dondurur (Node `*.localhost` cozemedigi icin 127.0.0.1 + Host basligi). */
function rawBodyOnce(p: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: 3100, path: p, headers: { Host: "siteadi.localhost:3100" } }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      })
      .on("error", reject);
  });
}

/** Site haritasi indeksi + tum alt haritalar tek metin. */
async function sitemapAll(): Promise<string> {
  const idx = (await rawBody("/sitemap.xml")).body;
  const locs = Array.from(idx.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => new URL(m[1]!).pathname);
  const parts = [idx];
  for (const l of locs) parts.push((await rawBody(l)).body);
  return parts.join("\n");
}

/** Taramadan once cikarilan MESRU ifadeler: adres (ozel isim), Turkiye, koordinator adi, arac kurulus feragat cumleleri (tesis hekimi). */
function scrub(text: string): string {
  return text
    .split(ADDRESS)
    .join("")
    .replace(/T[üu]rkiye/gi, "")
    .replace(/Ayşe K./g, "")
    .replace(/Medical decisions are made by the physician at the healthcare facility./gi, "")
    .replace(/القرارات الطبية يتخذها الطبيب في المنشأة الصحية./g, "")
    .replace(/This is not a medical examination[^.]*.[^.]*./gi, "");
}

/** Gorunen DOM'un HTML'i (script/RSC yukleri haric): gizli blok metni isaretlemede olmamali. */
async function markup(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("script, style, noscript").forEach((n) => n.remove());
    return clone.innerHTML;
  });
}

async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("select, script, style, noscript, [aria-hidden='true']").forEach((n) => n.remove());
    return (clone.textContent ?? "").replace(/\s+/g, " ");
  });
}

/** Gorunur / HTML'de bulunan Find ya da Book baglantilari (manage haric). */
async function findOrBookLinks(page: Page): Promise<string[]> {
  return page.evaluate((src) => {
    const re = new RegExp(src);
    return Array.from(document.querySelectorAll("a[href]"))
      .map((a) => a.getAttribute("href") ?? "")
      .filter((h) => re.test(h));
  }, FIND_OR_BOOK_HREF.source);
}

async function noOverflow(page: Page): Promise<{ sw: number; cw: number }> {
  return page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
}

/** Ekran goruntusu + olcum (yatay tasma, Turkce harf, doktor ifadesi). */
async function shot(
  page: Page,
  lang: string,
  width: number,
  step: string,
  name: string,
  opts: { visitor?: boolean; fullPage?: boolean; locator?: ReturnType<Page["locator"]> } = {}
): Promise<void> {
  if (!shotsEnabled()) return;
  fs.mkdirSync(OUT, { recursive: true });
  await settle(page);
  if (opts.fullPage !== false && !opts.locator) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
  }
  const file = `${lang}-${width}-${name}.png`;
  const target = path.join(OUT, file);
  if (opts.locator) await opts.locator.screenshot({ path: target });
  else await page.screenshot({ path: target, fullPage: opts.fullPage !== false });
  const m = await noOverflow(page);
  if (m.sw > m.cw + 1) findings.push({ severity: "orta", lang, width, step, file, kind: "yatay-tasma", detail: `scrollWidth=${m.sw} clientWidth=${m.cw}` });
  if (opts.visitor !== false) {
    const text = scrub(await visibleText(page));
    const tr = TURKISH_CHARS.exec(text);
    if (tr) findings.push({ severity: "yuksek", lang, width, step, file, kind: "turkce-harf", detail: (/.{0,30}[ıİğĞşŞçÇöÖüÜ].{0,30}/.exec(text) ?? [""])[0] });
    const dw = DOCTOR_WORDS.exec(text);
    if (dw) findings.push({ severity: "yuksek", lang, width, step, file, kind: "doktor-ifadesi", detail: (new RegExp(`.{0,30}${dw[0]}.{0,30}`).exec(text) ?? [dw[0]])[0] });
  }
}

/** Ayar degisikligi 60 sn icinde yansir: yeniden yukleyerek yoklar. */
async function poll(page: Page, url: string, check: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.goto(url);
    await check();
  }).toPass(POLL);
}

async function openMobileMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: /menu|القائمة|قائمة/i }).first().click();
  await expect(page.getByTestId("mobile-menu-intermediary").or(page.getByTestId("mobile-menu-language-row")).first()).toBeVisible({ timeout: 10_000 });
}

/** Panelde "Site ozellikleri" kartindan iki anahtari ayarlar ve Kaydet'e basar (gercek panel akisi). */
async function setFeaturesViaPanel(page: Page, find: boolean, book: boolean): Promise<void> {
  await page.goto("/admin/settings");
  const card = page.getByTestId("site-features-card");
  await expect(card).toBeVisible({ timeout: 90_000 });
  for (const [id, want] of [
    ["switch-find-treatment", find],
    ["switch-book-consultation", book],
  ] as const) {
    const sw = page.getByTestId(id);
    const on = (await sw.getAttribute("aria-checked")) === "true";
    if (on !== want) await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", String(want));
  }
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect
    .poll(() => querySql(`select "findTreatmentEnabled"::text || ',' || "bookConsultationCtaEnabled"::text from site_settings limit 1`), { timeout: 30_000 })
    .toBe(`${find},${book}`);
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  adminToken = (await getCachedAdminSession()).accessToken;
  await ensureLocaleEnabled(adminToken, "de", "German", "Deutsch"); // AL: spec /de yollarını sınar; taban hattında de etkin olmalı
  await assertAiState();
  backupAkState();
  await ensureDeskAndCoordinator(adminToken);
  await setBookingEnabled(adminToken, true);
  deactivated = await deactivateNonAiSpecialties(adminToken);
  installLiveLikeHome();
  installLiveLikeContact();
  setFlagsDirect(true, true);
  packageId = await createTestPackage(adminToken);
  await flushFrontendCache();
});

test.afterAll(async () => {
  test.setTimeout(240_000);
  try {
    adminToken = (await getCachedAdminSession()).accessToken;
    if (packageId) await deleteTestPackage(adminToken, packageId);
    await reactivateSpecialties(adminToken, deactivated);
    await setBookingEnabled(adminToken, true);
  } finally {
    restoreAkState();
    await flushFrontendCache();
  }
  if (shotsEnabled() && findings.length) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "bulgular.json"), JSON.stringify(findings, null, 2));
  }
});

// ===================================================================================================================
// (1) Anahtarlar ACIK (varsayilan): bugunku davranis
// ===================================================================================================================
for (const width of WIDTHS) {
  test(`(1) anahtarlar acik ${width}: header, mega menu, hizmet, paket, find/book sayfalari`, async ({ browser }) => {
    test.setTimeout(300_000);
    expect(querySql(`select "findTreatmentEnabled"::text || ',' || "bookConsultationCtaEnabled"::text from site_settings limit 1`)).toBe("true,true");
    const { context, page } = await newVisitor(browser, width);
    try {
      await page.goto("/");
      if (width === 1440) {
        await expect(page.getByTestId("header-find-treatment")).toBeVisible();
        await expect(page.getByTestId("header-book-consultation")).toBeVisible();
        // mega menu sag paneli
        await page.getByTestId("services-mega-trigger").click();
        await expect(page.getByTestId("services-mega-menu")).toBeVisible();
        const panel = page.getByTestId("services-mega-panel");
        await expect(panel.locator("a[href*='find-your-treatment']")).toHaveCount(1);
        await expect(panel.locator("a[href*='book-consultation']")).toHaveCount(1);
        await page.keyboard.press("Escape");
      } else {
        await openMobileMenu(page);
        await expect(page.getByTestId("mobile-menu-find-treatment")).toBeVisible();
        await expect(page.getByTestId("mobile-menu-book-consultation")).toBeVisible();
      }
      expect((await findOrBookLinks(page)).length).toBeGreaterThan(0);

      // Hizmet sayfasi: kart + bolum
      await page.goto("/specialties");
      await expect(page.getByTestId("service-card-book").first()).toBeVisible({ timeout: 60_000 });
      await page.goto(`/specialties/${SERVICE_SLUG}`);
      await expect(page.getByTestId("specialty-book-cta").first()).toBeVisible({ timeout: 60_000 });
      // Paket sayfasi
      await page.goto(`/packages/${PACKAGE_SLUG}`);
      await expect(page.getByTestId("package-book-cta")).toBeVisible({ timeout: 60_000 });

      // Find your treatment ve Book a consultation sayfalari erisilebilir
      // AL: dev sunucusunda ilk derleme/gezinme yarisinda goto bazen yanitsiz (null) donuyordu - yanit gelene dek yeniden denenir.
      await expect(async () => {
        const find = await page.goto("/find-your-treatment");
        expect(find?.status()).toBe(200);
      }).toPass({ timeout: 45_000 });
      expect(page.url()).toContain("/find-your-treatment");
      await expect(async () => {
        const book = await page.goto("/book-consultation");
        expect(book?.status()).toBe(200);
      }).toPass({ timeout: 45_000 });
      await expect(page.getByTestId("book-consultation-page").or(page.getByTestId("service-booking-wizard")).first()).toBeVisible({ timeout: 60_000 });
      expect(page.url()).toContain("/book-consultation");
      expect(await sitemapAll()).toContain("find-your-treatment");
    } finally {
      await context.close();
    }
  });
}

test("(1) ekran goruntuleri: ana sayfa ve header, anahtarlar ACIK (EN+AR, 1440+390)", async ({ browser }) => {
  test.setTimeout(420_000);
  for (const lang of LANGS) {
    for (const width of WIDTHS) {
      const { context, page } = await newVisitor(browser, width);
      try {
        await page.goto(`${lang.prefix}/`);
        await expect(page.locator("header").first()).toBeVisible({ timeout: 60_000 });
        if (width === 1440) await expect(page.getByTestId("header-find-treatment")).toBeVisible();
        await shot(page, lang.code, width, "Ana sayfa (acik)", "01-ana-sayfa-acik", { visitor: false });
        await shot(page, lang.code, width, "Header (acik)", "03-header-acik", { visitor: false, fullPage: false, locator: page.locator("header").first() });
        if (width === 390) {
          await openMobileMenu(page);
          await shot(page, lang.code, width, "Mobil menu (acik)", "05-mobil-menu-acik", { visitor: false, fullPage: false });
        }
      } finally {
        await context.close();
      }
    }
  }
});

// ===================================================================================================================
// Script: kuru -> gercek (kaydet) -> sonuc kontrolleri -> tekrar (0) -> ... -> restore
// ===================================================================================================================
const OUT_SCRIPT = path.join(OUT, "script-ciktilari");
function saveScript(name: string, text: string): void {
  fs.mkdirSync(OUT_SCRIPT, { recursive: true });
  fs.writeFileSync(path.join(OUT_SCRIPT, name), text);
}
const blocksHash = () => querySql(`select md5(blocks::text || translations::text) from pages where id='${homePageId()}'`);
let preScriptHash = "";

test("script kuru calisma: yazmaz, her degisiklik 'eski -> yeni' listelenir", async () => {
  test.setTimeout(240_000);
  resetScriptBackups();
  preScriptHash = blocksHash();
  const contactBefore = querySql(`select md5("pageContent"::text) from contact_forms where id='singleton'`);
  const out = runAkScript(["--list"]);
  saveScript("01-list.txt", out);
  expect(out).toContain("th-trust-band");
  const dry = runAkScript([]);
  saveScript("02-kuru.txt", dry);
  expect(dry).toMatch(/→|->/);
  expect(dry).toMatch(/KURU|kuru/);
  expect(blocksHash()).toBe(preScriptHash);
  expect(querySql(`select md5("pageContent"::text) from contact_forms where id='singleton'`)).toBe(contactBefore);
  expect(querySql(`select "findTreatmentEnabled"::text || ',' || "bookConsultationCtaEnabled"::text from site_settings limit 1`)).toBe("true,true");
});

test("script gercek calisma: degisiklikler uygulanir, yedek alinir", async () => {
  test.setTimeout(240_000);
  const real = runAkScript(["--confirm=apply-client-revisions-ak", "--operator=qa-e2e"]);
  saveScript("03-gercek.txt", real);
  expect(blocksHash()).not.toBe(preScriptHash);
  expect(latestScriptBackup()).toBeTruthy();
  expect(querySql(`select "findTreatmentEnabled"::text || ',' || "bookConsultationCtaEnabled"::text || ',' || "serviceBookingEnabled"::text from site_settings limit 1`)).toBe("false,false,true");
  const hv = querySql(`select "pageContent"->>'hoursVisible' from contact_forms where id='singleton'`);
  expect(hv).toBe("false");
});

// ===================================================================================================================
// (2) Script sonrasi: anahtarlar KAPALI
// ===================================================================================================================
for (const width of WIDTHS) {
  test(`(2) anahtarlar kapali ${width}: header CTA yok, tasma/bosluk yok, hizmet/paket/footer/mega menu/ana sayfa temiz`, async ({ browser }) => {
    test.setTimeout(420_000);
    const { context, page } = await newVisitor(browser, width);
    try {
      await poll(page, "/", async () => {
        if (width === 1440) {
          await expect(page.getByTestId("header-find-treatment")).toHaveCount(0);
          await expect(page.getByTestId("header-book-consultation")).toHaveCount(0);
        }
        expect(await findOrBookLinks(page)).toEqual([]);
      });
      // Header dengesi: yatay tasma yok, ust duzey ogeler ust uste binmez, bos "actions" kabi artik yok
      const m = await noOverflow(page);
      expect(m.sw).toBeLessThanOrEqual(m.cw);
      const header = page.locator("header").first();
      const hm = await header.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(hm.sw).toBeLessThanOrEqual(hm.cw);
      if (width === 1440) {
        await expect(page.getByTestId("site-header-actions")).toHaveCount(0);
        const gap = await page.getByTestId("site-header-desktop").evaluate((el) => {
          const kids = Array.from(el.children).filter((c) => {
            const r = (c as HTMLElement).getBoundingClientRect();
            return r.width > 4 && r.height > 4 && getComputedStyle(c).visibility !== "hidden" && getComputedStyle(c).display !== "none";
          }) as HTMLElement[];
          const rects = kids.map((k) => k.getBoundingClientRect()).sort((a, b) => a.left - b.left);
          let overlap = 0;
          for (let i = 1; i < rects.length; i++) overlap = Math.max(overlap, rects[i - 1]!.right - rects[i]!.left);
          const first = rects[0]!;
          const last = rects[rects.length - 1]!;
          const box = el.getBoundingClientRect();
          return { overlap, startGap: Math.round(first.left - box.left), endGap: Math.round(box.right - last.right), count: rects.length };
        });
        // Ust duzey ogeler ust uste binmez; bos CTA kabi buyuk (>240px) bir bosluk sagda kalmaz.
        expect(gap.overlap).toBeLessThanOrEqual(1);
        expect(gap.endGap, `sag bosluk ${JSON.stringify(gap)}`).toBeLessThan(240);
        test.info().annotations.push({ type: "header-bosluk", description: JSON.stringify(gap) });
        // mega menu
        await page.getByTestId("services-mega-trigger").click();
        await expect(page.getByTestId("services-mega-menu")).toBeVisible();
        await expect(page.getByTestId("services-mega-panel").locator("a[href*='find-your-treatment'], a[href*='book-consultation']")).toHaveCount(0);
        await page.keyboard.press("Escape");
      } else {
        await openMobileMenu(page);
        await expect(page.getByTestId("mobile-menu-find-treatment")).toHaveCount(0);
        await expect(page.getByTestId("mobile-menu-book-consultation")).toHaveCount(0);
        expect(await findOrBookLinks(page)).toEqual([]);
        await page.keyboard.press("Escape");
      }

      // Hizmet kartlari ve bolum sayfasi
      await page.goto("/specialties");
      await expect(page.getByTestId("service-card").first()).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("service-card-book")).toHaveCount(0);
      await expect(page.getByTestId("service-card-request").first()).toBeVisible();
      expect(await findOrBookLinks(page)).toEqual([]);
      await page.goto(`/specialties/${SERVICE_SLUG}`);
      await expect(page.getByTestId("specialty-request-cta").first()).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("specialty-book-cta")).toHaveCount(0);
      expect(await findOrBookLinks(page)).toEqual([]);
      // Paket sayfasi + "Request a call back"
      await page.goto(`/packages/${PACKAGE_SLUG}`);
      await expect(page.getByTestId("package-request-cta")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("package-book-cta")).toHaveCount(0);
      await expect(page.getByText(/Request a call back/i).first()).toBeVisible();
      expect(await findOrBookLinks(page)).toEqual([]);
      // Footer her sayfada temiz (yukaridaki taramalar footer'i da kapsar); ayrica acik kontrol
      await expect(page.locator("footer").locator("a[href*='find-your-treatment'], a[href*='book-consultation']")).toHaveCount(0);

      for (const lang of LANGS) {
        await page.goto(`${lang.prefix}/`);
        await shot(page, lang.code, width, "Ana sayfa (kapali)", "02-ana-sayfa-kapali", { visitor: false });
        await shot(page, lang.code, width, "Header (kapali)", "04-header-kapali", { visitor: false, fullPage: false, locator: page.locator("header").first() });
        if (width === 390) {
          await openMobileMenu(page);
          await shot(page, lang.code, width, "Mobil menu (kapali)", "06-mobil-menu-kapali", { visitor: false, fullPage: false });
          await page.keyboard.press("Escape");
        } else {
          await page.getByTestId("services-mega-trigger").click();
          await expect(page.getByTestId("services-mega-menu")).toBeVisible();
          await shot(page, lang.code, width, "Mega menu (kapali)", "06-mega-menu-kapali", { visitor: false, fullPage: false });
          await page.keyboard.press("Escape");
        }
      }
    } finally {
      await context.close();
    }
  });
}

test("(2) yonlendirmeler ve site haritasi: Find -> /specialties, Book -> /request (302), manage yonlenmez, sitemap'te yok", async ({ browser }) => {
  test.setTimeout(240_000);
  await expect(async () => {
    const r1 = await rawGet("/en/find-your-treatment");
    expect(r1.status).toBe(302);
    // Varsayilan dil (en) URL'de oneksizdir: proxy `/en/...` -> `/specialties` (kanonik). Onekli `/en/specialties` da kabul.
    expect(r1.location ?? "").toMatch(/^(\/en)?\/specialties\/?$/);
  }).toPass(POLL);
  const r2 = await rawGet("/en/book-consultation?service=x");
  expect(r2.status).toBe(302);
  expect(r2.location ?? "").toMatch(/^(\/en)?\/request\?service=x$/);
  // `/en/...` oneki yalniz varsayilan dil kanoniklestirmesidir (301 -> oneksiz); AK yonlendirmesi (/request) OLMAMALI.
  const r3 = await rawGet("/en/book-consultation/manage");
  if ([301, 302, 307, 308].includes(r3.status)) expect(r3.location ?? "").toMatch(/\/book-consultation\/manage$/);
  const r3b = await rawGet("/book-consultation/manage");
  expect(r3b.status).toBe(200);
  const r3c = await rawGet("/ar/book-consultation/manage");
  expect(r3c.status).toBe(200);
  const r4 = await rawGet("/ar/find-your-treatment");
  expect(r4.status).toBe(302);
  expect(r4.location ?? "").toMatch(/\/ar\/specialties\/?$/);
  const { context } = await newVisitor(browser, 1440);
  try {
    const sm = await sitemapAll();
    expect(sm).toContain("/specialties");
    expect(sm).not.toContain("find-your-treatment");
    const llms = await rawBody("/llms.txt");
    if (llms.status === 200) expect(llms.body).not.toContain("find-your-treatment");
    // Gercek gezinti: tarayici da /specialties'e iner
    const page = await context.newPage();
    await page.goto("/en/find-your-treatment");
    expect(page.url()).toMatch(/\/specialties\/?$/);
    await page.goto("/en/book-consultation?service=x");
    expect(page.url()).toMatch(/\/request\?service=x$/);
    await expect(page.getByTestId("request-page").or(page.getByTestId("request-form")).first()).toBeVisible({ timeout: 60_000 });
  } finally {
    await context.close();
  }
});

// ===================================================================================================================
// (3) Ana sayfa: gizli serit ve How it works yok; yasakli ifadeler yok
// ===================================================================================================================
for (const lang of LANGS) {
  test(`(3) ana sayfa ${lang.code}: ozellik seridi ve How it works gizli; 'doctor', 'Verified profiles', 'Specialties' basligi yok`, async ({ browser }) => {
    test.setTimeout(240_000);
    const { context, page } = await newVisitor(browser, 1440);
    try {
      await poll(page, `${lang.prefix}/`, async () => {
        await expect(page.locator("#th-trust-band, [data-block-id='th-trust-band']")).toHaveCount(0);
        const t = scrub(await visibleText(page));
        expect(t).not.toMatch(DOCTOR_WORDS);
        expect(t).not.toMatch(/Choose your doctor|Verified profiles|availability calendar/i);
        expect(t).not.toMatch(/اختر طبيبك|ملفات موثّقة/);
      });
      const t = await visibleText(page);
      const html = await markup(page);
      // Gizli bloklar HTML'e hic yazilmaz (yalnizca CSS ile gizlenmez).
      for (const needle of lang.code === "en" ? ["24/7 Access", "Encrypted Consultation", "How it works", "1. Choose"] : ["الوصول على مدار الساعة", "كيف يعمل"]) {
        expect(html, `HTML'de '${needle}' olmamali`).not.toContain(needle);
      }
      // Baslik olarak "Specialties" yok; yeni baslik var
      const headings = (await page.locator("h1, h2, h3, h4").allTextContents()).map((h) => h.trim());
      expect(headings.join(" | ")).not.toMatch(/specialties|تخصصاتنا/i);
      if (lang.code === "en") {
        await expect(page.getByRole("heading", { name: /Our Health Tourism Services/i }).first()).toBeVisible();
      }
      // Sayac seridine script dokunmaz: elle yazilmis 15 / 6 / 6 / 30 hala gorunur
      expect(t).toMatch(/15/);
      expect(t).toMatch(/Coordinator|منسّق/);
    } finally {
      await context.close();
    }
  });
}

test("(3) sayac seridi: script dokunmaz; 'Canli veri' secilince canli degerler (alinamayan oge gosterilmez)", async () => {
  test.setTimeout(120_000);
  const metrics = await fetch("http://localhost:4001/api/v1/public/site-metrics").then((r) => r.json() as Promise<{ data: Record<string, number | null> }>);
  expect(Object.keys(metrics.data).sort()).toEqual(["activeCoordinators", "activeServices", "consultationMinutes", "visitorLanguages"]);
  // Elle yazilmis sayac degerleri DB'de aynen duruyor (script dokunmadi)
  const counter = querySql(`select (blocks -> 3 -> 'data' -> 'items' -> 0 ->> 'value') || ',' || (blocks -> 3 -> 'data' -> 'items' -> 2 ->> 'value') from pages where id='${homePageId()}'`);
  expect(counter).toBe("15,6");
});

// ===================================================================================================================
// (4) Hakkimizda
// ===================================================================================================================
test("(4) Hakkimizda: yeni eyebrow / baslik / metin (EN + AR); 'We treat' ifadeleri yok", async ({ browser }) => {
  test.setTimeout(240_000);
  for (const width of WIDTHS) {
    const { context, page } = await newVisitor(browser, width);
    try {
      await page.goto("/about");
      const en = page.locator("section", { has: page.getByRole("heading", { name: "Treatment services we facilitate" }) }).first();
      await expect(en).toBeVisible({ timeout: 60_000 });
      await expect(en).toContainText(/What we coordinate/i);
      await expect(en).toContainText("Each patient’s needs are different. We connect you with healthcare facilities holding an International Health Tourism Authorization Certificate, where treatment decisions are made following an individual medical evaluation.");
      const enText = scrub(await visibleText(page));
      expect(enText).not.toMatch(/\bwe treat\b|\bour treatment areas\b|What we treat/i);
      expect(enText).not.toMatch(DOCTOR_WORDS);
      await shot(page, "en", width, "Hakkimizda bolumu", "07-hakkimizda-bolum", { fullPage: false, locator: en });
      await shot(page, "en", width, "Hakkimizda sayfasi", "07b-hakkimizda-sayfa");

      await page.goto("/ar/about");
      const ar = page.locator("section", { has: page.getByRole("heading", { name: "خدمات العلاج التي نيسّرها" }) }).first();
      await expect(ar).toBeVisible({ timeout: 60_000 });
      await expect(ar).toContainText("ما ننسّقه");
      expect(await page.locator("html").getAttribute("dir")).toBe("rtl");
      await shot(page, "ar", width, "Hakkimizda bolumu", "07-hakkimizda-bolum", { fullPage: false, locator: ar });
      await shot(page, "ar", width, "Hakkimizda sayfasi", "07b-hakkimizda-sayfa");
    } finally {
      await context.close();
    }
  }
});

// ===================================================================================================================
// (5) Iletisim + footer + JSON-LD
// ===================================================================================================================
test("(5) Iletisim: CALL CENTER, 24/7 notu (EN/AR/DE), adres, harita, saatler karti yok, JSON-LD PostalAddress; footer", async ({ browser }) => {
  test.setTimeout(420_000);
  const notes: Record<string, RegExp> = { "": /You can reach our call center 24\/7\./, "/ar": /مركز الاتصال/, "/de": /Call-Center/ };
  for (const [prefix, re] of Object.entries(notes)) {
    const { context, page } = await newVisitor(browser, 1440);
    try {
      await poll(page, `${prefix}/contact`, async () => {
        await expect(page.getByTestId("contact-call-center-note")).toBeVisible();
        await expect(page.getByTestId("contact-call-center-note")).toContainText(re);
        await expect(page.getByText(ADDRESS).first()).toBeVisible();
      });
      if (prefix === "") {
        const details = page.locator('section[aria-labelledby="contact-details-title"]');
        await expect(details.getByText(/^call center$/i)).toBeVisible();
        await expect(details.getByText(/^phone$/i)).toHaveCount(0);
        await expect(page.getByText(FIXTURE_PHONE).first()).toBeVisible();
        // Harita baglantisi YENI adresi aratir (eski mapUrl degil)
        const mapHref = await page.getByRole("link", { name: /Open in Google Maps/i }).getAttribute("href");
        expect(mapHref).toContain("google.com/maps");
        expect(decodeURIComponent(mapHref ?? "").replace(/\+/g, " ")).toContain("Ertuğrul Gazi");
        expect(mapHref).not.toContain("Old+Test");
        // Calisma saatleri karti yok; Turkce gun adi sizmaz
        await expect(page.locator("#contact-hours-title")).toHaveCount(0);
        expect(await visibleText(page)).not.toMatch(/Pazartesi|Cumartesi|Opening hours|Working hours/i);
        // JSON-LD: Organization sema ANA SAYFADA basilir (iletisim sayfasinda yoktur)
        await poll(page, "/", async () => {
          const ldAll = (await page.locator("script[type='application/ld+json']").allTextContents()).join(" ");
          expect(ldAll).toContain("PostalAddress");
        });
        const ld = (await page.locator("script[type='application/ld+json']").allTextContents()).join("\n");
        expect(ld).toContain("PostalAddress");
        expect(ld).toContain("Ertuğrul Gazi");
        expect(ld).not.toMatch(/postalCode/);
        // Footer
        await expect(page.getByTestId("footer-phone")).toContainText(FIXTURE_PHONE);
        await expect(page.getByTestId("footer-call-center")).toContainText(/Call center 24\/7/i);
        await expect(page.getByTestId("footer-address")).toContainText("Ertuğrul Gazi");
        // WhatsApp ayri ayar: degismedi
        expect(querySql(`select "pageContent" -> 'locales' -> 'en' ->> 'whatsapp' from contact_forms where id='singleton'`)).toBe("+90 555 000 00 01");
      }
      if (prefix === "/ar") expect(await page.locator("html").getAttribute("dir")).toBe("rtl");
    } finally {
      await context.close();
    }
  }
  for (const lang of LANGS) {
    for (const width of WIDTHS) {
      const { context, page } = await newVisitor(browser, width);
      try {
        await page.goto(`${lang.prefix}/contact`);
        await expect(page.getByTestId("contact-call-center-note")).toBeVisible({ timeout: 60_000 });
        await shot(page, lang.code, width, "Iletisim sayfasi", "08-iletisim");
        await shot(page, lang.code, width, "Footer", "09-footer", { fullPage: false, locator: page.locator("footer").first() });
      } finally {
        await context.close();
      }
    }
  }
});

test("Turkce ve doktor ifadesi taramasi: ziyaretci sayfalari (EN + AR, script sonrasi)", async ({ browser }) => {
  test.setTimeout(420_000);
  const { context, page } = await newVisitor(browser, 1440);
  try {
    for (const lang of LANGS) {
      for (const p of ["/", "/specialties", `/specialties/${SERVICE_SLUG}`, `/packages/${PACKAGE_SLUG}`, "/contact", "/about", "/request"]) {
        await page.goto(`${lang.prefix}${p}`);
        await settle(page);
        const text = scrub(await visibleText(page));
        expect(TURKISH_CHARS.exec(text)?.[0] ? (/.{0,40}[ıİğĞşŞçÇöÖüÜ].{0,40}/.exec(text) ?? [""])[0] : "", `Turkce harf: ${lang.prefix}${p}`).toBe("");
        const dw = DOCTOR_WORDS.exec(text);
        expect(dw ? (new RegExp(`.{0,40}${dw[0]}.{0,40}`).exec(text) ?? [dw[0]])[0] : "", `doktor ifadesi: ${lang.prefix}${p}`).toBe("");
      }
    }
  } finally {
    await context.close();
  }
});

// ===================================================================================================================
// Script tekrar (0 degisiklik)
// ===================================================================================================================
test("script tekrar calisma: degisiklik 0, DB degismez", async () => {
  test.setTimeout(240_000);
  const before = blocksHash();
  const again = runAkScript(["--confirm=apply-client-revisions-ak", "--operator=qa-e2e"]);
  saveScript("04-tekrar.txt", again);
  expect(again).toMatch(/değişiklik\s*[:=]?\s*0|degisiklik\s*[:=]?\s*0|0 değişiklik|0 degisiklik/i);
  expect(blocksHash()).toBe(before);
});

// ===================================================================================================================
// Admin ekranlari: ayar karti, iletisim anahtari, sayfa olusturucu
// ===================================================================================================================
for (const width of WIDTHS) {
  test(`admin ${width}: Site ozellikleri karti, iletisim saatler anahtari, sayfa olusturucuda 'Ziyaretcien gizle' ve sayac 'Canli veri'`, async ({ browser }) => {
    test.setTimeout(420_000);
    const { page, close } = await createAuthenticatedPage(browser);
    try {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await prepareContext(page.context());
      await page.goto("/admin/settings");
      const card = page.getByTestId("site-features-card");
      await expect(card).toBeVisible({ timeout: 90_000 });
      // Script kapatti: iki anahtar da KAPALI gorunur
      await expect(page.getByTestId("switch-find-treatment")).toHaveAttribute("aria-checked", "false");
      await expect(page.getByTestId("switch-book-consultation")).toHaveAttribute("aria-checked", "false");
      await expect(card).toContainText("Site özellikleri");
      await card.scrollIntoViewIfNeeded();
      await shot(page, "tr", width, "Admin ayarlar: Site ozellikleri karti", "10-admin-ayarlar-site-ozellikleri", { visitor: false, fullPage: false, locator: card });
      await shot(page, "tr", width, "Admin ayarlar sayfasi", "10b-admin-ayarlar-sayfa", { visitor: false });

      await page.goto("/admin/contact");
      const sw = page.getByTestId("switch-contact-hours-visible");
      await expect(sw).toBeVisible({ timeout: 90_000 });
      await expect(sw).toHaveAttribute("aria-checked", "false");
      await sw.scrollIntoViewIfNeeded();
      await shot(page, "tr", width, "Admin iletisim: hoursVisible", "11-admin-iletisim-saatler-anahtari", { visitor: false, fullPage: false, locator: sw.locator("xpath=ancestor::*[contains(@class,'rounded') or self::section or self::div][3]") });
      await shot(page, "tr", width, "Admin iletisim sayfasi", "11b-admin-iletisim-sayfa", { visitor: false });

      // Sayfa olusturucu: ana sayfa
      await page.goto(`/admin/pages/${homePageId()}`);
      const toggles = page.getByTestId("block-hidden-toggle");
      await expect(toggles.first()).toBeVisible({ timeout: 90_000 });
      expect(await toggles.count()).toBeGreaterThan(1);
      // Script en az 2 blogu (ozellik seridi + How it works) gizledi: acik anahtar sayisi >= 2
      const checked = await toggles.evaluateAll((els) => els.filter((e) => e.getAttribute("aria-checked") === "true").length);
      expect(checked).toBeGreaterThanOrEqual(2);
      await toggles.evaluateAll((els) => els.find((e) => e.getAttribute("aria-checked") === "true")?.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(500);
      await shot(page, "tr", width, "Sayfa olusturucu: Ziyaretciden gizle", "12-sayfa-olusturucu-ziyaretciden-gizle", { visitor: false, fullPage: false });
      // Sayac blogu: "Canli veri" secimi
      const counterBlock = page.getByText("Canlı veri").first();
      if ((await counterBlock.count()) === 0) {
        const hdr = page.locator("[data-block-type='counter'], [data-testid*='counter']").first();
        if (await hdr.count()) await hdr.click();
      }
      await expect(page.getByText("Canlı veri").first()).toBeVisible({ timeout: 30_000 });
      await page.getByText("Canlı veri").first().scrollIntoViewIfNeeded();
      await shot(page, "tr", width, "Sayfa olusturucu: sayac Canli veri", "13-sayfa-olusturucu-sayac-canli-veri", { visitor: false, fullPage: false });
    } finally {
      await close();
    }
  });
}

// ===================================================================================================================
// (6) Panelden tekrar ac -> davranis geri gelir (<=60 sn); panelden kapat -> kapanir; sonunda ACIK
// ===================================================================================================================
test("(6) panelden iki anahtari ACIP: header, mega menu, hizmet, paket ve yonlendirmeler geri gelir", async ({ browser }) => {
  test.setTimeout(480_000);
  const admin = await createAuthenticatedPage(browser);
  const { context, page } = await newVisitor(browser, 1440);
  try {
    await setFeaturesViaPanel(admin.page, true, true);
    await poll(page, "/", async () => {
      await expect(page.getByTestId("header-find-treatment")).toBeVisible();
      await expect(page.getByTestId("header-book-consultation")).toBeVisible();
    });
    await page.goto("/specialties");
    await expect(page.getByTestId("service-card-book").first()).toBeVisible({ timeout: 60_000 });
    await page.goto(`/packages/${PACKAGE_SLUG}`);
    await expect(page.getByTestId("package-book-cta")).toBeVisible({ timeout: 60_000 });
    await expect(async () => {
      const r = await rawGet("/find-your-treatment");
      expect(r.status).toBe(200);
      const r2 = await rawGet("/book-consultation?service=x");
      expect(r2.status).toBe(200);
    }).toPass(POLL);
    expect(await sitemapAll()).toContain("find-your-treatment");
    // Ana sayfada gizli bloklar panelden degil sayfa olusturucudan acilir: hala gizli (anahtarlar ayri)
    await page.goto("/");
    expect(await markup(page)).not.toContain("Encrypted Consultation");
  } finally {
    await context.close();
    await admin.close();
  }
});

test("(6) panelden yalniz Find'i KAPATMA: Book kalir (anahtarlar bagimsiz); sonra ikisi de ACIK birakilir", async ({ browser }) => {
  test.setTimeout(480_000);
  const admin = await createAuthenticatedPage(browser);
  const { context, page } = await newVisitor(browser, 1440);
  try {
    await setFeaturesViaPanel(admin.page, false, true);
    await poll(page, "/", async () => {
      await expect(page.getByTestId("header-find-treatment")).toHaveCount(0);
      await expect(page.getByTestId("header-book-consultation")).toBeVisible();
    });
    await shot(page, "en", 1440, "Header: yalniz Book", "04b-header-yalniz-book", { visitor: false, fullPage: false, locator: page.locator("header").first() });
    await setFeaturesViaPanel(admin.page, true, true);
    await poll(page, "/", async () => {
      await expect(page.getByTestId("header-find-treatment")).toBeVisible();
      await expect(page.getByTestId("header-book-consultation")).toBeVisible();
    });
  } finally {
    await context.close();
    await admin.close();
  }
});

// ===================================================================================================================
// Script geri yukleme (--restore): ana sayfa, iletisim ve ayarlar birebir eski hale doner
// ===================================================================================================================
test("script --restore: ana sayfa blogu birebir geri gelir, hidden ve ayarlar eski haline doner", async () => {
  test.setTimeout(240_000);
  const backup = latestScriptBackup();
  const out = runAkScript([`--restore=${backup}`, "--confirm=apply-client-revisions-ak", "--operator=qa-e2e"]);
  saveScript("05-restore.txt", out);
  expect(blocksHash()).toBe(preScriptHash);
  expect(querySql(`select "findTreatmentEnabled"::text || ',' || "bookConsultationCtaEnabled"::text from site_settings limit 1`)).toBe("true,true");
  expect(querySql(`select coalesce("pageContent"->>'hoursVisible','yok') from contact_forms where id='singleton'`)).toBe("yok");
  await flushFrontendCache();
  const html = querySql(`select count(*) from pages where id='${homePageId()}' and blocks::text like '%Choose Your Doctor%'`);
  expect(html).toBe("1");
});

test("restore sonrasi ziyaretci: eski davranis (Find/Book gorunur, ozellik seridi ve How it works geri)", async ({ browser }) => {
  test.setTimeout(300_000);
  const { context, page } = await newVisitor(browser, 1440);
  try {
    await poll(page, "/", async () => {
      await expect(page.getByTestId("header-find-treatment")).toBeVisible();
      await expect(page.getByTestId("header-book-consultation")).toBeVisible();
      expect(await markup(page)).toContain("Encrypted Consultation");
    });
  } finally {
    await context.close();
  }
});
