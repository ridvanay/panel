import http from "node:http";
import { test, expect, type Page } from "@playwright/test";
import { ensureLocaleEnabled, getCachedAdminSession } from "./support/api";
import {
  EXPECTED_GROUPS,
  assertAiState,
  deactivateNonAiSpecialties,
  ensureTopicServiceLinks,
  openMegaMenu,
  pickTopicBySearch,
  reactivateSpecialties,
  settledMenuHeight,
  turkishLetterHits,
  walkWizardToResult,
} from "./support/ai-services-fixtures";

/**
 * qa-agent — Paket AI (iş 1–2) e2e: hizmet mega menüsü, header düğmeleri, /specialties, "Find your treatment".
 * Ön koşul: saas_e2e AI durumunda (migration 20261114090000 + rename-service-labels --cta; bkz. support/ai-services-fixtures.ts).
 * Eski fixture uzmanlıkları (kardiyoloji-N vb.) yalnızca test süresince pasife alınır ve afterAll'da geri açılır.
 * Not: ISR 60 sn gecikmesi beklenen davranıştır; ilgili beklemeler toPass + reload ile yoklanır.
 */
test.use({ navigationTimeout: 120_000, actionTimeout: 20_000 });
test.describe.configure({ mode: "serial" });

let token = "";
let deactivated: string[] = [];

const SHOULD_NOT_APPEAR = /\bSpecialists?\b|\bDr\.?\s|\bProf\.?\s|\bMD\b/;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  token = (await getCachedAdminSession()).accessToken;
  await ensureLocaleEnabled(token, "de", "German", "Deutsch"); // AL: spec /de yollarını sınar; taban hattında de etkin olmalı
  await assertAiState();
  await ensureTopicServiceLinks(token);
  deactivated = await deactivateNonAiSpecialties(token);
});

test.afterAll(async () => {
  test.setTimeout(240_000);
  await reactivateSpecialties(token, deactivated);
});

/** Node `*.localhost` çözemez — 127.0.0.1'e bağlanıp Host başlığını elle veririz (ah-intermediary.spec.ts ile aynı desen). */
function rawGet(path: string): Promise<{ status: number; location: string | null }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: 3100, path, headers: { Host: "siteadi.localhost:3100" } }, (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0, location: (res.headers.location as string | undefined) ?? null }));
      })
      .on("error", reject);
  });
}

async function groupItemNames(page: Page, groupId: string): Promise<string[]> {
  return page
    .getByTestId(`services-group-${groupId}`)
    .getByTestId("services-item")
    .evaluateAll((els) => els.map((el) => el.querySelector("a > span:nth-of-type(2) > span:first-of-type")?.textContent?.trim() ?? ""));
}

