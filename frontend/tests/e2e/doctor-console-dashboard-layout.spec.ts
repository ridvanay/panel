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
  setAppointmentStatusDirectly,
  shiftAppointmentByMinutesAndSetStatusDirectly,
  type CreatedFixtureDoctor,
  type FixtureAvailabilitySlot,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — orkestratörün doğrudan görev talimatı (bu tur, frontend-agent → ui-designer →
 * qa-agent daraltılmış akışı, `/doctor` "Doktor Konsolu" 2 kolonlu dashboard grid'i):
 *   1) Above-the-fold görünürlük — sayfa yüklendiğinde en az bir randevu kartı SCROLL YAPMADAN
 *      görünür olmalı (eski regresyon: sağ sidebar tam genişlik + 2 kolon, randevuları aşağı
 *      itiyordu — bkz. `doctor-bookings-panel.tsx` dosya başı yorumu).
 *   2) Filtre sekmelerinin (`Tümü`/`Bugün`/`Gelecek Randevular`/`Tamamlananlar`) anında süzme
 *      davranışı + "Bugün"/"Tamamlananlar" sekmelerindeki sayı rozetinin (varlığı, kesin sayı
 *      HARDCODE EDİLMEDEN) render olduğu doğrulanır.
 *
 * `telehealth-doctor-session-guard.spec.ts` İLE AYNI desen: kendi, İZOLE fixture doktoru
 * (`createAdminDoctorFixture` + `setDoctorAvailabilityRaw`, haftanın HER günü geniş pencere) +
 * kendi-kendine-servis 2FA (`setupAndEnableTwoFactorForSelf`) — paylaşımlı `telehealth-clinic`
 * demo verisine BAĞIMLI DEĞİL. Üç ayrı `scope`'a (today/upcoming/completed) GERÇEKTEN düşecek
 * randevu üretmek için `POST /appointments/bookings` (GERÇEK, herkese açık rezervasyon akışı) +
 * ardından `setAppointmentStatusDirectly`/`shiftAppointmentByMinutesAndSetStatusDirectly` (DB
 * yazma, yalnızca zamanlama/durum — "gerçek randevu, sahte olan yalnızca zamanlama/bayrak"
 * felsefesi, dosya başlığındaki mevcut yardımcılarla AYNI ilke) ile hedef pencereye kaydırılır.
 */
test.describe.configure({ mode: "serial" });

const FIXTURE_PASSWORD = "QaE2eDashboardLayout12345!";
const RUN_SUFFIX = Date.now().toString(36);
const DOCTOR_USER_EMAIL = `qa-e2e-doctor-dashboard-${RUN_SUFFIX}@example.com`;

const PATIENT_TODAY = `QA Dashboard Bugün Hasta ${RUN_SUFFIX}`;
const PATIENT_UPCOMING = `QA Dashboard Gelecek Hasta ${RUN_SUFFIX}`;
const PATIENT_COMPLETED = `QA Dashboard Tamamlanan Hasta ${RUN_SUFFIX}`;

