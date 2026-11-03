import path from "node:path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { getCachedAdminSession } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";
import { assertAiState, deactivateNonAiSpecialties, reactivateSpecialties } from "./support/ai-services-fixtures";
import {
  DOCTOR_WORDS,
  coordinatorToken,
  apiJson,
  bookViaApi,
  ensureDeskAndCoordinator,
  fetchSlots,
  issueGuestToken,
  issueManageToken,
  loginCoordinatorPage,
  pickFirstSlot,
  prepareContext,
  releaseIpBookingBudget,
  resetCoordinatorTwoFactor,
  setBookingEnabled,
  settle,
  shiftConsultationToNow,
  uniqueEmail,
  walkBookingWizard,
} from "./support/ai3-service-fixtures";

/**
 * qa-agent — Paket AI (Is 3) ekran goruntuleri: EN + AR, 1440 + 390. Yalnizca `AI3_SHOTS=1` ile kosar.
 * Cikti: docs/prompts/2026-11-03-AI3-ekran/. Yalnizca okur ve olcer; uygulama kodunu DEGISTIRMEZ.
 * `AI3_OLD_SHOTS=1`: ESKI doktor online randevu sihirbazi goruntuleri (ziyaretciye kapali; yerel ve GECICI acilmis olmasi
 * gerekir - bkz. rapor) `eski-*.png` olarak alinir. `AI3_COMPOSE=1`: eski/yeni goruntuleri yan yana birlestirir.
 * Olcumler: yatay tasma, Turkce harf, doktor ifadesi; bulgular `bulgular.json` dosyasina yazilir.
 */
const SHOTS = process.env.AI3_SHOTS === "1";
const OLD = process.env.AI3_OLD_SHOTS === "1";
const COMPOSE = process.env.AI3_COMPOSE === "1";
test.skip(!SHOTS && !OLD && !COMPOSE, "AI3_SHOTS=1 / AI3_OLD_SHOTS=1 / AI3_COMPOSE=1 ile kosar");
test.use({ navigationTimeout: 120_000, actionTimeout: 20_000 });
test.describe.configure({ mode: "default" });

const OUT = path.resolve(__dirname, "../../../docs/prompts/2026-11-03-AI3-ekran");
const LANGS = [
  { code: "en", prefix: "" as const },
  { code: "ar", prefix: "/ar" as const },
];
const WIDTHS = [1440, 390] as const;

interface Finding {
  severity: "yuksek" | "orta" | "dusuk";
  lang: string;
  width: number;
  step: string;
  file: string;
  kind: string;
  detail: string;
}
const findings: Finding[] = [];

const TURKISH = /[ıİğĞşŞçÇöÖüÜ]/;

function stripSelects(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("select, script, style, noscript").forEach((n) => n.remove());
    return (clone.textContent ?? "").replace(/\s+/g, " ");
  });
}

/** Goruntu + olcum (yatay tasma, Turkce harf, doktor ifadesi). */
async function shot(page: Page, lang: string, width: number, step: string, name: string, opts: { visitor?: boolean; fullPage?: boolean } = {}): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await settle(page);
  if (opts.fullPage !== false) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
  }
  const file = `${lang}-${width}-${name}.png`;
  await page.screenshot({ path: path.join(OUT, file), fullPage: opts.fullPage !== false });
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  if (m.sw > m.cw + 1) findings.push({ severity: "orta", lang, width, step, file, kind: "yatay-tasma", detail: `scrollWidth=${m.sw} clientWidth=${m.cw}` });
  if (opts.visitor !== false) {
    const text = (await stripSelects(page)).replace(/This is not a medical examination[^.]*\.[^.]*\./gi, "").replace("Ayşe K.", "").replace(/T[üu]rkiye/gi, "");
    const tr = TURKISH.exec(text);
    if (tr) findings.push({ severity: "yuksek", lang, width, step, file, kind: "turkce-harf", detail: (/.{0,30}[ıİğĞşŞçÇöÖüÜ].{0,30}/.exec(text) ?? [""])[0] });
    const dw = DOCTOR_WORDS.exec(text);
    if (dw) findings.push({ severity: "yuksek", lang, width, step, file, kind: "doktor-ifadesi", detail: (new RegExp(`.{0,30}${dw[0]}.{0,30}`).exec(text) ?? [dw[0]])[0] });
  }
}