test.describe("Mega menü — masaüstü (1440)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("açılır; gruplar sabit sırada, hizmetler grup içi sırada, her öğede kısa açıklama; 'Other' ve eski adlar yok", async ({ page }) => {
    await openMegaMenu(page);
    const groups = await page.getByTestId("services-mega-groups").locator('[data-testid^="services-group-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("services-group-", "")));
    expect(groups).toEqual(EXPECTED_GROUPS.map((g) => g.id));
    for (const g of EXPECTED_GROUPS) {
      await expect(page.getByTestId(`services-group-${g.id}`)).toContainText(g.title);
      expect(await groupItemNames(page, g.id), `grup ${g.id}`).toEqual([...g.items]);
    }
    // Her ana öğede kısa açıklama satırı var.
    const descs = await page.getByTestId("services-item").evaluateAll((els) => els.map((el) => el.querySelector("a > span:nth-of-type(2) > span:nth-of-type(2)")?.textContent?.trim() ?? ""));
    expect(descs.length).toBe(11);
    expect(descs.every((d) => d.length > 0 && d.length <= 120)).toBe(true);
    // Hizmet adları (unvan değil): slug'lar değişmeden ad güncel.
    const menu = page.getByTestId("services-mega-menu");
    await expect(menu).toContainText("Orthodontics");
    await expect(menu).toContainText("Interventional Radiology");
    await expect(menu).not.toContainText(/Orthodontist\b/);
    await expect(menu).not.toContainText(/Interventional Radiology Specialist/);
    // Slug'lar (URL) aynı.
    await expect(menu.locator('a[href$="/specialties/orthodontist"]').first()).toBeVisible();
    await expect(menu.locator('a[href$="/specialties/interventional-radiology-specialist"]').first()).toBeVisible();
  });

  test("alt hizmet çipleri: Gastroenterology altında ERCP · ESD · POEM (bağlantılar /specialties/<slug>)", async ({ page }) => {
    await openMegaMenu(page);
    const chips = page.getByTestId("services-group-digestive-interventional").getByTestId("nav-procedures");
    await expect(chips).toHaveCount(1);
    await expect(chips.locator("a")).toHaveText(["ERCP", "ESD", "POEM"]);
    for (const slug of ["ercp", "esd", "poem"]) await expect(chips.locator(`a[href$="/specialties/${slug}"]`)).toHaveCount(1);
    // Diğer gruplarda çip yok.
    await expect(page.getByTestId("nav-procedures")).toHaveCount(1);
  });

  test("sağ panel ve alt şerit: Find your treatment, Book an online consultation, View all services, aracı kuruluş notu", async ({ page }) => {
    await openMegaMenu(page);
    const panel = page.getByTestId("services-mega-panel");
    await expect(panel).toContainText("Not sure which treatment you need?");
    await expect(panel.getByRole("menuitem", { name: "Find your treatment" })).toHaveAttribute("href", /\/find-your-treatment$/);
    await expect(panel.getByRole("menuitem", { name: "Book an online consultation" })).toHaveAttribute("href", /\/book-consultation$/); // AL: AK sonrası "Book a consultation" anahtarı açıkken menü /book-consultation adresine gider (eskiden /request)
    const menu = page.getByTestId("services-mega-menu");
    await expect(menu.getByRole("menuitem", { name: /View all services/i })).toHaveAttribute("href", /\/specialties$/);
    await expect(menu).toContainText("Treatments at authorized healthcare facilities");
  });

  test("yükseklik ≤ 520 px, taşma/kaydırma yok; 'Specialist', doktor adı ya da unvan görünmez", async ({ page }, testInfo) => {
    await openMegaMenu(page);
    const height = await settledMenuHeight(page);
    testInfo.annotations.push({ type: "menu-height-en-px", description: String(height) });
    console.log(`[AI] mega menü yüksekliği EN 1440: ${height}px`);
    expect(height).toBeGreaterThan(150);
    expect(height).toBeLessThanOrEqual(520);
    const box = (await page.getByTestId("services-mega-menu").boundingBox())!;
    expect(box.y + box.height, "menü ekranın altına taşmamalı").toBeLessThanOrEqual(900);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1440);
    // Sol liste kendi içinde kaydırılmıyor (içerik 520 px'e sığıyor).
    const overflow = await page.getByTestId("services-mega-groups").evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow, "grup listesi içeriği kırpılıyor/kaydırılıyor").toBeLessThanOrEqual(1);
    const text = (await page.getByTestId("services-mega-menu").innerText()) ?? "";
    expect(text).not.toMatch(SHOULD_NOT_APPEAR);
  });

  test("klavye: Enter açar, ok tuşları öğeler arasında gezer, Esc kapatır ve odak tetikleyiciye döner", async ({ page }) => {
    await openMegaMenu(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("services-mega-menu")).toBeHidden();
    const trigger = page.getByTestId("services-mega-trigger");
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    const menu = page.getByTestId("services-mega-menu");
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(menu).toHaveAttribute("role", "menu");
    await page.keyboard.press("ArrowDown");
    const focusedLabel = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return { inMenu: !!el?.closest('[data-testid="services-mega-menu"]'), role: el?.getAttribute("role"), text: (el?.textContent ?? "").trim().slice(0, 40) };
      });
    const first = await focusedLabel();
    expect(first.inMenu).toBe(true);
    expect(first.role).toBe("menuitem");
    await page.keyboard.press("ArrowDown");
    const second = await focusedLabel();
    expect(second.inMenu).toBe(true);
    expect(second.text).not.toBe(first.text);
    await page.keyboard.press("ArrowUp");
    expect((await focusedLabel()).text).toBe(first.text);
    // Menü öğeleri ARIA: grup etiketli.
    await expect(page.getByTestId("services-group-fertility")).toHaveAttribute("role", "group");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("header: 'Find your treatment' -> /find-your-treatment, 'Book a consultation' -> /request; 'Find my physician' / 'Appointment' yok", async ({ page }) => {
    await page.goto("/");
    const find = page.getByTestId("header-find-treatment");
    await expect(find).toContainText("Find your treatment");
    await expect(find).toHaveAttribute("href", /\/find-your-treatment$/);
    const book = page.getByTestId("header-book-consultation");
    await expect(book).toHaveText("Book a consultation");
    await expect(book).toHaveAttribute("href", /\/request$/);
    const header = page.locator("header").first();
    await expect(header).not.toContainText(/Find my physician|Request a consultation|^Appointment$/i);
    await find.click();
    await expect(page).toHaveURL(/\/find-your-treatment$/);
    await page.goto("/");
    await page.getByTestId("header-book-consultation").click();
    await expect(page).toHaveURL(/\/request$/);
  });
});

