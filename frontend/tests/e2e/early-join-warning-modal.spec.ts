import { test, expect } from "@playwright/test";
import { getCachedAdminSession, getFixtureUserToken, getSiteModules, patchSiteModule } from "./support/api";
import {
  ensureTelehealthModuleWithDoctors,
  listAllAdminDoctors,
  createBookingRaw,
  getBookingRaw,
  getPublicDoctorSlotsRaw,
  defaultSlotRangeISODates,
  markBookingPaidDirectly,
  shiftAppointmentIntoJoinWindowDirectly,
  type FixtureDoctor,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — `.claude/architect-scope-support-desk-and-reminders.md` §1.3/§4.8 madde 1-4 canlı
 * doğrulaması. `JoinMeetingButton` (`components/site/telehealth/join-meeting-button.tsx`)
 * projedeki TEK katılım girişidir — bu dosya hasta portalı (`mergeRemainingTime=false` dalı,
 * `patient/bookings/{id}` sayfasının kullandığı dal) üzerinden erken katılım uyarı modalını
 * (§4.8 madde 1-4) uçtan uca doğrular. Doktor konsolu (madde 5) AYNI bileşeni/AYNI
 * `handleJoinClick` fonksiyonunu paylaştığı KOD İNCELEMESİYLE doğrulandı (ayrı bir doktor-login
 * akışı bu turda AYRICA e2e edilmedi — bkz. qa-agent turu raporu).
 */
test.describe.configure({ mode: "serial" });

const RUN_SUFFIX = Date.now().toString(36);
const PATIENT_EMAIL = `qa-e2e-early-join-${RUN_SUFFIX}@example.com`;
const PATIENT_PASSWORD = "QaE2eEarlyJoin12345!";
const PATIENT_NAME = `QA Early Join Hasta ${RUN_SUFFIX}`;

const EARLY_JOIN_TEXT =
  "Dikkat: Randevu saatinizden erken katılıyorsunuz. Görüşmeyi erken başlatıp sonlandırmanız durumunda, asıl randevu saatinizde odaya yeniden giriş yapılamayabilir. Devam etmek istiyor musunuz?";

let adminToken: string;
let initialTelehealthEnabled: boolean;
let doctorFixture: FixtureDoctor;

// Booking A — madde 1/2/3/4 (>10dk erken, modal akışının TAMAMI).
let bookingAId: string;
let bookingAToken: string;
let appointmentAId: string;

// Booking B — madde 4 (regresyon: <=10dk kala modal HİÇ açılmamalı).
let bookingBId: string;
let bookingBToken: string;
let appointmentBId: string;

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(90_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);
  const doctors = await listAllAdminDoctors(adminToken);
  if (doctors.length === 0) throw new Error("qa-agent: telehealth-clinic doktoru bulunamadı.");
  doctorFixture = doctors[0]!;

  const patientToken = await getFixtureUserToken(PATIENT_EMAIL, PATIENT_PASSWORD, PATIENT_NAME);
  const { from, to } = defaultSlotRangeISODates(28);
  const slotsRes = await getPublicDoctorSlotsRaw(doctorFixture.slug, from, to);
  const availableSlots = (slotsRes.data ?? []).filter((s) => s.available);
  if (availableSlots.length < 2) throw new Error("qa-agent: erken katılım testi için en az 2 müsait slot gerekli.");

  const createdA = await createBookingRaw(
    { doctorSlug: doctorFixture.slug, slots: [availableSlots[0]!.startsAt], patientName: PATIENT_NAME, patientEmail: PATIENT_EMAIL },
    patientToken
  );
  expect(createdA.status).toBe(201);
  bookingAId = createdA.data!.bookingId;
  bookingAToken = createdA.data!.accessToken;
  markBookingPaidDirectly(bookingAId);
  const bookingADetail = await getBookingRaw(bookingAId, { magicLinkToken: bookingAToken });
  appointmentAId = (bookingADetail.data as unknown as { appointments: { id: string }[] }).appointments[0]!.id;
  // Madde 1/2/3: randevu saatine ONLARCA gün var (`defaultSlotRangeISODates(28)`) — kesinlikle
  // >10dk erken, modal AÇILMALI.

  const createdB = await createBookingRaw(
    { doctorSlug: doctorFixture.slug, slots: [availableSlots[1]!.startsAt], patientName: PATIENT_NAME, patientEmail: PATIENT_EMAIL },
    patientToken
  );
  expect(createdB.status).toBe(201);
  bookingBId = createdB.data!.bookingId;
  bookingBToken = createdB.data!.accessToken;
  markBookingPaidDirectly(bookingBId);
  const bookingBDetail = await getBookingRaw(bookingBId, { magicLinkToken: bookingBToken });
  appointmentBId = (bookingBDetail.data as unknown as { appointments: { id: string }[] }).appointments[0]!.id;
  // Madde 4 (regresyon): randevuyu şimdiden 5dk sonrasına kaydır (<=10dk eşiğinin İÇİNDE) —
  // modal HİÇ açılmamalı, doğrudan navigasyon.
  shiftAppointmentIntoJoinWindowDirectly(appointmentBId, 5 * 60, 30);
});

