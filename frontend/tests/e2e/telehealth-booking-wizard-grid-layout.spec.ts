import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession, getSiteModules, patchSiteModule } from "./support/api";
import {
  ensureTelehealthModuleWithDoctors,
  createAdminDoctorFixture,
  deleteAdminDoctorFixture,
  setDoctorAvailabilityRaw,
  type CreatedFixtureDoctor,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — orkestratörün doğrudan görev talimatı (bu tur, CLAUDE.md standart akışından BAĞIMSIZ
 * daraltılmış akış: frontend-agent → qa-agent, ACİL UI düzeltmesi, backend YOK): `/doctors/[slug]`
 * randevu sihirbazının Adım 2'sinin ("Tarih & Saat") `max-w-5xl` → `max-w-7xl` konteyner genişlemesi
 * + `booking-wizard.tsx`/`availability-calendar.tsx`'in TEK `lg:grid-cols-12` dış gride BİRLEŞMESİ
 * (takvim `lg:col-span-4` + slot `lg:col-span-5` + Hizmet Özeti `lg:col-span-3`) + slot kartının
 * `max-h-[460px] overflow-y-auto` kapsüllemesi e2e doğrulaması.
 *
 * `telehealth-booking-wizard.spec.ts`/`telehealth-doctor-profile-redesign.spec.ts`'in kendi İZOLE
 * fixture doktor deseni (`createAdminDoctorFixture` + `setDoctorAvailabilityRaw`, haftanın HER günü
 * geniş/tam pencere) ÖRNEK alınır — YENİDEN İCAT EDİLMEZ; paylaşımlı `telehealth-clinic` demo
 * verisine BAĞIMLI DEĞİL.
 *
 * Kapsam (görev talimatının qa maddesiyle BİREBİR):
 *   1) Masaüstü (1920x1080 VE 1440x900) — ana içerik konteyneri (`max-w-7xl`) eski `max-w-5xl`
 *      (1024px) DEĞERİNDEN BELİRGİN ŞEKİLDE geniş (~1280px, `boundingBox()` ile ölçülür — viewport
 *      1920 olsa BİLE `max-w-7xl` onu sınırlar, bu BEKLENEN, sonsuz genişleme DEĞİL); takvim
 *      (`lg:col-span-4`)/slot (`lg:col-span-5`)/Hizmet Özeti (`lg:col-span-3`) kartlarının ÜÇÜ DE
 *      AYNI satırda, taşma OLMADAN, sırayla artan x-koordinatlarıyla render olur.
 *   2) Slot kartı (`max-h-[460px] overflow-y-auto`) KENDİ İÇİNDE scroll üretir (çok sayıda müsait
 *      saati olan yoğun bir gün seçilerek), SAYFA (`body.scrollHeight`) toplam yüksekliğini
 *      ORANTISIZ şişirmez; bir slota tıklandığında sağ "Hizmet Özeti" panelindeki seçili slot
 *      rozeti ANINDA (yeniden yükleme/gecikme OLMADAN) güncellenir.
 */
test.describe.configure({ mode: "serial" });

const RUN_SUFFIX = Date.now().toString(36);
let adminToken: string;
let initialTelehealthEnabled: boolean;
let doctorFixture: CreatedFixtureDoctor;

/** `telehealth-booking-wizard.spec.ts::gotoAndWaitReady` İLE BİREBİR AYNI 75sn ISR toleransı. */
async function gotoAndWaitReady(page: Page, url: string, ready: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await ready();
  }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);

  doctorFixture = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `QA E2E Grid Duzeni Doktoru ${RUN_SUFFIX}`,
    bio: "qa-agent — booking wizard adım 2 grid/genişlik e2e fixture doktoru.",
    languages: ["tr"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: 40000,
    currency: "TRY",
    isVerified: true,
    isActive: true,
  });
  // `telehealth-booking-wizard.spec.ts` İLE AYNI desen — haftanın HER günü 00:00-24:00 (tam pencere),
  // madde 2'nin "yoğun bir gün" (20+ saat dilimi) senaryosu İÇİN gerekli.
  await setDoctorAvailabilityRaw(
    adminToken,
    doctorFixture.id,
    ([1, 2, 3, 4, 5, 6, 7] as const).map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }))
  );
});

