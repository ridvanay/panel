import { test, expect } from "@playwright/test";
import { getCachedAdminSession } from "./support/api";
import {
  ensureTelehealthModuleWithDoctors,
  listAllAdminDoctors,
  getAdminEmergencyNotice,
  patchAdminEmergencyNotice,
  type FixtureEmergencyNoticeSettings,
} from "./support/telehealth-fixtures";

/**
 * Acil durum uyarısı (feature/emergency-notice): admin anahtarı YALNIZCA header altındaki şeridi
 * kontrol eder; doktor detay sayfasındaki kart her zaman TAM metinle görünür. Şerit KAPALI (özet)
 * başlar, "Ayrıntılar" düğmesiyle tam metne geçer. `SiteModule.settings` GLOBAL olduğu için ayar
 * `finally`'de MUTLAKA orijinaline döner. Public sayfalar 60 sn ISR — iddialar `toPass` + reload ile.
 */
test.describe.configure({ mode: "serial" });

let adminToken: string;
let doctorSlug: string;
let original: FixtureEmergencyNoticeSettings;

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(90_000);
  adminToken = (await getCachedAdminSession()).accessToken;
  await ensureTelehealthModuleWithDoctors(adminToken);
  const doctors = await listAllAdminDoctors(adminToken);
  if (doctors.length === 0) throw new Error("qa-agent: telehealth-clinic demo doktoru bulunamadı.");
  doctorSlug = doctors[0]!.slug;
  original = await getAdminEmergencyNotice(adminToken);
});

test.afterAll(async () => {
  await patchAdminEmergencyNotice(adminToken, {
    enabled: original.enabled,
    summary: { tr: original.summary.tr ?? null, en: original.summary.en ?? null },
    full: { tr: original.full.tr ?? null, en: original.full.en ?? null },
  });
});

test("şerit açıkken kapalı (özet) başlar ve Ayrıntılar ile tam metne geçer", async ({ page }) => {
  test.setTimeout(120_000);
  await patchAdminEmergencyNotice(adminToken, { enabled: true });

  const strip = page.locator(".telehealth-scope > [role=note]");
  await expect(async () => {
    await page.goto("/doctors", { waitUntil: "domcontentloaded" });
    await expect(strip).toBeVisible();
  }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });

  const button = strip.getByRole("button");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  const summaryText = await strip.locator("p").innerText();
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(strip.locator("p")).not.toHaveText(summaryText);
  const box = await button.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

test("anahtar kapalıyken doktorlar sayfasında şerit yok; görüşme ekranı şeridi ve doktor detay kartı yine görünür", async ({ page }) => {
  test.setTimeout(150_000);
  await patchAdminEmergencyNotice(adminToken, { enabled: false });

  await expect(async () => {
    await page.goto("/doctors", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".telehealth-scope")).toBeVisible();
    await expect(page.locator(".telehealth-scope > [role=note]")).toHaveCount(0);
  }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });

  await page.goto(`/doctors/${doctorSlug}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".telehealth-scope > [role=note]")).toHaveCount(0);
  const card = page.locator("main [role=note]").first();
  await expect(card).toBeVisible();
  await expect(card.getByRole("button")).toHaveCount(0);
  // Görüşme ekranı (`/consultation/*`) şeridi anahtardan BAĞIMSIZ — geçersiz oda kimliğinde bile
  // layout render edilir, şerit kapalı (özet) hâlde görünür.
  await page.goto("/consultation/e2e-emergency-notice", { waitUntil: "domcontentloaded" });
  const consultationStrip = page.locator("[role=note]").filter({ has: page.getByRole("button", { expanded: false }) }).first();
  await expect(consultationStrip).toBeVisible();
});

test("EN/TR metinde zorunlu kelime yoksa 422", async () => {
  await expect(patchAdminEmergencyNotice(adminToken, { summary: { en: "Please call your doctor first." } })).rejects.toThrow(/422/);
  await expect(patchAdminEmergencyNotice(adminToken, { full: { tr: "Bu platform tıbbi bakımın yerine geçmez, doktorunuza danışın." } })).rejects.toThrow(/422/);
});
