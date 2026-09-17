import { test, expect, type Browser, type Page } from "@playwright/test";
import { authenticator } from "otplib";
import { getCachedAdminSession, getSiteModules, patchSiteModule, getFixtureUserToken, setupAndEnableTwoFactorForSelf, API_BASE_URL } from "./support/api";
import { resetFixtureUserToBaseline, adminGetUserByEmail } from "./support/admin-users-fixtures";
import {
  ensureTelehealthModuleWithDoctors,
  createAdminDoctorFixture,
  deleteAdminDoctorFixture,
  setDoctorAvailabilityRaw,
  linkDoctorUserRaw,
  createBookingRaw,
  getPublicDoctorSlotsRaw,
  defaultSlotRangeISODates,
  expirePendingBookingDirectly,
  type CreatedFixtureDoctor,
} from "./support/telehealth-fixtures";
import { submitBookingIdentityStep } from "./support/telehealth-identity-ui";

/**
 * qa-agent — orkestratörün doğrudan görev talimatı (bu tur, ui-designer → frontend-agent →
 * backend-agent → qa-agent daraltılmış akışı): `/doctors/[slug]`'ın TAMAMEN bir 5 adımlı
 * `<BookingStepperBar>` sihirbazına dönüştürülmesi (eski AYRI form + "Randevu Al" anchor + "Randevu
 * Oluştur" submit + `IdentityStepDialog` MODAL'ı + `BookingPostCreationFlow` — HEPSİ TEK
 * `booking-wizard.tsx`'te BİRLEŞTİ) + doktor konsolu (`/doctor`) kart tarih biçimi/hayalet-booking
 * backend düzeltmesi. Bu dosya görev talimatındaki 4 maddeyi kapsar:
 *   1) wizard adım geçişleri (stepper `data-status`, adım 2↔3 SERBEST geri/ileri, adım 4/5'te geri/
 *      ikinci "Devam Et" YOK)
 *   2) doktor konsolu kartında tam tarih formatı ("14 Eylül 2026, Pazartesi") + saat aralığı
 *   3) çift buton çakışmasının KALMADIĞI (masaüstü 1280px + mobil 375px, TEK "Devam Et")
 *   4) backend regresyonu — ödemesiz bırakılıp süresi dolan (`appointments: []`) "hayalet" booking
 *      `GET /doctor/bookings` varsayılan (scope=all, filtresiz) listesinden ARTIK SIZMIYOR;
 *      `?paymentStatus=EXPIRED` AÇIKÇA istenirse hâlâ (appointments:[] ile) dönüyor.
 *
 * `doctor-console-dashboard-layout.spec.ts`/`telehealth-multi-slot-booking.spec.ts`/
 * `telehealth-doctor-identity.spec.ts` İLE AYNI desenler (kendi İZOLE fixture doktoru + kendi-
 * kendine-servis 2FA + `createBookingRaw`/DB-doğrudan yardımcıları) YENİDEN İCAT EDİLMEDİ, ÖRNEK
 * ALINDI — paylaşımlı `telehealth-clinic` demo verisine BAĞIMLI DEĞİL.
 */
test.describe.configure({ mode: "serial" });

const FIXTURE_PASSWORD = "QaE2eBookingWizard12345!";
const RUN_SUFFIX = Date.now().toString(36);
const DOCTOR_USER_EMAIL = `qa-e2e-booking-wizard-doctor-${RUN_SUFFIX}@example.com`;

let adminToken: string;
let initialTelehealthEnabled: boolean;
let doctorFixture: CreatedFixtureDoctor;
let doctorUserToken: string;
let doctorTotpSecret: string;

/** `telehealth-public-booking.spec.ts::gotoAndWaitReady` İLE BİREBİR AYNI 60sn ISR toleransı. */
async function gotoAndWaitReady(page: Page, url: string, ready: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await ready();
  }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });
}

/** `telehealth-public-booking.spec.ts::selectAnyAvailableRadio` İLE AYNI ilke. */
async function selectAnyAvailableSlot(page: Page): Promise<void> {
  let checkbox = page.getByRole("checkbox", { name: /— müsait$/ }).first();
  if (await checkbox.isVisible().catch(() => false)) {
    await checkbox.click();
    return;
  }
  const availableDays = page.getByRole("button", { name: /— müsait/ });
  const count = await availableDays.count();
  for (let i = 0; i < count; i++) {
    await availableDays.nth(i).click();
    checkbox = page.getByRole("checkbox", { name: /— müsait$/ }).first();
    if (await checkbox.isVisible().catch(() => false)) {
      await checkbox.click();
      return;
    }
  }
  throw new Error("Takvimde görünür hiçbir günde müsait bir saat slotu bulunamadı.");
}