test.afterAll(async () => {
  if (doctorFixture) await deleteAdminDoctorFixture(adminToken, doctorFixture.id).catch(() => undefined);
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

// =============================================================================
// madde 1 — masaüstü (1920x1080 VE 1440x900): konteyner genişlemesi + 3 kolonun AYNI satırda,
// taşma olmadan, sırayla dolduğu.
// =============================================================================
for (const { label, viewport } of [
  { label: "1920x1080", viewport: { width: 1920, height: 1080 } },
  { label: "1440x900", viewport: { width: 1440, height: 900 } },
]) {
  test(`madde 1: ${label} — max-w-7xl konteyner eski max-w-5xl'e (1024px) kıyasla belirgin geniş (~1280px), takvim/slot/Hizmet Özeti kartları AYNI satırda taşmadan render olur`, async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3100", viewport });
    const page = await context.newPage();
    try {
      await gotoAndWaitReady(page, `/doctors/${doctorFixture.slug}`, async () => {
        await expect(page.getByRole("heading", { name: "Müsaitlik ve Randevu" })).toBeVisible();
      });
      await page.waitForTimeout(500);

      const stepperBar = page.getByTestId("booking-stepper-bar");
      await expect(stepperBar).toBeVisible();

      // Ana içerik konteyneri — `.mx-auto.max-w-7xl` (hero bandının konteyneri İLE AYNI sınıflar,
      // ama sihirbazı SARAN, `has: stepperBar` ile TEKİL olarak hedeflenir).
      const mainContainer = page.locator("div.mx-auto.max-w-7xl", { has: stepperBar });
      await expect(mainContainer).toHaveCount(1);
      const containerBox = await mainContainer.boundingBox();
      expect(containerBox, "ana içerik konteyneri render olmalı").not.toBeNull();
      // `max-w-7xl` = 80rem = 1280px. Eski `max-w-5xl` (1024px) İLE KIYASLANDIĞINDA belirgin şekilde
      // geniş — viewport 1920 OLSA BİLE `max-w-7xl` onu sınırlar (BEKLENEN, sonsuz genişleme DEĞİL,
      // kriter ESKİ 1024px'e KIYASLA büzüşmeme).
      expect(containerBox!.width, "eski max-w-5xl (1024px)'in BELİRGİN üzerinde olmalı").toBeGreaterThan(1100);
      expect(containerBox!.width, "max-w-7xl (1280px) tavanını (+küçük tolerans) AŞMAMALI").toBeLessThanOrEqual(1290);

      // Üç kolon — takvim (`lg:col-span-4`), slot (`lg:col-span-5`), Hizmet Özeti (`aside.lg:col-span-3`).
      // Bu üç sınıf kombinasyonu `/doctors/[slug]` dışında (`doctor-bookings-panel.tsx`/admin ayarları)
      // DA kullanılır ama bu sayfada BAŞKA render OLMADIKLARI için `.first()` GÜVENLİDİR.
      const calendarCol = page.locator('div[class*="lg:col-span-4"]').first();
      const slotCol = page.locator('div[class*="lg:col-span-5"]').first();
      const summaryCol = page.locator('aside[class*="lg:col-span-3"]').first();
      await expect(calendarCol).toBeVisible();
      await expect(slotCol).toBeVisible();
      await expect(summaryCol).toBeVisible();

      const [calendarBox, slotBox, summaryBox] = await Promise.all([
        calendarCol.boundingBox(),
        slotCol.boundingBox(),
        summaryCol.boundingBox(),
      ]);
      expect(calendarBox).not.toBeNull();
      expect(slotBox).not.toBeNull();
      expect(summaryBox).not.toBeNull();

      // AYNI satır — üçünün de üst kenarı (y) birbirine YAKIN (dış grid `lg:items-start`).
      expect(Math.abs(calendarBox!.y - slotBox!.y), "takvim/slot kartları AYNI satırda olmalı").toBeLessThan(60);
      expect(Math.abs(calendarBox!.y - summaryBox!.y), "takvim/Hizmet Özeti AYNI satırda olmalı").toBeLessThan(60);

      // Sırayla ARTAN x-koordinatları, taşma/çakışma YOK (her kolon bir SONRAKİNİN solunda biter).
      expect(calendarBox!.x + calendarBox!.width, "takvim kartı slot kartıyla ÇAKIŞMAMALI").toBeLessThanOrEqual(slotBox!.x + 1);
      expect(slotBox!.x + slotBox!.width, "slot kartı Hizmet Özeti ile ÇAKIŞMAMALI").toBeLessThanOrEqual(summaryBox!.x + 1);
    } finally {
      await context.close();
    }
  });
}

// =============================================================================
// madde 2 — slot kartının SAYFAYI dikeyde "patlatmaması" + slot seçiminin özet kartına ANINDA
// yansıması.
// =============================================================================
test('madde 2: yoğun bir gün seçildiğinde slot kartı KENDİ İÇİNDE scroll üretir (sayfa yüksekliği ORANTISIZ şişmez), slot seçimi "Hizmet Özeti" panelinde ANINDA yansır', async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3100", viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await gotoAndWaitReady(page, `/doctors/${doctorFixture.slug}`, async () => {
      await expect(page.getByRole("heading", { name: "Müsaitlik ve Randevu" })).toBeVisible();
    });
    await page.waitForTimeout(500);

    // Buffer/geçmiş kesintisinden ETKİLENMEYEN, GERÇEKTEN yoğun (tam gün açık fixture) bir günü
    // seçmek için takvimdeki müsait günlerden erken birkaçını (buffer'a en yakın, potansiyel olarak
    // KISMİ) ATLAR.
    const availableDays = page.getByRole("button", { name: /— müsait/ });
    const dayCount = await availableDays.count();
    expect(dayCount, "test için en az birkaç müsait gün gerekir").toBeGreaterThan(2);
    const targetIndex = Math.min(3, dayCount - 1);
    await availableDays.nth(targetIndex).click();

    const slotCard = page.locator('div[class*="max-h-[460px]"]');
    await expect(slotCard).toBeVisible();

    // Slot kartı İÇİNDEKİ TÜM saat pillerini sayar (müsait/seçili/dolu/geçmiş — hepsi `role=checkbox`
    // VEYA `aria-label`'lı `span`).
    const allSlotPills = slotCard.locator('[role="checkbox"], span[aria-label]');
    const slotCountOnDay = await allSlotPills.count();
    expect(slotCountOnDay, "yoğun bir gün en az 20+ saat dilimi göstermeli (tam gün açık fixture)").toBeGreaterThan(20);

    // Slot kartı KENDİ İÇİNDE taşar (`scrollHeight > clientHeight`) — SAYFANIN kendisi DEĞİL.
    const overflowsInternally = await slotCard.evaluate((el) => el.scrollHeight > el.clientHeight + 2);
    expect(overflowsInternally, "slot kartı max-h-[460px]/overflow-y-auto sayesinde KENDİ İÇİNDE scroll üretmeli").toBe(true);

    // Sayfa yüksekliği MAKUL kalır — 20+ slotun HAM (kapsüllenmemiş) render'ı olsaydı (~48 slot ×
    // ~40px satır + gruplama başlıkları) sayfa dikeyde belirgin şekilde daha fazla şişerdi; kapsülleme
    // sayesinde toplam `body.scrollHeight` bunun ALTINDA kalmalı (üst sınır, mevcut sayfa
    // bileşenlerinin — header/hero/tab/takvim kartı/footer — gerçek render'ı ÖLÇÜLEREK belirlendi).
    const bodyScrollHeight = await page.evaluate(() => document.body.scrollHeight);
    expect(bodyScrollHeight, "sayfa yüksekliği slot kartının içindeki saat sayısıyla ORANTISIZ şişmemeli").toBeLessThan(2400);

    // Bir slota tıklandığında sağ "Hizmet Özeti" panelindeki seçim ANINDA (yeniden yükleme/gecikme
    // OLMADAN) güncellenir.
    const firstAvailableCheckbox = slotCard.getByRole("checkbox", { name: /— müsait$/ }).first();
    await expect(firstAvailableCheckbox).toBeVisible();
    const slotLabel = await firstAvailableCheckbox.getAttribute("aria-label");
    const timeText = slotLabel!.replace(/ — müsait$/, "");

    const summaryPanel = page.locator("aside", { hasText: "Hizmet Özeti" });
    const selectedBox = summaryPanel
      .getByText("Seçilen Randevu", { exact: false })
      .locator("xpath=ancestor::div[contains(@class,'bg-muted/50')][1]");

    await expect(selectedBox.getByText("Tarih ve saatleri seçin")).toBeVisible();
    await firstAvailableCheckbox.click();
    // Kısa (1sn) bir `toBeVisible` zaman aşımı — "yeniden yükleme/gecikme YOK" iddiasını, uzun bir
    // varsayılan zaman aşımının maskeleyebileceği gizli bir gecikmeyi ELEMEK için KASITLI olarak sıkı
    // tutulur.
    await expect(selectedBox.getByText(timeText, { exact: false })).toBeVisible({ timeout: 1_000 });
    await expect(selectedBox.getByText("Tarih ve saatleri seçin")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