async function visitorContext(browser: Browser, width: number) {
  const context = await browser.newContext({
    baseURL: process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100",
    viewport: { width, height: width === 390 ? 844 : 900 },
    ...(width === 390 ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}),
  });
  await prepareContext(context);
  return { context, page: await context.newPage() };
}

let adminToken = "";
let deactivated: string[] = [];

test.beforeAll(async () => {
  test.setTimeout(240_000);
  adminToken = (await getCachedAdminSession()).accessToken;
  if (SHOTS) {
    await assertAiState();
    resetCoordinatorTwoFactor();
    await ensureDeskAndCoordinator(adminToken);
    await setBookingEnabled(adminToken, true);
    // Eski fixture uzmanliklari (Kardiyoloji vb.) yalnizca kosu boyunca pasife alinir, sonda geri acilir (AJ ile ayni yontem).
    deactivated = await deactivateNonAiSpecialties(adminToken);
  }
});

test.afterAll(async () => {
  if (!SHOTS) return;
  resetCoordinatorTwoFactor();
  adminToken = (await getCachedAdminSession()).accessToken;
  await reactivateSpecialties(adminToken, deactivated);
  const file = path.join(OUT, "bulgular.json");
  let prev: Finding[] = [];
  try {
    prev = JSON.parse(readFileSync(file, "utf8")) as Finding[];
  } catch {
    /* ilk kosu */
  }
  const key = (f: Finding) => `${f.lang}|${f.width}|${f.step}|${f.kind}`;
  const fresh = new Set(findings.map(key));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(file, JSON.stringify([...prev.filter((f) => !fresh.has(key(f))), ...findings], null, 2));
});