async function pickAvailableSlotIso(doctorSlug: string): Promise<string> {
  const { from, to } = defaultSlotRangeISODates(14);
  const slotsRes = await getPublicDoctorSlotsRaw(doctorSlug, from, to);
  const slot = (slotsRes.data ?? []).find((s) => s.available);
  if (!slot) throw new Error(`qa-agent: ${doctorSlug} için müsait slot bulunamadı.`);
  return slot.startsAt;
}

/** `doctor-console-dashboard-layout.spec.ts::loginDoctorWithTwoFactor` İLE AYNI desen. */
async function loginDoctorWithTwoFactor(browser: Browser, viewport = { width: 1280, height: 800 }): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3100", viewport });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(DOCTOR_USER_EMAIL);
  await page.getByLabel("Şifre").fill(FIXTURE_PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();

  await expect(page.getByText("İki adımlı doğrulama", { exact: false })).toBeVisible({ timeout: 15_000 });
  const code = authenticator.generate(doctorTotpSecret);
  await page.getByLabel("Authenticator Kodu").fill(code);
  await page.getByRole("button", { name: "Doğrula" }).click();

  await page.waitForURL(/\/doctor$/, { timeout: 15_000 });
  return { page, close: async () => context.close() };
}

async function cleanupFixtures() {
  await resetFixtureUserToBaseline(adminToken, DOCTOR_USER_EMAIL);
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  await cleanupFixtures();

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);

  doctorFixture = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `QA E2E Sihirbaz Doktoru ${RUN_SUFFIX}`,
    bio: "qa-agent — booking wizard/doktor konsolu kart/hayalet-booking e2e fixture doktoru.",
    languages: ["tr"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: 35000,
    currency: "TRY",
    isVerified: true,
    isActive: true,
  });
  await setDoctorAvailabilityRaw(
    adminToken,
    doctorFixture.id,
    ([1, 2, 3, 4, 5, 6, 7] as const).map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }))
  );

  doctorUserToken = await getFixtureUserToken(DOCTOR_USER_EMAIL, FIXTURE_PASSWORD, "QA E2E Sihirbaz Doktoru");
  const doctorUser = await adminGetUserByEmail(adminToken, DOCTOR_USER_EMAIL);
  if (!doctorUser) throw new Error("qa-agent: doktor fixture kullanıcısı oluşturulamadı.");
  await linkDoctorUserRaw(adminToken, doctorFixture.id, doctorUser.id);
  const twoFactor = await setupAndEnableTwoFactorForSelf(doctorUserToken);
  doctorTotpSecret = twoFactor.secret;
});

