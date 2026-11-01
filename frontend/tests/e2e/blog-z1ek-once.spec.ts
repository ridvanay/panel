import path from "node:path";
import { mkdirSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession } from "./support/api";
import { createCmsPage, deleteCmsPage, findAdminPageIdBySlug, setPageStatus } from "./support/blog-z1ek-fixtures";
import { SHOT_PAGES, shotBuilderBlocks, shotLegalBlocks } from "./support/blog-z1ek-shot-content";

/**
 * qa-agent — Paket Z1-ek "ONCE" ekran goruntuleri. SADECE `Z1EK_ONCE=1` ile ve checkout `origin/master` iken calistirilir
 * (guven sayfalari o zaman CMS kaydidir). On kosul: `backend/scripts/create-blog-trust-pages.ts` yerelde calistirilmis olmali
 * (DRAFT kayitlar). Test onlari PUBLISHED yapar, goruntuleri alir ve sonda KAYITLARI SILER (kendi olusturdugu fixture'lar dahil).
 * Eslesen "SONRA" goruntuleri blog-z1ek.spec.ts'in son testinde alinir.
 */
const BASE = process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100";
const SHOT_DIR = path.resolve(process.cwd(), "..", "docs", "prompts", "2026-11-01-Z1-ek-ekran");
const SIZES = [
  { key: "masaustu", width: 1440, height: 900 },
  { key: "mobil", width: 390, height: 844 },
] as const;

test.use({ navigationTimeout: 120_000, actionTimeout: 20_000 });
test.skip(process.env.Z1EK_ONCE !== "1", "Yalniz Z1EK_ONCE=1 ile (master checkout) calisir.");

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += 700) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(() => [...document.images].every((i) => i.complete), undefined, { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}

test("ONCE: master uzerinde hakkimizda, yasal sayfa, genel CMS sayfasi ve CMS kayitli iki guven sayfasi", async ({ browser }) => {
  test.setTimeout(600_000);
  const token = (await getCachedAdminSession()).accessToken;
  const created: string[] = [];
  const trustIds: string[] = [];
  try {
    for (const slug of [SHOT_PAGES.builder.slug, SHOT_PAGES.legal.slug]) {
      const old = await findAdminPageIdBySlug(token, slug);
      if (old) await deleteCmsPage(token, old);
    }
    created.push(
      (
        await createCmsPage(token, {
          title: SHOT_PAGES.builder.title.tr,
          slug: SHOT_PAGES.builder.slug,
          blocks: shotBuilderBlocks("tr"),
          translations: { en: { title: SHOT_PAGES.builder.title.en, blocks: shotBuilderBlocks("en") } },
        })
      ).id,
      (
        await createCmsPage(token, {
          title: SHOT_PAGES.legal.title.tr,
          slug: SHOT_PAGES.legal.slug,
          isLegalDocument: true,
          blocks: shotLegalBlocks("tr"),
          translations: { en: { title: SHOT_PAGES.legal.title.en, blocks: shotLegalBlocks("en") } },
        })
      ).id
    );

    for (const slug of ["content-standards", "medical-reviewers"]) {
      const id = await findAdminPageIdBySlug(token, slug);
      if (!id) throw new Error(`Guven sayfasi CMS kaydi yok (${slug}); once create-blog-trust-pages.ts calistirin.`);
      trustIds.push(id);
      await setPageStatus(token, id, "PUBLISHED");
    }

    mkdirSync(SHOT_DIR, { recursive: true });
    const pairs: [string, string][] = [
      ["hakkimizda", "/en/about"],
      ["yasal-sayfa", `/en/${SHOT_PAGES.legal.slug}`],
      ["genel-cms-sayfasi", `/en/${SHOT_PAGES.builder.slug}`],
      ["guven-sayfasi-icerik-standartlari", "/en/content-standards"],
      ["guven-sayfasi-yazarlar-ve-hekimler", "/en/medical-reviewers"],
    ];
    for (const size of SIZES) {
      const context = await browser.newContext({ baseURL: BASE, viewport: { width: size.width, height: size.height } });
      const page = await context.newPage();
      for (const [name, url] of pairs) {
        await expect(async () => {
          const res = await page.goto(url, { waitUntil: "domcontentloaded" });
          expect(res?.status()).toBe(200);
          await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 120_000, intervals: [1_000, 3_000, 5_000] });
        await settle(page);
        await page.addStyleTag({ content: "nextjs-portal{display:none !important}" });
        await page.screenshot({ path: path.join(SHOT_DIR, `once-sonra-${name}-en-${size.key}-ONCE.png`), fullPage: true, animations: "disabled" });
      }
      await context.close();
    }
  } finally {
    for (const id of [...created, ...trustIds]) await deleteCmsPage(token, id).catch(() => undefined);
  }
});