let adminToken: string;
let initialTelehealthEnabled: boolean;
let doctorFixture: CreatedFixtureDoctor;
let doctorUserId: string;
let doctorUserToken: string;
let doctorTotpSecret: string;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
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
    fullName: `QA E2E Doktor Dashboard ${RUN_SUFFIX}`,
    bio: "qa-agent — doktor konsolu dashboard grid/sekme filtreleme e2e fixture doktoru.",
    languages: ["tr"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: 40000,
    currency: "TRY",
    isVerified: true,
    isActive: true,
  });
  await setDoctorAvailabilityRaw(
    adminToken,
    doctorFixture.id,
    ([1, 2, 3, 4, 5, 6, 7] as const).map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }))
  );

  doctorUserToken = await getFixtureUserToken(DOCTOR_USER_EMAIL, FIXTURE_PASSWORD, "QA E2E Doktor Dashboard");
  const doctorUser = await adminGetUserByEmail(adminToken, DOCTOR_USER_EMAIL);
  if (!doctorUser) throw new Error("qa-agent: doktor fixture kullanıcısı oluşturulamadı.");
  doctorUserId = doctorUser.id;
  await linkDoctorUserRaw(adminToken, doctorFixture.id, doctorUserId);
  const twoFactor = await setupAndEnableTwoFactorForSelf(doctorUserToken);
  doctorTotpSecret = twoFactor.secret;

  // Üç ayrı, ANLAMLI (farklı scope'lara düşecek) booking — [DPI] §3.2 `GET /doctor/bookings?scope=...`
  // filtre mantığı `backend/src/modules/telehealth/telehealth.portal.routes.ts`'te doğrulandı.
  const now = new Date();
  const from = isoDate(now);
  const to = isoDate(new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000));
  const slotsRes = await getPublicDoctorSlotsRaw(doctorFixture.slug, from, to);
  const availableSlots = (slotsRes.data ?? []).filter((s: FixtureAvailabilitySlot) => s.available);
  const todayIso = isoDate(now);
  const slotToday = availableSlots[0];
  const slotUpcoming = availableSlots.find((s) => isoDate(new Date(s.startsAt)) !== todayIso && s.startsAt !== slotToday?.startsAt);
  const slotCompleted = availableSlots
    .slice()
    .reverse()
    .find((s) => s.startsAt !== slotToday?.startsAt && s.startsAt !== slotUpcoming?.startsAt);
  if (!slotToday || !slotUpcoming || !slotCompleted) {
    throw new Error("qa-agent: dashboard fixture'ı için yeterli müsait/birbirinden farklı slot bulunamadı.");
  }

  const bookingToday = await createBookingRaw({
    doctorSlug: doctorFixture.slug,
    slots: [slotToday.startsAt],
    patientName: PATIENT_TODAY,
    patientEmail: `qa-e2e-dashboard-today-${RUN_SUFFIX}@example.com`,
  });
  if (bookingToday.status !== 201 || !bookingToday.data) throw new Error(`qa-agent: "bugün" booking'i oluşturulamadı: ${JSON.stringify(bookingToday.error)}`);
  shiftAppointmentByMinutesAndSetStatusDirectly(bookingToday.data.appointments[0]!.id, 5, "SCHEDULED", 30);

  const bookingUpcoming = await createBookingRaw({
    doctorSlug: doctorFixture.slug,
    slots: [slotUpcoming.startsAt],
    patientName: PATIENT_UPCOMING,
    patientEmail: `qa-e2e-dashboard-upcoming-${RUN_SUFFIX}@example.com`,
  });
  if (bookingUpcoming.status !== 201 || !bookingUpcoming.data) throw new Error(`qa-agent: "gelecek" booking'i oluşturulamadı: ${JSON.stringify(bookingUpcoming.error)}`);
  setAppointmentStatusDirectly(bookingUpcoming.data.appointments[0]!.id, "SCHEDULED");

  const bookingCompleted = await createBookingRaw({
    doctorSlug: doctorFixture.slug,
    slots: [slotCompleted.startsAt],
    patientName: PATIENT_COMPLETED,
    patientEmail: `qa-e2e-dashboard-completed-${RUN_SUFFIX}@example.com`,
  });
  if (bookingCompleted.status !== 201 || !bookingCompleted.data) throw new Error(`qa-agent: "tamamlanan" booking'i oluşturulamadı: ${JSON.stringify(bookingCompleted.error)}`);
  setAppointmentStatusDirectly(bookingCompleted.data.appointments[0]!.id, "COMPLETED", { daysAgo: 2 });
});