test.afterAll(async () => {
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

test("madde 1-3: randevusuna onlarca gün kalan hasta 'Toplantıya Katıl'a tıklar → uyarı modalı AÇILIR (metin birebir), [Vazgeç] navigasyon YAPMAZ, [Anladım] odaya yönlendirir ve AYNI oturumda ikinci tıklamada modal TEKRAR açılmaz", async ({
  page,
}) => {
  await page.goto(`/patient/bookings/${bookingAId}?t=${encodeURIComponent(bookingAToken)}`);
  const joinButton = page.getByRole("link", { name: "Toplantıya Katıl" });
  await expect(joinButton).toBeVisible({ timeout: 15_000 });

  // Madde 1: tıklama → modal açılır, metin BİREBİR.
  await joinButton.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByText("Erken Katılım")).toBeVisible();
  await expect(dialog.getByText(EARLY_JOIN_TEXT)).toBeVisible();

  // Madde 2: [Vazgeç] → modal kapanır, navigasyon YOK (aynı sayfada kalınır).
  await dialog.getByRole("button", { name: "Vazgeç" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/patient/bookings/${bookingAId}`));

  // Madde 3: tekrar tıkla → modal yine açılır (henüz onaylanmadı) → [Anladım, Odaya Katıl] →
  // GERÇEK navigasyon (`window.location.assign`) ile `/consultation/{id}`e gidilir.
  await joinButton.click();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await Promise.all([page.waitForURL(new RegExp(`/consultation/${appointmentAId}`), { timeout: 15_000 }), dialog.getByRole("button", { name: "Anladım, Odaya Katıl" }).click()]);
  await expect(page).toHaveURL(new RegExp(`/consultation/${appointmentAId}`));

  // Madde 3 devamı — AYNI oturumda (sessionStorage onayı) booking sayfasına dönüp TEKRAR
  // tıklandığında modal artık AÇILMAZ, doğrudan `/consultation/{id}`ye gidilir.
  await page.goto(`/patient/bookings/${bookingAId}?t=${encodeURIComponent(bookingAToken)}`);
  const joinButtonAgain = page.getByRole("link", { name: "Toplantıya Katıl" });
  await expect(joinButtonAgain).toBeVisible({ timeout: 15_000 });
  await Promise.all([page.waitForURL(new RegExp(`/consultation/${appointmentAId}`), { timeout: 15_000 }), joinButtonAgain.click()]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("madde 4 (regresyon): randevusuna 5dk kalan hasta 'Toplantıya Katıl'a tıklar → modal HİÇ açılmaz, DOĞRUDAN yönlendirir", async ({
  page,
}) => {
  await page.goto(`/patient/bookings/${bookingBId}?t=${encodeURIComponent(bookingBToken)}`);
  const joinButton = page.getByRole("link", { name: "Toplantıya Katıl" });
  await expect(joinButton).toBeVisible({ timeout: 15_000 });

  await Promise.all([page.waitForURL(new RegExp(`/consultation/${appointmentBId}`), { timeout: 15_000 }), joinButton.click()]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
