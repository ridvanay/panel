import { test, expect, type Browser, type Page } from "@playwright/test";
import { authenticator } from "otplib";
import { getCachedAdminSession, getSiteModules, patchSiteModule, getFixtureUserToken, setupAndEnableTwoFactorForSelf } from "./support/api";
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
  markBookingPaidDirectly,
  setAppointmentStatusDirectly,
  type CreatedFixtureDoctor,
  type FixtureAvailabilitySlot,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — 4-parçalı kritik hata paketi (2026-09-15) SON adım, madde 3 (çoklu slot booking'lerde
 * doktor konsolu hasta kartının saat bloğu + "{N} Slot ({M} Dk)" rozeti). `telehealth-doctor-
 * console-join-window.spec.ts` İLE AYNI desen (kendi İZOLE fixture doktoru, haftanın HER günü
 * 00:00-24:00 geniş pencere, kendi-kendine-servis 2FA) — paylaşımlı `telehealth-clinic` demo
 * verisine BAĞIMLI DEĞİLDİR.
 *
 * `sessionDurationMin: 60` bilinçli seçildi — 4 ardışık saatlik slot temiz bir "09:00 - 13:00"
 * tarzı blok üretir, dakika hesabının (`4 × 60 = 240`) doğrulanması da böylece kolaylaşır.
 */
test.describe.configure({ mode: "serial" });

const FIXTURE_PASSWORD = "QaE2eMultiSlotBlockBadge12345!";
const RUN_SUFFIX = Date.now().toString(36);
const DOCTOR_EMAIL = `qa-e2e-multi-slot-block-doctor-${RUN_SUFFIX}@example.com`;
const PATIENT_MULTI = `QA Blok Rozeti Çoklu Hasta ${RUN_SUFFIX}`;
const PATIENT_SINGLE = `QA Blok Rozeti Tekli Hasta ${RUN_SUFFIX}`;

let adminToken: string;
let initialTelehealthEnabled: boolean;
let doctorFixture: CreatedFixtureDoctor;
let doctorUserToken: string;
let doctorTotpSecret: string;

let multiSlotAppointments: FixtureAvailabilitySlot[];
let singleSlotAppointment: FixtureAvailabilitySlot;

async function cleanupFixtures() {
  await resetFixtureUserToBaseline(adminToken, DOCTOR_EMAIL);
}

/** İlk `n` ardışık (aralarında BOŞLUK olmayan — bir sonrakinin `startsAt`i öncekinin `endsAt`ine
 *  EŞİT) müsait slotu bulur. Doktorun haftanın HER günü/saati müsait olması (`beforeAll`) bu dizinin
 *  aralık başında BULUNMASINI garanti eder (yalnızca §4.2'nin 2 saatlik rezervasyon tamponu slotları
 *  kısıtlar, aradaki ardışıklığı BOZMAZ). */
async function pickNConsecutiveAvailableSlots(doctorSlug: string, n: number): Promise<FixtureAvailabilitySlot[]> {
  const { from, to } = defaultSlotRangeISODates(14);
  const slotsRes = await getPublicDoctorSlotsRaw(doctorSlug, from, to);
  const slots = (slotsRes.data ?? [])
    .slice()
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  for (let i = 0; i + n <= slots.length; i++) {
    const window = slots.slice(i, i + n);
    const consecutive = window.every(
      (s, idx) => s.available && (idx === 0 || new Date(s.startsAt).getTime() === new Date(window[idx - 1]!.endsAt).getTime())
    );
    if (consecutive) return window;
  }
  throw new Error(`qa-agent: ${doctorSlug} için ${n} ardışık müsait slot bulunamadı.`);
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
    fullName: `QA E2E Çoklu Slot Blok Doktoru ${RUN_SUFFIX}`,
    bio: "qa-agent — çoklu slot booking blok saat + rozet e2e fixture doktoru.",
    languages: ["tr"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 60,
    sessionPriceCents: 60000,
    currency: "TRY",
    isVerified: true,
    isActive: true,
  });
  await setDoctorAvailabilityRaw(
    adminToken,
    doctorFixture.id,
    ([1, 2, 3, 4, 5, 6, 7] as const).map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }))
  );

  doctorUserToken = await getFixtureUserToken(DOCTOR_EMAIL, FIXTURE_PASSWORD, "QA E2E Çoklu Slot Blok Doktoru Hesabı");
  const doctorUser = await adminGetUserByEmail(adminToken, DOCTOR_EMAIL);
  if (!doctorUser) throw new Error("qa-agent: doktor fixture kullanıcısı oluşturulamadı.");
  await linkDoctorUserRaw(adminToken, doctorFixture.id, doctorUser.id);
  const twoFactor = await setupAndEnableTwoFactorForSelf(doctorUserToken);
  doctorTotpSecret = twoFactor.secret;

  // ---- Booking A — 4 ARDIŞIK slot (madde 3 asıl doğrulaması). ----
  multiSlotAppointments = await pickNConsecutiveAvailableSlots(doctorFixture.slug, 4);
  const multiBooking = await createBookingRaw({
    doctorSlug: doctorFixture.slug,
    slots: multiSlotAppointments.map((s) => s.startsAt),
    patientName: PATIENT_MULTI,
    patientEmail: `qa-e2e-multi-slot-block-${RUN_SUFFIX}@example.com`,
  });
  if (multiBooking.status !== 201 || !multiBooking.data) {
    throw new Error(`qa-agent: 4 slotlu booking oluşturulamadı: ${multiBooking.status} ${JSON.stringify(multiBooking.error)}`);
  }
  markBookingPaidDirectly(multiBooking.data.bookingId);
  for (const appt of multiBooking.data.appointments) {
    setAppointmentStatusDirectly(appt.id, "SCHEDULED");
  }

  // ---- Booking B — TEK slot (regresyon: rozet GÖRÜNMEMELİ), farklı bir gün/saatten (Booking A'nın
  // 4 slotuyla ÇAKIŞMASIN diye 4 slot ÖTESİNDEN alınır). ----
  const singleWindow = await pickNConsecutiveAvailableSlots(doctorFixture.slug, 5);
  singleSlotAppointment = singleWindow[4]!;
  const singleBooking = await createBookingRaw({
    doctorSlug: doctorFixture.slug,
    slots: [singleSlotAppointment.startsAt],
    patientName: PATIENT_SINGLE,
    patientEmail: `qa-e2e-single-slot-block-${RUN_SUFFIX}@example.com`,
  });
  if (singleBooking.status !== 201 || !singleBooking.data) {
    throw new Error(`qa-agent: tekli booking oluşturulamadı: ${singleBooking.status} ${JSON.stringify(singleBooking.error)}`);
  }
  markBookingPaidDirectly(singleBooking.data.bookingId);
  setAppointmentStatusDirectly(singleBooking.data.appointments[0]!.id, "SCHEDULED");
});

