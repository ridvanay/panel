import { test, expect } from "@playwright/test";
import {
  API_BASE_URL,
  getCachedAdminSession,
  getFixtureUserToken,
  getSiteModules,
  patchSiteModule,
  postStripeTelehealthBookingPaid,
} from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";
import { resetFixtureUserToBaseline, adminGetUserByEmail, adminUpdateRole } from "./support/admin-users-fixtures";
import {
  ensureTelehealthModuleWithDoctors,
  createAdminDoctorFixture,
  deleteAdminDoctorFixture,
  setDoctorAvailabilityRaw,
  linkDoctorUserRaw,
  createBookingRaw,
  getBookingRaw,
  getPublicDoctorSlotsRaw,
  defaultSlotRangeISODates,
  setUserTwoFactorEnabledDirectly,
  type CreatedFixtureDoctor,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — Görev (2026-09-15) "Admin randevu yeniden planlama (reschedule) + e-posta bildirimi +
 * sağ alt canlı destek widget'ı" görev talimatı §1. `PATCH /admin/telehealth/appointments/{id}/
 * reschedule`'ın backend `app.inject` seviyesindeki tüm dallarını (UTC dönüşümü, süre koruma, 409
 * çakışma, best-effort e-posta) `backend/tests/integration/telehealth-admin-reschedule.test.ts`
 * (backend-agent) ZATEN kapsıyor — BURADA YENİDEN YAZILMAZ. Bu dosya "gerçek tarayıcı + gerçek
 * backend + gerçek Postgres" zincirini kapatır: admin UI'dan reschedule → hasta portalında ve
 * doktor konsolunda ANINDA yansıma, admin UI'dan tetiklenen 409 çakışma regresyonu (form BAŞARISIZ
 * kalır, randevu ESKİ saatinde KALIR), MANAGER/EDITOR yetki regresyonu (403, API seviyesi).
 *
 * Kendi İZOLE fixture doktoru kurar (`telehealth-multi-slot-booking.spec.ts::bookingDoctor` İLE
 * AYNI desen — haftanın HER günü 08:00-22:00 Europe/Istanbul, 30dk seans) — paylaşımlı
 * `telehealth-clinic` demo verisine BAĞIMLI DEĞİLDİR.
 *
 * Backend reschedule uç noktası doktorun MÜSAİTLİK PENCERESİNİ kontrol ETMEZ (yalnızca AYNI
 * doktorun başka bir AKTİF randevusuyla zaman-aralığı çakışmasına bakar, bkz.
 * `telehealth.admin.routes.ts::PATCH /:id/reschedule`) — bu yüzden "yeni" reschedule hedefi olarak
 * GERÇEK bir müsait slottan bağımsız, uzak gelecekte SABİT bir tarih/saat (`RESCHEDULE_TARGET_*`)
 * kullanılır; yalnızca çakışma testi (madde 2) GERÇEK bir müsait slotu (ikinci bir ödenmiş randevu
 * için) kullanır.
 */
test.describe.configure({ mode: "serial" });

const FIXTURE_PASSWORD = "QaE2eTelehealthReschedule12345!";
const RUN_SUFFIX = Date.now().toString(36);
const DOCTOR_USER_EMAIL = `qa-e2e-telehealth-reschedule-doctor-${RUN_SUFFIX}@example.com`;
const MANAGER_EMAIL = `qa-e2e-telehealth-reschedule-manager-${RUN_SUFFIX}@example.com`;
const EDITOR_EMAIL = `qa-e2e-telehealth-reschedule-editor-${RUN_SUFFIX}@example.com`;
const PATIENT_NAME = `QA E2E Reschedule Hastası ${RUN_SUFFIX}`;
const PATIENT_EMAIL = `qa-e2e-telehealth-reschedule-patient-${RUN_SUFFIX}@example.com`;

// Europe/Istanbul sabit UTC+3 (DST yok, `telehealth-admin-reschedule.test.ts` İLE AYNI gerekçe).
const RESCHEDULE_TARGET_DATE = "2026-12-20";
const RESCHEDULE_TARGET_TIME = "10:00";
const RESCHEDULE_TARGET_ISO = "2026-12-20T07:00:00.000Z";
const RESCHEDULE_TARGET_TIME_LABEL_TR = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
}).format(new Date(RESCHEDULE_TARGET_ISO));

let adminToken: string;
let initialTelehealthEnabled: boolean;
let doctorFixture: CreatedFixtureDoctor;
let doctorUserId: string;
let doctorUserToken: string;
let managerToken: string;
let editorToken: string;

let bookingId: string;
let bookingAccessToken: string;
let appointmentId: string;
let originalStartsAtIso: string;

/** Doktorun kendi `Europe/Istanbul` duvar saatine (sabit UTC+3) çevirir — backend'in kendi
 * entegrasyon testindeki `wallHourUtc = ...getUTCHours() + 3` YÖNTEMİYLE AYNI. */
function toIstanbulWallDateTime(iso: string): { date: string; time: string } {
  const shifted = new Date(new Date(iso).getTime() + 3 * 60 * 60 * 1000);
  const date = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
  const time = `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`;
  return { date, time };
}

async function pickAvailableSlotIso(doctorSlug: string): Promise<string> {
  const { from, to } = defaultSlotRangeISODates(14);
  const slotsRes = await getPublicDoctorSlotsRaw(doctorSlug, from, to);
  const slot = (slotsRes.data ?? []).find((s) => s.available);
  if (!slot) throw new Error(`qa-agent: ${doctorSlug} için müsait bir slot bulunamadı (reschedule fixture'ı).`);
  return slot.startsAt;
}

async function rescheduleRaw(
  token: string,
  input: { newDate: string; newStartTime: string; reason?: string }
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${API_BASE_URL}/admin/telehealth/appointments/${appointmentId}/reschedule`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

async function cleanupFixtures() {
  await resetFixtureUserToBaseline(adminToken, DOCTOR_USER_EMAIL);
  await resetFixtureUserToBaseline(adminToken, MANAGER_EMAIL);
  await resetFixtureUserToBaseline(adminToken, EDITOR_EMAIL);
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
    fullName: `QA E2E Reschedule Doktoru ${RUN_SUFFIX}`,
    bio: "qa-agent — admin reschedule e2e fixture doktoru.",
    languages: ["tr"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: 45000,
    currency: "TRY",
    isVerified: true,
    isActive: true,
  });
  await setDoctorAvailabilityRaw(
    adminToken,
    doctorFixture.id,
    ([1, 2, 3, 4, 5, 6, 7] as const).map((dayOfWeek) => ({ dayOfWeek, startMinute: 8 * 60, endMinute: 22 * 60 }))
  );

  doctorUserToken = await getFixtureUserToken(DOCTOR_USER_EMAIL, FIXTURE_PASSWORD, "QA E2E Reschedule Doktor Hesabı");
  const doctorUser = await adminGetUserByEmail(adminToken, DOCTOR_USER_EMAIL);
  if (!doctorUser) throw new Error("qa-agent: doktor fixture kullanıcısı oluşturulamadı.");
  doctorUserId = doctorUser.id;
  await linkDoctorUserRaw(adminToken, doctorFixture.id, doctorUserId);

  managerToken = await getFixtureUserToken(MANAGER_EMAIL, FIXTURE_PASSWORD, "QA E2E Reschedule Manager");
  const managerUser = await adminGetUserByEmail(adminToken, MANAGER_EMAIL);
  if (!managerUser) throw new Error("qa-agent: manager fixture kullanıcısı oluşturulamadı.");
  await adminUpdateRole(adminToken, managerUser.id, "MANAGER");

  editorToken = await getFixtureUserToken(EDITOR_EMAIL, FIXTURE_PASSWORD, "QA E2E Reschedule Editor");
  const editorUser = await adminGetUserByEmail(adminToken, EDITOR_EMAIL);
  if (!editorUser) throw new Error("qa-agent: editor fixture kullanıcısı oluşturulamadı.");
  await adminUpdateRole(adminToken, editorUser.id, "EDITOR");

  // PAID/SCHEDULED randevu — GERÇEK müsait slottan booking + GERÇEK HTTP Stripe webhook'uyla ödeme.
  const slotIso = await pickAvailableSlotIso(doctorFixture.slug);
  const created = await createBookingRaw({
    doctorSlug: doctorFixture.slug,
    slots: [slotIso],
    patientName: PATIENT_NAME,
    patientEmail: PATIENT_EMAIL,
  });
  if (created.status !== 201 || !created.data) {
    throw new Error(`qa-agent: reschedule fixture booking'i oluşturulamadı: ${created.status} ${JSON.stringify(created.error)}`);
  }
  bookingId = created.data.bookingId;
  bookingAccessToken = created.data.accessToken;
  appointmentId = created.data.appointments[0]!.id;
  originalStartsAtIso = slotIso;

  const webhookRes = await postStripeTelehealthBookingPaid(bookingId, { rawAccessToken: bookingAccessToken });
  if (webhookRes.status !== 200) throw new Error(`qa-agent: ödeme webhook'u başarısız: ${webhookRes.status}`);
});