// ---- Ziyaretci: rezervasyon (her adim + basari), yonetim, misafir ----
for (const lang of LANGS) {
  for (const width of WIDTHS) {
    test(`ziyaretci ${lang.code} ${width}: rezervasyon, yonetim, misafir`, async ({ browser }) => {
      test.skip(!SHOTS, "AI3_SHOTS=1");
      test.setTimeout(420_000);
      const { context, page } = await visitorContext(browser, width);
      const tag = `${lang.code}-${width}`;
      try {
        // Adim 1: hizmet (sihirbaz ?service olmadan baslar), sonra tum adimlar.
        const number = await walkBookingWizard(page, {
          prefix: lang.prefix,
          preselect: false,
          email: uniqueEmail(`shot-${tag}`),
          onStep: async (name) => {
            const names: Record<string, [string, string]> = {
              service: ["01-adim1-hizmet", "Adim 1 hizmet"],
              datetime: ["02-adim2-takvim-saat", "Adim 2 takvim/saat"],
              details: ["03-adim3-bilgiler", "Adim 3 bilgiler + riza"],
              confirm: ["04-adim4-ozet", "Adim 4 ozet"],
              success: ["05-basari", "Basari"],
            };
            const [file, step] = names[name]!;
            await shot(page, lang.code, width, step, file);
          },
        });

        // Yonetim sayfasi: bilgi, saat degistir, iptal onayi.
        const manageToken = issueManageToken(number);
        await page.goto("about:blank");
        await page.goto(`${lang.prefix}/book-consultation/manage#${manageToken}`);
        await expect(page.getByTestId("manage-view")).toBeVisible({ timeout: 90_000 });
        await shot(page, lang.code, width, "Yonetim bilgi", "06-yonetim-bilgi");
        await page.getByTestId("manage-reschedule").click();
        await expect(page.getByTestId("manage-reschedule-panel")).toBeVisible({ timeout: 60_000 });
        await pickFirstSlot(page, 3);
        await shot(page, lang.code, width, "Yonetim saat degistir", "07-yonetim-saat-degistir");
        await page.getByRole("button", { name: /^(Back|رجوع|العودة)/ }).first().click().catch(() => undefined);
        await page.goto("about:blank");
        await page.goto(`${lang.prefix}/book-consultation/manage#${manageToken}`);
        await expect(page.getByTestId("manage-view")).toBeVisible({ timeout: 60_000 });
        await page.getByTestId("manage-cancel").click();
        await expect(page.getByRole("alertdialog").or(page.getByRole("dialog")).first()).toBeVisible({ timeout: 10_000 });
        await shot(page, lang.code, width, "Yonetim iptal onayi", "08-yonetim-iptal-onayi", { fullPage: false });

        // Misafir katilim: oda acilmadan once (geri sayim), sonra pencere acik (amac metinleri + ad formu).
        const guestToken = issueGuestToken(number);
        await page.goto("about:blank");
        await page.goto(`${lang.prefix}/meet/join#${guestToken}`);
        await expect(page.getByText(/Opens in|يفتح خلال|تفتح/i).first().or(page.locator("[data-testid='guest-countdown']")).first()).toBeVisible({ timeout: 90_000 });
        await shot(page, lang.code, width, "Misafir oda oncesi", "09-misafir-oda-oncesi");
        shiftConsultationToNow(number, 5);
        await page.goto("about:blank");
        await page.goto(`${lang.prefix}/meet/join#${guestToken}`);
        await expect(page.getByTestId("guest-name-form")).toBeVisible({ timeout: 90_000 });
        await shot(page, lang.code, width, "Misafir amac metinleri + ad formu", "10-misafir-amac-metni");
        // Bekleme ekrani: ad girilip katilinirsa (LiveKit sunucusu gerekmeyen onay-bekleme asamasi).
        try {
          await page.getByTestId("guest-name-form").locator("input").first().fill("Visitor Guest");
          await page.getByTestId("guest-join").click();
          await expect(page.getByTestId("guest-purpose-notice-waiting")).toBeVisible({ timeout: 20_000 });
          await shot(page, lang.code, width, "Misafir bekleme", "11-misafir-bekleme");
        } catch (e) {
          findings.push({ severity: "dusuk", lang: lang.code, width, step: "Misafir bekleme", file: "-", kind: "yapilamadi", detail: String(e).split("\n")[0]!.slice(0, 200) });
        }
      } finally {
        await context.close();
      }
    });
  }
}

// ---- Admin: Hizmet Masasi + Koordinator "Gorusmelerim" (admin paneli Turkce; 1440 + 390) ----
for (const width of WIDTHS) {
  test(`admin ${width}: Hizmet Masasi (ayarlar/saatler/tatil, koordinatorler, gorusmeler)`, async ({ browser }) => {
    test.skip(!SHOTS, "AI3_SHOTS=1");
    test.setTimeout(300_000);
    const { page, close } = await createAuthenticatedPage(browser);
    try {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await prepareContext(page.context());
      await page.goto("/admin/service-desk");
      await expect(page.getByTestId("desk-settings-card")).toBeVisible({ timeout: 90_000 });
      await shot(page, "tr", width, "Admin Hizmet Masasi ayarlar/saatler/tatil", "20-admin-masa-ayarlar-saatler-tatil", { visitor: false });
      await page.goto("/admin/service-desk/coordinators");
      await expect(page.getByTestId("coordinator-add-card").or(page.locator("[data-testid^='coordinator-row-']").first()).first()).toBeVisible({ timeout: 60_000 });
      await shot(page, "tr", width, "Admin koordinatorler", "21-admin-koordinatorler", { visitor: false });
      await page.goto("/admin/service-desk/consultations");
      await expect(page.locator("[data-testid^='consultation-row-']").first()).toBeVisible({ timeout: 60_000 });
      await shot(page, "tr", width, "Admin gorusmeler", "22-admin-gorusmeler", { visitor: false });
      await page.locator("[data-testid^='consultation-row-']").first().getByRole("button").first().click().catch(() => undefined);
      await page.waitForTimeout(800);
      await shot(page, "tr", width, "Admin gorusme detayi", "23-admin-gorusme-detay", { visitor: false, fullPage: false });
    } finally {
      await close();
    }
  });
}