test.afterAll(async () => {
  await cleanupFixtures();
  if (doctorFixture) await deleteAdminDoctorFixture(adminToken, doctorFixture.id).catch(() => undefined);
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

/** `telehealth-doctor-console-join-window.spec.ts::loginDoctorWithTwoFactor` İLE AYNI desen. */
async function loginDoctorWithTwoFactor(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    baseURL: process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(DOCTOR_EMAIL);
  await page.getByLabel("Şifre").fill(FIXTURE_PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();

  await expect(page.getByText("Kimlik doğrulama uygulamanızdaki 6 haneli kodu", { exact: false })).toBeVisible({ timeout: 15_000 });
  const code = authenticator.generate(doctorTotpSecret);
  await page.getByLabel("Doğrulama Kodu").fill(code);
  await page.getByRole("button", { name: "Doğrula" }).click();

  await page.waitForURL(/\/doctor$/, { timeout: 15_000 });
  return { page, close: () => context.close() };
}

function formatTimeInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("tr-TR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

// =============================================================================
// madde 3 — 4 ardışık slot: kart "{başlangıç} - {bitiş} (TSİ)" BLOK saatini VE "4 Slot (240 Dk)"
// rozetini gösterir (`computeAppointmentBlock`, `lib/telehealth-format.ts`).
// =============================================================================
test("madde 3: 4 ardışık slotlu booking'de doktor konsolu kartı doğru BLOK saat aralığını ve '4 Slot (240 Dk)' rozetini gösterir", async ({
  browser,
}) => {
  const { page, close } = await loginDoctorWithTwoFactor(browser);
  try {
    await expect(page.getByRole("heading", { name: "Doktor Konsolu" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(PATIENT_MULTI, { exact: true })).toBeVisible({ timeout: 15_000 });

    const expectedStart = formatTimeInZone(multiSlotAppointments[0]!.startsAt, "Europe/Istanbul");
    const expectedEnd = formatTimeInZone(multiSlotAppointments[3]!.endsAt, "Europe/Istanbul");

    // `page.locator("div", {has: ...})` DOM sırasına göre eşleşir — `.first()` TEK BAŞINA hem kartın
    // KENDİSİNİ hem de İKİ kartı BİRDEN saran dış liste kapsayıcısını eşleştirebilir (ikisi de
    // PATIENT_MULTI'yi torun olarak İÇERİR). `hasNotText: PATIENT_SINGLE` dış kapsayıcıyı (o İKİSİNİ
    // DE içerdiği için) ELER, yalnızca PATIENT_MULTI'nin KENDİ kartı kalır.
    const card = page.locator("div", { hasText: PATIENT_MULTI }).filter({ hasNotText: PATIENT_SINGLE }).first();
    await expect(card.getByText(`${expectedStart} - ${expectedEnd}`, { exact: false })).toBeVisible();
    await expect(card.getByText("(TSİ)", { exact: true })).toBeVisible();
    await expect(card.getByText("4 Slot (240 Dk)", { exact: true })).toBeVisible();
  } finally {
    await close();
  }
});

// =============================================================================
// madde 3 [REGRESYON] — tek slotlu booking'de "{N} Slot ({M} Dk)" rozeti HİÇ GÖRÜNMEZ.
// =============================================================================
test("madde 3 [REGRESYON]: tek slotlu booking'de doktor konsolu kartında 'Slot (... Dk)' rozeti GÖRÜNMEZ", async ({ browser }) => {
  const { page, close } = await loginDoctorWithTwoFactor(browser);
  try {
    await expect(page.getByText(PATIENT_SINGLE, { exact: true })).toBeVisible({ timeout: 15_000 });

    const expectedStart = formatTimeInZone(singleSlotAppointment.startsAt, "Europe/Istanbul");
    const expectedEnd = formatTimeInZone(singleSlotAppointment.endsAt, "Europe/Istanbul");

    const card = page.locator("div", { hasText: PATIENT_SINGLE }).filter({ hasNotText: PATIENT_MULTI }).first();
    await expect(card.getByText(`${expectedStart} - ${expectedEnd}`, { exact: false })).toBeVisible();
    await expect(card.getByText(/\d+ Slot \(\d+ Dk\)/)).toHaveCount(0);
  } finally {
    await close();
  }
});
