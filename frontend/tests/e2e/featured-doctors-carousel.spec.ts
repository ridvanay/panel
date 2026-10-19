import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession, createPageWithBlocks, deletePagePermanently } from "./support/api";
import {
  createAdminDoctorFixture,
  deleteAdminDoctorFixture,
  ensureTelehealthModuleWithDoctors,
  type CreatedFixtureDoctor,
} from "./support/telehealth-fixtures";

/**
 * Paket D (2026-10-19) — "Öne Çıkan Doktorlar" eşit kartlar + carousel. Kısa ve uzun isimli
 * doktorlar yan yana iken 1440px ve 375px'te kart yükseklikleri ve uzmanlık satırlarının üst
 * kenarı piksel farkı 0 olmalı. Ekran görüntüleri `test-results/` altına yazılır.
 */
test.describe.configure({ mode: "serial", retries: 1 });
test.setTimeout(480_000);

const FRONTEND_URL = process.env.E2E_FRONTEND_URL ?? "http://localhost:3100";
const SUFFIX = `${Date.now().toString(36)}${Math.floor(Math.random() * 46_656).toString(36)}`;

let adminToken: string;
const doctors: CreatedFixtureDoctor[] = [];
const pageIds: string[] = [];
let gridSlug = "";
let carouselSlug = "";

function featuredBlock(id: string, data: Record<string, unknown>) {
  return {
    id: `c-${id}`,
    type: "container",
    settings: {},
    children: [
      {
        id,
        type: "featured-doctors",
        data: { content: { tr: { title: "Öne Çıkan Doktorlar" }, en: { title: "Featured Doctors" } }, showAllButton: true, ...data },
      },
    ],
  };
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  adminToken = (await getCachedAdminSession()).accessToken;
  await ensureTelehealthModuleWithDoctors(adminToken);
  const base = { bio: "E2E", languages: ["tr"], timeZone: "Europe/Istanbul", sessionDurationMin: 30, sessionPriceCents: 10_000, isActive: true };
  doctors.push(
    await createAdminDoctorFixture(adminToken, {
      ...base,
      title: "Op. Dr.",
      fullName: `Hasan Tuna TÜRKMEN Uzunisimoğlu ${SUFFIX}`,
      subSpecialty: "Gynecologic Oncology Surgery Specialist and Minimally Invasive Surgery",
    }),
    await createAdminDoctorFixture(adminToken, { ...base, title: "Dr.", fullName: `Ali ${SUFFIX}`, subSpecialty: "Orthopedics" })
  );
  const grid = await createPageWithBlocks(adminToken, {
    title: `Featured grid ${SUFFIX}`,
    slug: `fd-grid-${SUFFIX}`,
    status: "PUBLISHED",
    blocks: [featuredBlock("fd-grid", { doctorIds: doctors.map((d) => d.id), columns: 4 })],
  });
  const carousel = await createPageWithBlocks(adminToken, {
    title: `Featured carousel ${SUFFIX}`,
    slug: `fd-carousel-${SUFFIX}`,
    status: "PUBLISHED",
    blocks: [featuredBlock("fd-carousel", { layout: "carousel", source: "all" })],
  });
  pageIds.push(grid.id as string, carousel.id as string);
  gridSlug = grid.slug as string;
  carouselSlug = carousel.slug as string;
});

test.afterAll(async () => {
  for (const id of pageIds) await deletePagePermanently(adminToken, id);
  for (const doctor of doctors) await deleteAdminDoctorFixture(adminToken, doctor.id);
});

async function measureCards(page: Page) {
  const cards = page.locator(".featured-doctors a:has(.featured-doctor-name)");
  return cards.evaluateAll((elements) =>
    elements.map((el) => {
      const card = el.getBoundingClientRect();
      const specialty = el.querySelector(".featured-doctor-specialty")!.getBoundingClientRect();
      return { name: el.getAttribute("aria-label"), height: Math.round(card.height * 100) / 100, specialtyOffset: Math.round((specialty.top - card.top) * 100) / 100 };
    })
  );
}

async function openAndMeasure(page: Page, slug: string, expectedNames: string[]) {
  await expect(async () => {
    await page.goto(`${FRONTEND_URL}/${slug}`);
    const names = (await measureCards(page)).map((c) => c.name ?? "");
    for (const expected of expectedNames) expect(names.some((n) => n.includes(expected))).toBe(true);
  }).toPass({ timeout: 240_000, intervals: [2_000, 5_000] });
  return measureCards(page);
}

for (const width of [1440, 375]) {
  test(`kartlar ${width}px'te eşit yükseklikte (ızgara + carousel)`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const expectedNames = [`Uzunisimoğlu ${SUFFIX}`, `Ali ${SUFFIX}`];

    for (const [layout, slug] of [
      ["grid", gridSlug],
      ["carousel", carouselSlug],
    ] as const) {
      const cards = await openAndMeasure(page, slug, expectedNames);
      const heights = cards.map((c) => c.height);
      const offsets = cards.map((c) => c.specialtyOffset);
      const report = { layout, width, cards: cards.length, heightDiff: Math.max(...heights) - Math.min(...heights), specialtyOffsetDiff: Math.max(...offsets) - Math.min(...offsets), cardsDetail: cards };
      await testInfo.attach(`olcum-${layout}-${width}.json`, { body: JSON.stringify(report, null, 2), contentType: "application/json" });
      console.log(`[featured-doctors] ${JSON.stringify({ ...report, cardsDetail: undefined })}`);
      expect(report.heightDiff).toBe(0);
      expect(report.specialtyOffsetDiff).toBe(0);

      const section = page.locator(".featured-doctors").first();
      await section.scrollIntoViewIfNeeded();
      await section.screenshot({ path: testInfo.outputPath(`featured-doctors-${layout}-${width}.png`) });

      if (layout === "carousel") {
        const region = page.getByRole("region", { name: /Öne Çıkan Doktorlar|Featured Doctors/ });
        await expect(region).toHaveAttribute("aria-roledescription", "carousel");
        const next = page.getByRole("button", { name: /Sonraki doktorlar|Next doctors/ });
        const previous = page.getByRole("button", { name: /Önceki doktorlar|Previous doctors/ });
        await expect(next).toBeVisible();
        await expect(previous).toBeDisabled();
        await next.click();
        await expect(previous).toBeEnabled();
      }
    }
  });
}