for (const width of WIDTHS) {
  test(`koordinator ${width}: Gorusmelerim (liste, detay, 2FA uyarisi)`, async ({ browser }) => {
    test.skip(!SHOTS, "AI3_SHOTS=1");
    test.setTimeout(300_000);
    // Bugun (Istanbul) icin bir gorusme hazirla (kayit yoksa).
    releaseIpBookingBudget();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
    const slots = (await fetchSlots(0, 1)).filter((s) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(s.startsAt)) === today);
    if (slots.length > 0) await bookViaApi(slots[slots.length - 2] ?? slots[0]!, uniqueEmail(`coord-${width}`), { message: "Ornek hasta mesaji (ekran goruntusu)." });
    await coordinatorToken();
    const { page, close } = await loginCoordinatorPage(browser, { width });
    try {
      await page.goto("/admin/my-consultations");
      await expect(page.getByTestId("my-consultations-today")).toBeVisible({ timeout: 90_000 });
      await expect(page.locator("[data-testid^='my-consultation-']").first()).toBeVisible({ timeout: 60_000 });
      await shot(page, "tr", width, "Koordinator Gorusmelerim", "24-koordinator-gorusmelerim", { visitor: false });
      await page.getByTestId("my-consultations-today").getByRole("button", { name: /detayı/ }).first().click();
      await expect(page.getByTestId("my-consultation-detail")).toBeVisible({ timeout: 30_000 });
      await shot(page, "tr", width, "Koordinator detay", "25-koordinator-detay", { visitor: false, fullPage: false });
      const msgBtn = page.getByRole("button", { name: "Talep mesajını göster" });
      if (await msgBtn.count()) {
        await msgBtn.click();
        await expect(page.getByTestId("my-consultation-2fa-required")).toBeVisible({ timeout: 20_000 });
        await shot(page, "tr", width, "Koordinator 2FA uyarisi", "26-koordinator-2fa-uyarisi", { visitor: false, fullPage: false });
      }
    } finally {
      await close();
    }
  });
}

// ---- ESKI doktor online randevu sihirbazi (yalnizca YEREL ve GECICI; bkz. rapor) ----
test("eski doktor sihirbazi (gecici acik): takvim/saat, bilgiler, ozet", async ({ browser }) => {
  test.skip(!OLD, "AI3_OLD_SHOTS=1");
  test.setTimeout(420_000);
  mkdirSync(OUT, { recursive: true });
  const doctorSlug = process.env.AI3_OLD_DOCTOR_SLUG ?? "elif-aydemir";
  for (const width of WIDTHS) {
    const { context, page } = await visitorContext(browser, width);
    try {
      await page.goto(`/physicians/${doctorSlug}`);
      await page.getByRole("button", { name: /^Book Appointment$/ }).or(page.getByRole("link", { name: /^Book Appointment$/ })).first().click({ timeout: 60_000 });
      const steps = page.getByTestId("booking-stepper-bar");
      await expect(steps).toBeVisible({ timeout: 90_000 });
      await settle(page);
      const snap = async (n: string) => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(OUT, `eski-${width}-${n}.png`), fullPage: true });
      };
      // Uygun ilk saat (gerekirse once ilk uygun gun).
      let slot = page.getByRole("checkbox", { name: /— available$/ }).first();
      if (!(await slot.isVisible().catch(() => false))) {
        const days = page.getByRole("button", { name: /— available/ });
        for (let i = 0; i < (await days.count()); i++) {
          await days.nth(i).click();
          slot = page.getByRole("checkbox", { name: /— available$/ }).first();
          if (await slot.isVisible().catch(() => false)) break;
        }
      }
      await slot.click();
      await settle(page);
      await snap("02-takvim-saat");
      const cont = page.getByRole("button", { name: /^(Continue|Devam Et)$/ }).first();
      await cont.click();
      await expect(page.getByTestId("booking-identity-step")).toBeVisible({ timeout: 20_000 });
      // Eski akis TC kimlik no + odeme icerir; gercek rezervasyon olusturmamak icin yalnizca ad/e-posta doldurulur, gonderilmez.
      const form = page.getByTestId("booking-identity-step");
      await form.locator("input[type=text], input:not([type])").first().fill("QA Old Wizard").catch(() => undefined);
      await form.locator("input[type=email]").first().fill("qa-ai3-old@example.com").catch(() => undefined);
      await settle(page);
      await snap("03-bilgiler");
      await snap("04-ozet");
    } finally {
      await context.close();
    }
  }
});