test.afterAll(async () => {
  await cleanupFixtures();
  if (doctorFixture) await deleteAdminDoctorFixture(adminToken, doctorFixture.id).catch(() => undefined);
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

// =============================================================================
// 1) Admin reschedule — portallarda ANINDA yansıma (admin tablosu + hasta portalı + doktor konsolu)
// =============================================================================
test("admin 'Tarih/Saat Değiştir' ile randevuyu yeni bir tarih/saate taşır — admin tablosu, hasta portalı ve doktor konsolu ANINDA yansıtır", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { page, close } = await createAuthenticatedPage(browser);
  try {
    await page.goto("/admin/telehealth/appointments");
    await page.getByLabel("Randevu ara").fill(PATIENT_EMAIL);
    await page.waitForTimeout(400); // 250ms debounce (bkz. sayfa kaynağı) + fetch

    const rescheduleButton = page.getByRole("button", { name: `"${PATIENT_NAME}" için randevu tarihini/saatini değiştir` });
    await expect(rescheduleButton).toBeVisible({ timeout: 15_000 });
    await rescheduleButton.click();

    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Yeni Tarih").fill(RESCHEDULE_TARGET_DATE);
    await page.getByLabel("Yeni Başlangıç Saati").fill(RESCHEDULE_TARGET_TIME);
    await page.getByLabel("Değişiklik Nedeni").fill("QA e2e — doktorun programı nedeniyle taşındı.");
    await page.getByRole("button", { name: "Değişikliği Kaydet ve Taraflara Bildir" }).click();

    await expect(
      page.getByLabel("Notifications alt+T").getByText("Randevu yeniden planlandı, ilgili taraflara bildirim gönderildi.")
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Admin tablosu — YENİ tarih/saat (`dateFormatter` ile AYNI biçim, sayfanın kendi kaynağı).
    const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });
    const expectedDateCellText = dateFormatter.format(new Date(RESCHEDULE_TARGET_ISO));
    await expect(page.getByRole("cell", { name: expectedDateCellText })).toBeVisible({ timeout: 15_000 });
  } finally {
    await close();
  }

  // Sunucu taze okuma — appointment GERÇEKTEN yeni startsAt'e sahip.
  const afterReschedule = await getBookingRaw(bookingId, { bearerToken: adminToken });
  expect(afterReschedule.status).toBe(200);
  const rescheduledAppointment = afterReschedule.data!.appointments.find((a) => a.id === appointmentId)!;
  expect(rescheduledAppointment.startsAt).toBe(RESCHEDULE_TARGET_ISO);

  // ---- Hasta tarafı — `/patient/bookings/{id}?t=...` YENİLENİNCE yeni saati gösterir (bu sayfa
  // `revalidate: 60` DEĞİLDİR, her istek dinamiktir — bkz. `patient-booking-detail-panel.tsx` başlığı). ----
  const patientContext = await browser.newContext();
  const patientPage = await patientContext.newPage();
  try {
    await patientPage.goto(`/patient/bookings/${bookingId}?t=${encodeURIComponent(bookingAccessToken)}`, { waitUntil: "domcontentloaded" });
    await expect(patientPage.getByText(RESCHEDULE_TARGET_TIME_LABEL_TR, { exact: false })).toBeVisible({ timeout: 15_000 });
    await patientPage.reload();
    await expect(patientPage.getByText(RESCHEDULE_TARGET_TIME_LABEL_TR, { exact: false })).toBeVisible({ timeout: 15_000 });
  } finally {
    await patientContext.close();
  }

  // ---- Doktor tarafı — `/doctor` konsolunun KENDİ veri kaynağı olan `GET /doctor/bookings`
  // AYNI randevuyu YENİ saatle döner. `setUserTwoFactorEnabledDirectly` YALNIZCA `User.
  // twoFactorEnabled` bayrağını yazar, GERÇEK bir TOTP sırrı KURMAZ (bkz. fixture yorumu) — bu
  // yüzden GERÇEK bir UI login/2FA-doğrulama akışı BURADA KURULAMAZ (`telehealth-doctor-2fa-
  // setup.spec.ts`nin AYRI kapsamı). `doctorUserToken` 2FA açılmadan ÖNCE alınmış GEÇERLİ bir
  // access token'dır (`GET /doctor/*` uçlarının 2FA kapısı yalnızca O ANKİ `twoFactorEnabled`
  // bayrağına bakar — `telehealth-multi-slot-booking.spec.ts::madde 27` İLE AYNI kanıtlanmış
  // davranış, "TWO_FACTOR_REQUIRED" oturum-içi bir TOTP doğrulaması DEĞİL, hesap düzeyinde bir
  // ön koşuldur) — bu yüzden token'ı YENİDEN almaya GEREK YOKTUR. `DoctorBookingsPanel`in KENDİSİ
  // `telehealthApi.listDoctorBookings()` ile BİREBİR AYNI uca istek atar (bkz. `doctor-bookings-
  // panel.tsx`) — bu doğrudan API doğrulaması, panelin GERÇEKTEN render edeceği veriyi YANSITIR.
  setUserTwoFactorEnabledDirectly(doctorUserId, true);
  try {
    const doctorBookingsRes = await fetch(`${API_BASE_URL}/doctor/bookings?scope=all&limit=50`, {
      headers: { Authorization: `Bearer ${doctorUserToken}` },
    });
    expect(doctorBookingsRes.status).toBe(200);
    const doctorBookingsBody = (await doctorBookingsRes.json()) as {
      data: Array<{ patientName: string; appointments: Array<{ id: string; startsAt: string }> }>;
    };
    const rescheduledInDoctorConsole = doctorBookingsBody.data.find((b) =>
      b.appointments.some((a) => a.id === appointmentId)
    );
    expect(rescheduledInDoctorConsole, "qa-agent: doktor konsolu (GET /doctor/bookings) reschedule edilen randevuyu İÇERMİYOR.").toBeTruthy();
    expect(rescheduledInDoctorConsole!.patientName).toBe(PATIENT_NAME);
    const doctorConsoleAppointment = rescheduledInDoctorConsole!.appointments.find((a) => a.id === appointmentId)!;
    expect(doctorConsoleAppointment.startsAt).toBe(RESCHEDULE_TARGET_ISO);
  } finally {
    setUserTwoFactorEnabledDirectly(doctorUserId, false);
  }
});