test.afterAll(async () => {
  await cleanupFixtures();
  if (doctorFixture) await deleteAdminDoctorFixture(adminToken, doctorFixture.id).catch(() => undefined);
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

// =============================================================================
// madde 1 — wizard adım geçişleri: stepper `data-status`, adım 2↔3 SERBEST geri/ileri, adım 4/5'te
// geri butonu/ikinci "Devam Et" YOK.
// =============================================================================
test("madde 1: 5 adımlı sihirbaz — stepper durumu her geçişte doğru güncellenir, adım 2↔3 arası geri dönülebilir, adım 4/5'te geri/ikinci Devam Et YOK", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await gotoAndWaitReady(page, `/doctors/${doctorFixture.slug}`, async () => {
    await expect(page.getByRole("heading", { name: "Müsaitlik ve Randevu" })).toBeVisible();
  });
  await page.waitForTimeout(500);

  const stepperBar = page.getByTestId("booking-stepper-bar");
  await expect(stepperBar).toBeVisible();
  const steps = page.getByTestId("booking-stepper-step");
  await expect(steps).toHaveCount(5);

  // Adım 1 HER ZAMAN "completed" (statik, hekim zaten seçili); adım 2 "current" başlangıçta.
  await expect(steps.nth(0)).toHaveAttribute("data-status", "completed");
  await expect(steps.nth(1)).toHaveAttribute("data-status", "current");
  await expect(steps.nth(2)).toHaveAttribute("data-status", "upcoming");
  await expect(steps.nth(3)).toHaveAttribute("data-status", "upcoming");
  await expect(steps.nth(4)).toHaveAttribute("data-status", "upcoming");

  // Adım 2'de hiçbir slot seçilmeden "Devam Et" DEVRE DIŞI.
  const continueButton = page.getByRole("button", { name: "Devam Et" }).first();
  await expect(continueButton).toBeDisabled();

  await selectAnyAvailableSlot(page);
  await expect(continueButton).toBeEnabled();

  // Adım 2 → adım 3.
  await continueButton.click();
  await expect(steps.nth(1)).toHaveAttribute("data-status", "completed");
  await expect(steps.nth(2)).toHaveAttribute("data-status", "current");
  await expect(page.getByTestId("booking-identity-step")).toBeVisible({ timeout: 15_000 });

  // Adım 2 ↔ 3 SERBEST geri dönüş — "Tarih & Saat seçimine dön".
  await page.getByRole("button", { name: "Tarih & Saat seçimine dön" }).click();
  await expect(steps.nth(1)).toHaveAttribute("data-status", "current");
  await expect(steps.nth(2)).toHaveAttribute("data-status", "upcoming");
  await expect(page.getByTestId("booking-identity-step")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: /— seçili$/ }).first()).toBeVisible(); // seçim KORUNDU

  // Tekrar ileri — adım 3'e geri dön, formu doldur, GERÇEK POST'u tetikle (adım 4'e geçer).
  await continueButton.click();
  await expect(steps.nth(2)).toHaveAttribute("data-status", "current");
  const patientEmail = `qa-e2e-booking-wizard-${Date.now()}@example.com`;
  await submitBookingIdentityStep(page, { patientName: "QA E2E Sihirbaz Hastası", patientEmail });

  await expect(page.getByText(/Rezervasyonunuz oluşturuldu \(BKG-/)).toBeVisible({ timeout: 20_000 });
  await expect(steps.nth(2)).toHaveAttribute("data-status", "completed");
  await expect(steps.nth(3)).toHaveAttribute("data-status", "current");

  // Adım 4 — booking ZATEN oluşturuldu: geri butonu YOK, sağ panelin İKİNCİ "Devam Et"i YOK
  // (yalnızca `BookingIntakeStep`'in KENDİ aksiyonları var — "Bu adımı atla"/"Kaydet ve Devam Et".
  // `exact: true` ZORUNLU: `getByRole` name eşleşmesi VARSAYILAN alt-dize arar, "Kaydet ve Devam
  // Et" GERÇEK/beklenen bir buton olduğundan `exact` OLMADAN "Devam Et" araması onunla da eşleşip
  // yanlışlıkla "hâlâ var" görünürdü — bu turda GÖZLEMLENDİ).
  await expect(page.getByRole("button", { name: "Tarih & Saat seçimine dön" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Devam Et", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Kaydet ve Devam Et" })).toBeVisible();
  await expect(page.getByText("Bu adım opsiyoneldir", { exact: false })).toBeVisible({ timeout: 10_000 });

  // Adım 4'ü atla → adım 5.
  await page.getByRole("button", { name: "Bu adımı atla" }).click();
  await expect(page.getByText("Ödenecek Tutar")).toBeVisible({ timeout: 15_000 });
  await expect(steps.nth(3)).toHaveAttribute("data-status", "completed");
  await expect(steps.nth(4)).toHaveAttribute("data-status", "current");

  // Adım 5'te de AYNI şekilde geri butonu/ikinci "Devam Et" YOK (`BookingPaymentStep`'in KENDİ
  // "Ödemeye Geç" tarzı aksiyonu — burada YALNIZCA sağ panelin ARTIK GİZLİ olduğunu doğrularız).
  await expect(page.getByRole("button", { name: "Tarih & Saat seçimine dön" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Devam Et", exact: true })).toHaveCount(0);
});

// =============================================================================
// madde 3 — çift buton çakışmasının KALMADIĞI: masaüstü (1280px) + mobil (375px) EKRANDA yalnızca
// TEK bir "Devam Et"/aksiyon butonu (eski "Randevu Al" + "Randevu Oluştur" ikilisi YOK).
// =============================================================================
for (const { label, viewport } of [
  { label: "masaüstü (1280px)", viewport: { width: 1280, height: 900 } },
  { label: "mobil (375px)", viewport: { width: 375, height: 812 } },
]) {
  test(`madde 3: ${label} — /doctors/[slug]'da yalnızca TEK bir "Devam Et" butonu var, eski "Randevu Al"/"Randevu Oluştur" YOK`, async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3100", viewport });
    const page = await context.newPage();
    try {
      await gotoAndWaitReady(page, `/doctors/${doctorFixture.slug}`, async () => {
        await expect(page.getByRole("heading", { name: "Müsaitlik ve Randevu" })).toBeVisible();
      });
      await page.waitForTimeout(500);

      // Eski ikili buton (kullanıcı şikayetinin kaynağı) SAYFA İÇERİĞİNDEN (site header'ın GLOBAL
      // "Randevu Al" gezinme linki HARİÇ — o `doctor-card.tsx`'in AYRI, sayfa geneli bir CTA'sı,
      // bu görevin kapsadığı eski in-page anchor/submit ikilisiyle İLGİSİZ) tamamen kalktı.
      // qa-agent bulgusu (bu turda, düzeltildi) — ilk taslak `getByRole("link", {name:"Randevu
      // Al"})`'ı SAYFA GENELİNDE aradı, site header'ın GERÇEK/beklenen global CTA'sıyla çakışıp
      // yanlış-pozitif üretti; `main` landmark'ına SCOPE edilerek düzeltildi.
      const main = page.getByRole("main");
      await expect(main.getByRole("link", { name: "Randevu Al" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Randevu Oluştur" })).toHaveCount(0);

      // `getByRole` erişilebilirlik ağacını kullanır — mobil sabit alt çubuğun (her iki viewport'ta
      // da DOM'da var, yalnızca CSS ile gizli/`aria-hidden` ile dışlanır) İKİNCİ bir eşleşme
      // ÜRETMEDİĞİNİ doğrular (bkz. `support/telehealth-identity-ui.ts` başlığındaki AYNI bulgu).
      const continueButtons = page.getByRole("button", { name: "Devam Et" });
      await expect(continueButtons).toHaveCount(1);
      await expect(continueButtons.first()).toBeVisible();
    } finally {
      await context.close();
    }
  });
}

// =============================================================================
// madde 2 — doktor konsolu kartında tam tarih formatı ("14 Eylül 2026, Pazartesi" tarzı) + saat
// aralığı EKSİKSİZ görünür.
// =============================================================================
test("madde 2: doktor konsolu — randevu kartında tam tarih formatı (\"D MMMM YYYY, HaftaGünü\") ve saat aralığı EKSİKSİZ görünür", async ({
  browser,
}) => {
  test.setTimeout(90_000);

  const slotIso = await pickAvailableSlotIso(doctorFixture.slug);
  const patientName = `QA E2E Kart Format Hastası ${RUN_SUFFIX}`;
  const created = await createBookingRaw({
    doctorSlug: doctorFixture.slug,
    slots: [slotIso],
    patientName,
    patientEmail: `qa-e2e-card-format-${Date.now()}@example.com`,
  });
  expect(created.status).toBe(201);
  const appointment = created.data!.appointments[0]!;

  // `formatFullDayLabel`/`formatTime` (`lib/telehealth-format.ts`) İLE BİREBİR AYNI biçim —
  // bağımsız Node tarafı referansı (doktorun KENDİ `timeZone`'unda hesaplanır).
  const timeZone = doctorFixture.timeZone;
  const datePart = new Intl.DateTimeFormat("tr-TR", { timeZone, day: "numeric", month: "long", year: "numeric" }).format(new Date(appointment.startsAt));
  const weekdayPart = new Intl.DateTimeFormat("tr-TR", { timeZone, weekday: "long" }).format(new Date(appointment.startsAt));
  const expectedFullDateLabel = `${datePart}, ${weekdayPart}`;
  const startLabel = new Intl.DateTimeFormat("tr-TR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(appointment.startsAt));
  const endLabel = new Intl.DateTimeFormat("tr-TR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(appointment.endsAt));

  const { page, close } = await loginDoctorWithTwoFactor(browser);
  try {
    const patientNameText = page.getByText(patientName, { exact: true });
    await expect(patientNameText).toBeVisible({ timeout: 15_000 });
    // qa-agent bulgusu (bu turda, düzeltildi) — bu dosyanın PAYLAŞTIĞI `doctorFixture` madde 1'in
    // sihirbaz akışından zaten BİR booking üretmiş olabilir; O booking AYNI takvim GÜNÜNE (madde
    // 1'in de "ilk müsait slot"u seçmesi) düşerse `formatFullDayLabel` (saat İÇERMEZ) sayfada İKİ
    // KART için de AYNI metni üretip `page.getByText(expectedFullDateLabel)`'i strict-mode ihlaline
    // düşürüyordu — assertion'lar bu yüzden `patientNameText`'in KENDİ kart konteynerine
    // (`doctor-console-patient-card.tsx`'in kök `div`'i, `shadow-sm` sınıfıyla İŞARETLİ) SCOPE edildi.
    const card = patientNameText.locator("xpath=ancestor::div[contains(@class,'shadow-sm')][1]");
    // "Randevu saati bilgisi eksik" fallback'i (backend-agent düzeltmesinden ÖNCEKİ hayalet-booking
    // regresyonunun belirtisiydi) bu GERÇEK, appointments'lı booking için GÖRÜNMEMELİ.
    await expect(card.getByText("Randevu saati bilgisi eksik")).toHaveCount(0);
    await expect(card.getByText(expectedFullDateLabel, { exact: false })).toBeVisible();
    await expect(card.getByText(`${startLabel} - ${endLabel}`, { exact: true })).toBeVisible();
  } finally {
    await close();
  }
});

// =============================================================================
// madde 4 — backend regresyonu: ödemesiz bırakılıp süresi dolan "hayalet" booking (appointments:
// []) `GET /doctor/bookings` varsayılan (scope=all, filtresiz) listesinden ARTIK SIZMIYOR;
// `?paymentStatus=EXPIRED` AÇIKÇA istenirse hâlâ (appointments:[] ile) dönüyor.
// =============================================================================
test("madde 4 [backend regresyonu]: hayalet EXPIRED booking varsayılan GET /doctor/bookings listesinde YOK, ?paymentStatus=EXPIRED ile hâlâ VAR (appointments:[])", async () => {
  test.setTimeout(60_000);

  const slotIso = await pickAvailableSlotIso(doctorFixture.slug);
  const ghostPatientName = `QA E2E Hayalet Booking ${RUN_SUFFIX}`;
  const created = await createBookingRaw({
    doctorSlug: doctorFixture.slug,
    slots: [slotIso],
    patientName: ghostPatientName,
    patientEmail: `qa-e2e-ghost-booking-${Date.now()}@example.com`,
  });
  expect(created.status).toBe(201);
  expect(created.data!.paymentStatus).toBe("PENDING");
  const ghostBookingId = created.data!.bookingId;

  // `runBookingExpirySweep`'in (`backend/src/lib/booking-expiry.ts`) yaptığı İKİ adımı (hard-delete
  // `PENDING_PAYMENT` randevular + booking'i `EXPIRED`'a çevir) doğrudan taklit eder — bkz.
  // `expirePendingBookingDirectly` başlığı.
  expirePendingBookingDirectly(ghostBookingId);

  // Regresyon — varsayılan (scope=all, `paymentStatus` filtresi YOK) sorgu bu hayalet booking'i
  // DIŞARIDA BIRAKMALI (`excludeAppointmentlessBookings`, `telehealth.portal.routes.ts`).
  const defaultRes = await fetch(`${API_BASE_URL}/doctor/bookings?limit=100`, {
    headers: { Authorization: `Bearer ${doctorUserToken}` },
  });
  expect(defaultRes.status).toBe(200);
  const defaultBody = (await defaultRes.json()) as { data: Array<{ id: string; appointments: unknown[] }> };
  expect(
    defaultBody.data.some((row) => row.id === ghostBookingId),
    "hayalet EXPIRED booking (appointments: []) varsayılan/filtresiz listede ARTIK GÖRÜNMEMELİ"
  ).toBe(false);

  // Kasıtlı escape hatch — `paymentStatus=EXPIRED` AÇIKÇA istenirse booking hâlâ döner (`appointments: []` ile).
  const expiredOnlyRes = await fetch(`${API_BASE_URL}/doctor/bookings?limit=100&paymentStatus=EXPIRED`, {
    headers: { Authorization: `Bearer ${doctorUserToken}` },
  });
  expect(expiredOnlyRes.status).toBe(200);
  const expiredOnlyBody = (await expiredOnlyRes.json()) as { data: Array<{ id: string; paymentStatus: string; appointments: unknown[] }> };
  const ghostRow = expiredOnlyBody.data.find((row) => row.id === ghostBookingId);
  expect(ghostRow, "`?paymentStatus=EXPIRED` AÇIKÇA istendiğinde hayalet booking hâlâ DÖNMELİ").toBeTruthy();
  expect(ghostRow!.paymentStatus).toBe("EXPIRED");
  expect(ghostRow!.appointments).toEqual([]);
});