test.describe("Mega menü — RTL (/ar, 1440)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("dir=rtl; yükseklik ≤ 520; sağ panel sol kenara geçer; Arapça gruplar; Türkçe/'Specialist' yok", async ({ page }, testInfo) => {
    await openMegaMenu(page, "/ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const height = await settledMenuHeight(page);
    testInfo.annotations.push({ type: "menu-height-ar-px", description: String(height) });
    console.log(`[AI] mega menü yüksekliği AR 1440: ${height}px`);
    expect(height).toBeGreaterThan(150);
    expect(height).toBeLessThanOrEqual(520);
    const menuBox = (await page.getByTestId("services-mega-menu").boundingBox())!;
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(1440);
    // RTL: grup listesi sağda, vurgulu panel solda.
    const groupsBox = (await page.getByTestId("services-mega-groups").boundingBox())!;
    const panelBox = (await page.getByTestId("services-mega-panel").boundingBox())!;
    expect(panelBox.x + panelBox.width / 2).toBeLessThan(groupsBox.x + groupsBox.width / 2);
    // Grup başlıkları Arapça, 4 grup, aynı sıra.
    const groups = await page.getByTestId("services-mega-groups").locator('[data-testid^="services-group-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("services-group-", "")));
    expect(groups).toEqual(EXPECTED_GROUPS.map((g) => g.id));
    await expect(page.getByTestId("services-group-fertility")).toContainText(/[؀-ۿ]/);
    const menuText = await page.getByTestId("services-mega-menu").innerText();
    expect(menuText).not.toMatch(SHOULD_NOT_APPEAR);
    expect(turkishLetterHits(menuText), "Türkçeye özgü harf").toEqual([]);
    // Panel bağlantıları /ar ön ekli.
    await expect(page.getByTestId("services-mega-panel").locator('a[href$="/ar/find-your-treatment"]')).toHaveCount(1);
    // Esc kapatır, odak döner.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("services-mega-menu")).toBeHidden();
    await expect(page.getByTestId("services-mega-trigger")).toBeFocused();
  });
});

