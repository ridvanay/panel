import path from "node:path";
import { mkdirSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession } from "./support/api";
import {
  assertAiState,
  deactivateNonAiSpecialties,
  ensureTopicServiceLinks,
  pickTopicBySearch,
  reactivateSpecialties,
  walkWizardToResult,
} from "./support/ai-services-fixtures";

/**
 * qa-agent — Paket AI ekran görüntüleri (EN + AR; masaüstü 1440, mobil 390).
 * Yalnızca `AI_SHOTS=1` ile koşar (normal e2e koşusunda atlanır). Çıktı: docs/prompts/2026-11-02-AI-ekran/.
 * Ad biçimi: <dil>-<masaustu|mobil>-NN-<sayfa>.png. saas_e2e'deki eski fixture uzmanlıkları (kardiyoloji-N vb.) yalnızca
 * görüntü süresince pasife alınır ve sonunda GERİ AÇILIR.
 */
test.skip(process.env.AI_SHOTS !== "1", "AI_SHOTS=1 ile koşar");
test.use({ navigationTimeout: 120_000, actionTimeout: 20_000 });
test.describe.configure({ mode: "serial" });

const OUT = path.resolve(__dirname, "../../../docs/prompts/2026-11-02-AI-ekran");
const LANGS = [
  { code: "en", prefix: "", topic: /Obesity \/ weight/i, redFlagQuery: "chest pain" },
  { code: "ar", prefix: "/ar", topic: /./, redFlagQuery: "chest pain" },
] as const;
const DEVICES = [
  { name: "masaustu", width: 1440, height: 900 },
  { name: "mobil", width: 390, height: 844 },
] as const;

let token = "";
let deactivated: string[] = [];

test.beforeAll(async () => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });
  token = (await getCachedAdminSession()).accessToken;
  await assertAiState();
  await ensureTopicServiceLinks(token);
  deactivated = await deactivateNonAiSpecialties(token);
});

test.afterAll(async () => {
  test.setTimeout(240_000);
  await reactivateSpecialties(token, deactivated);
});

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  await page.waitForTimeout(500);
}
async function shot(page: Page, name: string, fullPage: boolean) {
  await settle(page);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
}

/** Önbellek (60 sn ISR) bayatsa yeniden yükleyerek 'Other' grubunun kalkmasını bekler. */
async function waitFreshServices(page: Page, url: string, testId: string) {
  await expect(async () => {
    await page.goto(url);
    await expect(page.getByTestId(testId)).toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId(testId.replace("fertility", "other"))).toHaveCount(0, { timeout: 1_000 });
  }).toPass({ timeout: 120_000, intervals: [2_000, 5_000, 10_000] });
}

for (const lang of LANGS) {
  for (const device of DEVICES) {
    test.describe(`${lang.code} ${device.name}`, () => {
      test.use({ viewport: { width: device.width, height: device.height } });
      const prefix = `${lang.code}-${device.name}`;

      test("01 mega menü açık", async ({ page }) => {
        test.setTimeout(180_000);
        if (device.name === "masaustu") {
          await expect(async () => {
            await page.goto(`${lang.prefix || "/"}`);
            await page.getByTestId("services-mega-trigger").click();
            await expect(page.getByTestId("services-group-fertility")).toBeVisible({ timeout: 3_000 });
            await expect(page.getByTestId("services-group-other")).toHaveCount(0, { timeout: 1_000 });
          }).toPass({ timeout: 120_000, intervals: [2_000, 5_000, 10_000] });
          await page.waitForTimeout(400);
          const box = (await page.getByTestId("services-mega-menu").boundingBox())!;
          console.log(`[AI] ${prefix} menü yüksekliği: ${Math.round(box.height)}px`);
          expect(box.height).toBeLessThanOrEqual(520);
          await shot(page, `${prefix}-01-mega-menu`, false);
        } else {
          await expect(async () => {
            await page.goto(`${lang.prefix || "/"}`);
            await page.getByRole("button", { name: /menu|القائمة|قائمة/i }).first().click();
            await expect(page.getByTestId("mobile-menu-find-treatment")).toBeVisible({ timeout: 5_000 });
          }).toPass({ timeout: 120_000, intervals: [2_000, 5_000] });
          // Hizmetler akordeonunu ve bir grubu aç (çipler görünsün).
          const sheet = page.getByTestId("mobile-menu-find-treatment").locator("xpath=ancestor::*[@role='dialog'][1]");
          await sheet.getByRole("button", { name: /Health Tourism Services|Services|خدمات/i }).first().click();
          await expect(page.getByTestId("mobile-services-group-digestive-interventional")).toBeVisible({ timeout: 60_000 });
          await page.getByTestId("mobile-services-group-digestive-interventional").getByRole("button").first().click();
          await expect(page.getByTestId("mobile-nav-procedures")).toBeVisible();
          await shot(page, `${prefix}-01-mega-menu`, false);
        }
      });

      test("02 Health Tourism Services sayfası", async ({ page }) => {
        test.setTimeout(180_000);
        await waitFreshServices(page, `${lang.prefix}/specialties`, "services-section-fertility");
        await shot(page, `${prefix}-02-hizmetler-sayfasi`, true);
      });

      test("03 Find your treatment başlangıç", async ({ page }) => {
        await page.goto(`${lang.prefix}/find-your-treatment`);
        await expect(page.getByTestId("physician-matcher")).toBeVisible();
        await expect(page.getByTestId("matcher-disclaimer")).toBeVisible();
        await shot(page, `${prefix}-03-find-your-treatment-baslangic`, true);
      });

      test("04 Find your treatment sonuç", async ({ page }) => {
        test.setTimeout(120_000);
        await page.goto(`${lang.prefix}/find-your-treatment`);
        await expect(page.getByTestId("physician-matcher")).toBeVisible();
        await pickTopicBySearch(page, "obesity", lang.topic);
        await walkWizardToResult(page);
        await expect(page.getByTestId("matcher-specialty-card").first()).toBeVisible();
        await shot(page, `${prefix}-04-find-your-treatment-sonuc`, true);
      });

      test("05 Find your treatment kırmızı bayrak", async ({ page }) => {
        await page.goto(`${lang.prefix}/find-your-treatment`);
        await expect(page.getByTestId("physician-matcher")).toBeVisible();
        await pickTopicBySearch(page, lang.redFlagQuery, /./);
        await expect(page.getByTestId("matcher-red-flag")).toBeVisible();
        await shot(page, `${prefix}-05-find-your-treatment-kirmizi-bayrak`, false);
      });
    });
  }
}