// =============================================================================
// 2) Çakışma regresyonu — aynı doktora YENİ saatle çakışan başka bir aktif randevu varsa 409,
// form BAŞARISIZ olur, randevu ESKİ (bir önceki testin taşıdığı) saatinde KALIR.
// =============================================================================
test("çakışma regresyonu: aynı doktora yeni saatle çakışan aktif randevu VARSA reschedule formu 409 ile BAŞARISIZ olur, randevu ESKİ saatinde KALIR", async ({
  browser,
}) => {
  test.setTimeout(60_000);

  // İkinci, GERÇEK müsait bir slotta ödenmiş/aktif bir randevu (çakışma hedefi).
  const conflictSlotIso = await pickAvailableSlotIso(doctorFixture.slug);
  const conflictBooking = await createBookingRaw({
    doctorSlug: doctorFixture.slug,
    slots: [conflictSlotIso],
    patientName: `${PATIENT_NAME} (Çakışma)`,
    patientEmail: `qa-e2e-telehealth-reschedule-conflict-${RUN_SUFFIX}@example.com`,
  });
  expect(conflictBooking.status).toBe(201);
  const conflictWebhook = await postStripeTelehealthBookingPaid(conflictBooking.data!.bookingId, {
    rawAccessToken: conflictBooking.data!.accessToken,
  });
  expect(conflictWebhook.status).toBe(200);

  const { date: conflictDate, time: conflictTime } = toIstanbulWallDateTime(conflictSlotIso);

  const { page, close } = await createAuthenticatedPage(browser);
  try {
    await page.goto("/admin/telehealth/appointments");
    await page.getByLabel("Randevu ara").fill(PATIENT_EMAIL);
    await page.waitForTimeout(400);

    const rescheduleButton = page.getByRole("button", { name: `"${PATIENT_NAME}" için randevu tarihini/saatini değiştir` });
    await expect(rescheduleButton).toBeVisible({ timeout: 15_000 });
    await rescheduleButton.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });

    await page.getByLabel("Yeni Tarih").fill(conflictDate);
    await page.getByLabel("Yeni Başlangıç Saati").fill(conflictTime);
    await page.getByRole("button", { name: "Değişikliği Kaydet ve Taraflara Bildir" }).click();

    // Kullanıcı-dostu 409 hatası — form içinde, dialog KAPANMAZ, BAŞARI toast'ı GÖRÜNMEZ.
    await expect(page.getByRole("alert").filter({ hasText: "Doktorun bu saatte başka bir randevusu var, farklı bir saat seçin." })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByLabel("Notifications alt+T").getByText("Randevu yeniden planlandı, ilgili taraflara bildirim gönderildi.")
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Vazgeç" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await close();
  }

  // Randevu GERÇEKTEN eski (bir önceki testin taşıdığı) saatinde KALDI.
  const afterFailedAttempt = await getBookingRaw(bookingId, { bearerToken: adminToken });
  expect(afterFailedAttempt.status).toBe(200);
  const unchangedAppointment = afterFailedAttempt.data!.appointments.find((a) => a.id === appointmentId)!;
  expect(unchangedAppointment.startsAt).toBe(RESCHEDULE_TARGET_ISO);
});

// =============================================================================
// 3) Yetki regresyonu — MANAGER/EDITOR → 403 (API seviyesi), randevu ETKİLENMEZ.
// =============================================================================
test("yetki regresyonu: MANAGER/EDITOR rolüyle PATCH .../reschedule → 403, randevu ETKİLENMEZ", async () => {
  for (const token of [managerToken, editorToken]) {
    const res = await rescheduleRaw(token, { newDate: "2026-12-25", newStartTime: "09:00" });
    expect(res.status, `qa-agent: MANAGER/EDITOR reschedule denemesi 403 dönmeli, gövde: ${JSON.stringify(res.body)}`).toBe(403);
  }

  const afterAttempts = await getBookingRaw(bookingId, { bearerToken: adminToken });
  expect(afterAttempts.status).toBe(200);
  const unchangedAppointment = afterAttempts.data!.appointments.find((a) => a.id === appointmentId)!;
  expect(unchangedAppointment.startsAt).toBe(RESCHEDULE_TARGET_ISO);
});