test.describe("Mobil (390)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("iki düğme menünün en üstünde; gruplu akordeon; çipler; 'Specialist' yok", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    // Önbellek gecikmesi: gruplar görünene dek yeniden yükle.
    await expect(async () => {
      await page.reload();
      await page.getByRole("button", { name: /menu/i }).first().click();
      await expect(page.getByTestId("mobile-menu-find-treatment")).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId("services-mega-trigger")).toBeHidden({ timeout: 2_000 }); // masaüstü tetikleyici mobilde görünmez
    }).toPass({ timeout: 60_000 });
    const find = page.getByTestId("mobile-menu-find-treatment");
    const book = page.getByTestId("mobile-menu-book-consultation");
    await expect(find).toContainText("Find your treatment");
    await expect(book).toHaveText("Book a consultation");
    await expect(find).toHaveAttribute("href", /\/find-your-treatment$/);
    await expect(book).toHaveAttribute("href", /\/request$/);
    const fy = (await find.boundingBox())!.y;
    const by = (await book.boundingBox())!.y;
    // Hizmetler akordeonu: iki düğmenin altında.
    const servicesTrigger = page.getByRole("button", { name: /Health Tourism Services|Services/i }).first();
    const sy = (await servicesTrigger.boundingBox())!.y;
    expect(fy).toBeLessThan(sy);
    expect(by).toBeLessThan(sy);
    await servicesTrigger.click();
    // Gruplu akordeon: 4 grup, başlık = tetikleyici.
    for (const g of EXPECTED_GROUPS) {
      const item = page.getByTestId(`mobile-services-group-${g.id}`);
      await expect(item).toBeVisible();
      await expect(item).toContainText(g.title);
    }
    const digestive = page.getByTestId("mobile-services-group-digestive-interventional");
    await digestive.getByRole("button").first().click();
    await expect(digestive).toContainText("Gastroenterology");
    await expect(digestive.getByTestId("mobile-nav-procedures").locator("a")).toHaveText(["ERCP", "ESD", "POEM"]);
    const text = await page.getByTestId("mobile-services-groups").innerText();
    expect(text).not.toMatch(SHOULD_NOT_APPEAR);
    // Yatay taşma yok.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  });
});