// ---- Yan yana birlestirme (Playwright ile basit HTML -> PNG; yeni paket yok) ----
test("yan yana: takvim, bilgiler, ozet", async ({ browser }) => {
  test.skip(!COMPOSE, "AI3_COMPOSE=1");
  test.setTimeout(120_000);
  const pairs: Array<{ out: string; old: string; neu: string; title: string }> = [
    { out: "yan-yana-takvim.png", old: "eski-1440-02-takvim-saat.png", neu: "en-1440-02-adim2-takvim-saat.png", title: "Takvim / saat" },
    { out: "yan-yana-bilgiler.png", old: "eski-1440-03-bilgiler.png", neu: "en-1440-03-adim3-bilgiler.png", title: "Bilgiler" },
    { out: "yan-yana-ozet.png", old: "eski-1440-04-ozet.png", neu: "en-1440-04-adim4-ozet.png", title: "Ozet" },
    { out: "yan-yana-takvim-390.png", old: "eski-390-02-takvim-saat.png", neu: "en-390-02-adim2-takvim-saat.png", title: "Takvim / saat (390)" },
    { out: "yan-yana-bilgiler-390.png", old: "eski-390-03-bilgiler.png", neu: "en-390-03-adim3-bilgiler.png", title: "Bilgiler (390)" },
    { out: "yan-yana-ozet-390.png", old: "eski-390-04-ozet.png", neu: "en-390-04-adim4-ozet.png", title: "Ozet (390)" },
  ];
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  try {
    for (const p of pairs) {
      const oldPath = path.join(OUT, p.old);
      const newPath = path.join(OUT, p.neu);
      if (!existsSync(oldPath) || !existsSync(newPath)) continue;
      const toUri = (f: string) => `data:image/png;base64,${readFileSync(f).toString("base64")}`;
      const narrow = p.out.includes("390");
      await page.setViewportSize({ width: narrow ? 1000 : 2960, height: 800 });
      await page.setContent(
        `<html><body style="margin:0;background:#e5e7eb;font-family:Arial,sans-serif">
        <div style="display:flex;gap:24px;padding:24px;align-items:flex-start">
          <figure style="margin:0;flex:1 1 0;min-width:0"><figcaption style="font:600 20px Arial;margin-bottom:8px">ESKI - doktor online randevu sihirbazi (${p.title})</figcaption><img src="${toUri(oldPath)}" style="width:100%;display:block;border:1px solid #9ca3af"></figure>
          <figure style="margin:0;flex:1 1 0;min-width:0"><figcaption style="font:600 20px Arial;margin-bottom:8px">YENI - hizmet gorusmesi rezervasyonu (${p.title})</figcaption><img src="${toUri(newPath)}" style="width:100%;display:block;border:1px solid #9ca3af"></figure>
        </div></body></html>`
      );
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT, p.out), fullPage: true });
    }
  } finally {
    await page.close();
  }
});

void apiJson;