test.afterAll(async () => {
  await cleanupFixtures();
  if (doctorFixture) await deleteAdminDoctorFixture(adminToken, doctorFixture.id).catch(() => undefined);
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

/** `telehealth-doctor-session-guard.spec.ts::loginDoctorWithTwoFactor` İLE AYNI desen. */
async function loginDoctorWithTwoFactor(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3100",
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(DOCTOR_USER_EMAIL);
  await page.getByLabel("Şifre").fill(FIXTURE_PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();

  await expect(page.getByText("Kimlik doğrulama uygulamanızdaki 6 haneli kodu", { exact: false })).toBeVisible({ timeout: 15_000 });
  const code = authenticator.generate(doctorTotpSecret);
  await page.getByLabel("Doğrulama Kodu").fill(code);
  await page.getByRole("button", { name: "Doğrula" }).click();

  await page.waitForURL(/\/doctor$/, { timeout: 15_000 });
  return {
    page,
    close: async () => {
      await context.close();
    },
  };
}

// =============================================================================
// madde 1 — above-the-fold görünürlük + sidebar dikey taşma yaratmıyor
// =============================================================================

test("madde 1: /doctor'da ilk randevu kartı, sayfa yüklendiğinde scroll YAPMADAN (above-the-fold) görünür", async ({ browser }) => {
  const { page, close } = await loginDoctorWithTwoFactor(browser);
  try {
    await expect(page.getByRole("heading", { name: "Doktor Konsolu" })).toBeVisible();

    // Sağ sidebar (`Portal Akışı & Duyurular`) hatasız render olmuş olmalı — above-the-fold
    // regresyonunun (eski: tam genişlik sidebar randevuları aşağı itiyordu) dolaylı ön koşulu.
    await expect(page.getByTestId("doctor-portal-feed-card")).toBeVisible({ timeout: 15_000 });

    // Üç fixture hastasından herhangi biri (ilk render'daki "Tümü" sekmesi hepsini listeler) —
    // ilk görünen randevu kartının konteyneri above-the-fold'da olmalı.
    const firstPatientCard = page.getByText(new RegExp(`^QA Dashboard (Bugün|Gelecek|Tamamlanan) Hasta ${RUN_SUFFIX}$`)).first();
    await expect(firstPatientCard).toBeVisible({ timeout: 15_000 });

    const box = await firstPatientCard.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeLessThan(800);
  } finally {
    await close();
  }
});

// =============================================================================
// madde 2 — filtre sekmelerinin anında süzme davranışı + sayı rozeti render'ı
// =============================================================================

test("madde 2: scope sekmeleri (Tümü/Bugün/Gelecek Randevular/Tamamlananlar) listeyi FARKLILAŞTIRIR, sayaç rozeti render olur", async ({
  browser,
}) => {
  const { page, close } = await loginDoctorWithTwoFactor(browser);
  try {
    // "Tümü" (varsayılan) — üçü de görünür.
    await expect(page.getByText(PATIENT_TODAY, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(PATIENT_UPCOMING, { exact: true })).toBeVisible();
    await expect(page.getByText(PATIENT_COMPLETED, { exact: true })).toBeVisible();

    // "Bugün" — yalnızca bugüne kaydırılmış booking; sayaç rozeti (overview.today.total) render olur.
    const todayTab = page.getByRole("tab", { name: /Bugün/ });
    await todayTab.click();
    await expect(page.getByText(PATIENT_TODAY, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(PATIENT_UPCOMING, { exact: true })).toHaveCount(0);
    await expect(page.getByText(PATIENT_COMPLETED, { exact: true })).toHaveCount(0);
    await expect(todayTab).toContainText(/\d+/);

    // "Gelecek Randevular" — bugünkü (startsAt > now, SCHEDULED) + gelecekteki booking görünür,
    // tamamlanan (geçmiş, COMPLETED) GÖRÜNMEZ.
    const upcomingTab = page.getByRole("tab", { name: "Gelecek Randevular" });
    await upcomingTab.click();
    await expect(page.getByText(PATIENT_UPCOMING, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(PATIENT_COMPLETED, { exact: true })).toHaveCount(0);

    // "Tamamlananlar" — yalnızca tamamlanan booking; sayaç rozeti (overview.completedConsultationTotal) render olur.
    const completedTab = page.getByRole("tab", { name: "Tamamlananlar" });
    await completedTab.click();
    await expect(page.getByText(PATIENT_COMPLETED, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(PATIENT_TODAY, { exact: true })).toHaveCount(0);
    await expect(page.getByText(PATIENT_UPCOMING, { exact: true })).toHaveCount(0);
    await expect(completedTab).toContainText(/\d+/);

    // "Tümü"'ye geri dönünce üçü de tekrar görünür — sekme değişiminin GERİ ALINABİLİR olduğunu doğrular.
    const allTab = page.getByRole("tab", { name: "Tümü" });
    await allTab.click();
    await expect(page.getByText(PATIENT_TODAY, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(PATIENT_UPCOMING, { exact: true })).toBeVisible();
    await expect(page.getByText(PATIENT_COMPLETED, { exact: true })).toBeVisible();
  } finally {
    await close();
  }
});