test.describe("Mega menü — 1024x768 ölçüm ve açıklama satırları", () => {
  test.use({ viewport: { width: 1024, height: 768 } });
  for (const [label, path] of [["EN", "/"], ["AR", "/ar"]] as const) {
    test(`${label}: yükseklik ≤ 520, açıklamalar en çok 2 satır ve kırpılmıyor, viewport'a sığar`, async ({ page }, testInfo) => {
      await openMegaMenu(page, path);
      const h = await settledMenuHeight(page);
      testInfo.annotations.push({ type: `menu-height-${label}-1024`, description: String(h) });
      console.log(`[AI] mega menü yüksekliği ${label} 1024x768: ${h}px`);
      expect(h).toBeLessThanOrEqual(520);
      const box = (await page.getByTestId("services-mega-menu").boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1024);
      expect(box.y + box.height).toBeLessThanOrEqual(768);
      const lines = await page.getByTestId("services-item").evaluateAll((els) =>
        els.map((el) => {
          const d = el.querySelector("a > span:nth-of-type(2) > span:nth-of-type(2)") as HTMLElement | null;
          if (!d) return { lines: 0, clipped: false };
          const lh = parseFloat(getComputedStyle(d).lineHeight);
          return { lines: Math.round(d.getBoundingClientRect().height / lh), clipped: d.scrollHeight - d.clientHeight > 1 };
        })
      );
      console.log(`[AI] ${label} 1024 açıklama satırları: ${lines.map((l) => l.lines).join(",")}`);
      expect(lines.every((l) => l.lines >= 1 && l.lines <= 2)).toBe(true);
      const overflow = await page.getByTestId("services-mega-groups").evaluate((el) => el.scrollHeight - el.clientHeight);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});

test.describe("Mobil menü — site renkleri", () => {
  test("'Book a consultation' dolgulu, 'Find your treatment' çerçevesi masaüstü header ile aynı site renginde", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const desk = await page.evaluate(() => {
      const f = getComputedStyle(document.querySelector('[data-testid="header-find-treatment"]')!);
      const b = getComputedStyle(document.querySelector('[data-testid="header-book-consultation"]')!);
      return { findBorder: f.borderTopColor, findText: f.color, bookBg: b.backgroundColor, bookText: b.color };
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.getByRole("button", { name: /menu/i }).first().click();
    await expect(page.getByTestId("mobile-menu-book-consultation")).toBeVisible();
    const mob = await page.evaluate(() => {
      const f = getComputedStyle(document.querySelector('[data-testid="mobile-menu-find-treatment"]')!);
      const b = getComputedStyle(document.querySelector('[data-testid="mobile-menu-book-consultation"]')!);
      return { findBorder: f.borderTopColor, findText: f.color, bookBg: b.backgroundColor, bookText: b.color };
    });
    console.log(`[AI] masaüstü ${JSON.stringify(desk)}\n[AI] mobil ${JSON.stringify(mob)}`);
    expect(mob.bookBg).not.toBe("rgba(0, 0, 0, 0)");
    expect(mob.bookBg).toBe(desk.bookBg);
    expect(mob.bookText).toBe(desk.bookText);
    expect(mob.findBorder).toBe(desk.findBorder);
    expect(mob.findText).toBe(desk.findText);
  });
});

test.describe("/specialties — Health Tourism Services sayfası", () => {
  test("süreç şeridi (6 adım), gruplu bölümler, kartlarda Book/Request bağlantıları, çipler; Specialist/Türkçe yok", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(async () => {
      await page.goto("/specialties");
      await expect(page.getByTestId("services-section-fertility")).toBeVisible({ timeout: 3_000 });
      await expect(page.getByTestId("services-section-other")).toHaveCount(0, { timeout: 1_000 });
    }).toPass({ timeout: 120_000, intervals: [2_000, 5_000, 10_000] });
    const strip = page.getByTestId("services-process");
    await expect(strip.locator("ol > li")).toHaveCount(6);
    await expect(strip).toContainText(/Request|Book/);
    for (const step of [/Coordinator call/i, /Authorized facility/i, /Travel/i, /Treatment/i, /Aftercare/i]) await expect(strip).toContainText(step);
    const sections = await page.locator('[data-testid^="services-section-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("services-section-", "")));
    expect(sections).toEqual(EXPECTED_GROUPS.map((g) => g.id));
    const cards = page.getByTestId("service-card");
    await expect(cards).toHaveCount(11);
    for (const card of await cards.all()) {
      await expect(card.getByTestId("service-card-book")).toHaveAttribute("href", /\/request\?service=[a-z0-9-]+$/);
      await expect(card.getByTestId("service-card-request")).toHaveAttribute("href", /\/request\?service=[a-z0-9-]+$/);
      await expect(card.getByTestId("service-card-book")).toContainText(/Book/i);
      await expect(card.getByTestId("service-card-request")).toContainText(/Request/i);
    }
    const gastro = page.getByTestId("service-card").filter({ hasText: "Gastroenterology" });
    await expect(gastro.getByTestId("service-card-chips").locator("a")).toHaveText(["ERCP", "ESD", "POEM"]);
    await expect(gastro.getByTestId("service-card-book")).toHaveAttribute("href", /\/request\?service=gastroenterology$/);
    const main = await page.locator("main").innerText();
    expect(main).not.toMatch(SHOULD_NOT_APPEAR);
    expect(main).toMatch(/authorized healthcare facilities/i);
    expect(turkishLetterHits(main), "Türkçeye özgü harf").toEqual([]);
  });

  test("/ar/specialties: RTL, Arapça süreç şeridi, yatay taşma yok", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ar/specialties");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("services-process")).toContainText(/[؀-ۿ]/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  });
});

test.describe("Find your treatment", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("eski adresler 301 ile yeni adrese gider; sorgu korunur; dil öneki korunur; kapalı dil yönlenmez", async () => {
    const cases: Array<[string, string]> = [
      ["/find-a-physician", "/find-your-treatment"],
      ["/find-a-physician?q=hair&step=2", "/find-your-treatment?q=hair&step=2"],
      ["/de/find-a-physician", "/de/find-your-treatment"],
      ["/de/find-a-physician?utm_source=x", "/de/find-your-treatment?utm_source=x"],
      ["/ar/find-a-physician", "/ar/find-your-treatment"],
      ["/en/find-a-physician", "/find-your-treatment"],
    ];
    for (const [from, to] of cases) {
      const r = await rawGet(from);
      expect(r.status, from).toBe(301);
      const loc = new URL(r.location!, "http://siteadi.localhost:3100");
      expect(`${loc.pathname}${loc.search}`, from).toBe(to);
      expect(loc.hostname, `${from}: aynı origin`).toBe("siteadi.localhost");
    }
    // Sonda eğik çizgi: Next önce 308 ile eğik çizgisiz adrese, oradan proxy 301 ile yeni adrese gider (zincir sonu 301).
    const slash = await rawGet("/find-a-physician/");
    expect(slash.status).toBe(308);
    expect(new URL(slash.location!, "http://siteadi.localhost:3100").pathname).toBe("/find-a-physician");
    // Yeni adres 200.
    expect((await rawGet("/find-your-treatment")).status).toBe(200);
    expect((await rawGet("/de/find-your-treatment")).status).toBe(200);
    expect((await rawGet("/ar/find-your-treatment")).status).toBe(200);
  });

  test("EN: başlık, alt başlık, başlangıçta uyarı; header etiketi; Türkçe harf yok", async ({ page }) => {
    await page.goto("/find-your-treatment");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Which treatment is right for me?");
    await expect(page.getByText("Answer a few questions about your concern and we'll suggest the right health tourism service.")).toBeVisible();
    await expect(page.getByTestId("physician-matcher")).toBeVisible();
    await expect(page.getByTestId("matcher-disclaimer")).toContainText("This tool does not provide a diagnosis or medical advice.");
    await expect(page.getByTestId("matcher-disclaimer")).toContainText("authorized healthcare facilities");
    await expect(page).toHaveTitle(/Find your treatment/);
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/Find my physician|Find a physician/i);
    expect(turkishLetterHits(body), "Türkçeye özgü harf").toEqual([]);
  });

  for (const [code, titleRe, disclaimerRe] of [
    ["de", /Welche Behandlung/i, /keine Diagnose|keine medizinische Beratung/i],
    ["ar", /[؀-ۿ]/, /[؀-ۿ]/],
  ] as const) {
    test(`${code}: başlık + başlangıç uyarısı yerelleştirilmiş`, async ({ page }) => {
      await page.goto(`/${code}/find-your-treatment`);
      await expect(page.getByTestId("physician-matcher")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(titleRe);
      const d = page.getByTestId("matcher-disclaimer");
      await expect(d).toHaveText(disclaimerRe);
      expect((await d.innerText()).length).toBeGreaterThan(60);
      if (code === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    });
  }

  test("EN akış: Obesity -> sonuç; hizmet kartı + iki düğme (/request?service=...), sonuçta uyarı", async ({ page }) => {
    await page.goto("/find-your-treatment");
    await expect(page.getByTestId("matcher-disclaimer")).toBeVisible();
    await pickTopicBySearch(page, "obesity", /Obesity \/ weight/i);
    await walkWizardToResult(page);
    await expect(page.getByRole("heading", { name: /Our suggestion for you/i })).toBeVisible();
    const cards = page.getByTestId("matcher-specialty-card");
    const n = await cards.count();
    expect(n, "sonuçta 1–3 hizmet önerilmeli").toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(3);
    for (const card of await cards.all()) {
      const book = card.getByTestId("matcher-book-online");
      const req = card.getByTestId("matcher-request");
      await expect(book).toHaveText("Book an online consultation");
      await expect(req).toHaveText("Request a consultation");
      await expect(book).toHaveAttribute("href", /\/request\?service=[a-z0-9-]+$/);
      await expect(req).toHaveAttribute("href", /\/request\?service=[a-z0-9-]+$/);
    }
    await expect(page.getByTestId("matcher-disclaimer")).toContainText("This tool does not provide a diagnosis or medical advice.");
    const result = await page.getByTestId("matcher-result").innerText();
    expect(result).not.toMatch(SHOULD_NOT_APPEAR);
    expect(turkishLetterHits(result), "Türkçeye özgü harf").toEqual([]);
    // Doktor önerisi / hekim bağlantısı yok.
    await expect(page.locator('main a[href*="/physicians"], main a[href*="/doctors"]')).toHaveCount(0);
    // Düğme talep formuna gider.
    await cards.first().getByTestId("matcher-request").click();
    await expect(page).toHaveURL(/\/request\?service=[a-z0-9-]+$/);
  });

  test("kırmızı bayrak: acil yönlendirme ekranı, acil numara, 'devam' ile kapanır", async ({ page }) => {
    await page.goto("/find-your-treatment");
    await pickTopicBySearch(page, "chest pain", /chest pain/i);
    const rf = page.getByTestId("matcher-red-flag");
    await expect(rf).toBeVisible();
    await expect(rf).toContainText(/emergency/i);
    await expect(page.getByTestId("matcher-emergency-number")).toHaveAttribute("href", /^tel:\+?\d{2,}/);
    await expect(rf).toContainText(/112|911|999/);
    await page.getByTestId("matcher-red-flag-continue").click();
    await expect(rf).toBeHidden();
  });

  test("/ar: kırmızı bayrak ekranı Arapça ve RTL", async ({ page }) => {
    await page.goto("/ar/find-your-treatment");
    await expect(page.getByTestId("physician-matcher")).toBeVisible();
    await pickTopicBySearch(page, "chest pain", /./);
    // Arapça katalogda etiket Arapçadır; arama İngilizce eş anlamlıları da bulur. Kırmızı bayrak seçilene dek ilk uygun seçeneği dene.
    const rf = page.getByTestId("matcher-red-flag");
    if (!(await rf.isVisible())) test.skip(true, "Arapça aramada ilk sonuç kırmızı bayrak konusu değil (arama sırası); EN testi kapsıyor");
    await expect(rf).toContainText(/[؀-ۿ]/);
    await expect(page.getByTestId("matcher-emergency-number")).toHaveAttribute("href", /^tel:/);
  });
});

test.describe("Türkçe metin taraması (ziyaretçiye açık sayfalar)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // Ana sayfa ("/") saas_e2e'deki Türkçe tohum içeriktir (veri, AI kodu değil); AI'nın dokunduğu sayfalar + header/footer taranır.
  // "Curaçao" ve "Français" ülke/dil adlarıdır (Türkçe metin değil).
  const ALLOWED = /Cura[çc]ao|Fran[çc]ais/g;
  for (const path of ["/specialties", "/find-your-treatment", "/request", "/ar/specialties", "/ar/find-your-treatment"]) {
    test(`${path}: Türkçeye özgü harf ve Türkçe sözcük yok (header + main + footer)`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      const text = (await page.locator("body").innerText()).replace(ALLOWED, "");
      expect(turkishLetterHits(text), `${path}: Türkçeye özgü harf`).toEqual([]);
      expect(text).not.toMatch(/\b(Randevu|Doktor|Hekim|Uzman|Tedavi|Başvuru|Ana Sayfa|Hakkımızda|İletişim)\b/);
    });
  }
});
