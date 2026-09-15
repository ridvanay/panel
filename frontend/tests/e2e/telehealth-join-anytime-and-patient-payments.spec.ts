import { test, expect, type Browser } from "@playwright/test";
import { getCachedAdminSession, getSiteModules, patchSiteModule, getFixtureUserToken } from "./support/api";
import { resetFixtureUserToBaseline } from "./support/admin-users-fixtures";
import {
  ensureTelehealthModuleWithDoctors,
  createAdminDoctorFixture,
  deleteAdminDoctorFixture,
  setDoctorAvailabilityRaw,
  createBookingRaw,
  getPublicDoctorSlotsRaw,
  defaultSlotRangeISODates,
  markBookingPaidDirectly,
  setAppointmentStatusDirectly,
  requestMeetingTokenRaw,
  type CreatedFixtureDoctor,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — 4-parçalı kritik hata paketi (2026-09-15) SON adım, madde 1 (zaman kilidinin
 * KALKMASI + ÖDENMEMİŞ booking regresyonu) + madde 2 (fatura sayfası hard-refresh) + madde 4
 * ("Ödemelerim" sekmesi + fan-out yasağı). Madde 1'in GERÇEK LiveKit bağlantı doğrulaması BİLEREK
 * bu dosyada YAPILMAZ — `telehealth-consultation-livekit-live.spec.ts`teki `chrome-livekit-media`
 * projesine (gerçek kamera/mikrofon fake-device desteği) devredilir (bkz. o dosyanın YENİ testi,
 * final qa-agent raporu). Bu dosya `chromium` projesinde koşar; burada yalnızca API-seviyesi
 * `200`/`409` sözleşmesi + buton görünürlük/aktiflik durumu doğrulanır.
 *
 * Kendi, İZOLE fixture doktoru/hastası kurar (`telehealth-multi-slot-booking.spec.ts` İLE AYNI
 * desen) — paylaşımlı `telehealth-clinic` demo verisine BAĞIMLI DEĞİLDİR.
 */
test.describe.configure({ mode: "serial" });

const FIXTURE_PASSWORD = "QaE2eJoinAnytimePayments12345!";
const RUN_SUFFIX = Date.now().toString(36);
const PATIENT_EMAIL = `qa-e2e-join-anytime-payments-${RUN_SUFFIX}@example.com`;
const PATIENT_NAME = `QA Join Anytime Hastası ${RUN_SUFFIX}`;

let adminToken: string;
let initialTelehealthEnabled: boolean;
let doctorFixture: CreatedFixtureDoctor;
let patientToken: string;

interface FixtureBookingRef {
  bookingId: string;
  bookingNumber: string;
  appointmentId: string;
  accessToken: string;
  startsAt: string;
}

let bookingPending: FixtureBookingRef;
let bookingActiveFuture: FixtureBookingRef;
let bookingPaidForInvoiceAndPayments: FixtureBookingRef;

/** `telehealth-multi-slot-booking.spec.ts::pickAvailableSlotIso` İLE AYNI desen, `minHours`
 *  eşiğiyle genişletildi — madde 1'in "12+ saat sonrası" iddiasını GERÇEKTEN garanti eder
 *  (`shiftAppointmentIntoJoinWindowDirectly` KULLANILMAZ, bkz. görev talimatı). */
async function pickSlotAtLeastHoursAhead(doctorSlug: string, minHours: number): Promise<string> {
  const { from, to } = defaultSlotRangeISODates(14);
  const slotsRes = await getPublicDoctorSlotsRaw(doctorSlug, from, to);
  const thresholdMs = Date.now() + minHours * 60 * 60_000;
  const slot = (slotsRes.data ?? []).find((s) => s.available && new Date(s.startsAt).getTime() >= thresholdMs);
  if (!slot) throw new Error(`qa-agent: ${doctorSlug} için ${minHours} saat sonrasına ait müsait bir slot bulunamadı.`);
  return slot.startsAt;
}

async function createPatientBooking(startsAtIso: string): Promise<FixtureBookingRef> {
  const res = await createBookingRaw(
    { doctorSlug: doctorFixture.slug, slots: [startsAtIso], patientName: PATIENT_NAME, patientEmail: PATIENT_EMAIL },
    patientToken
  );
  if (res.status !== 201 || !res.data) {
    throw new Error(`qa-agent: booking oluşturulamadı: ${res.status} ${JSON.stringify(res.error)}`);
  }
  return {
    bookingId: res.data.bookingId,
    bookingNumber: res.data.bookingNumber,
    appointmentId: res.data.appointments[0]!.id,
    accessToken: res.data.accessToken,
    startsAt: res.data.appointments[0]!.startsAt,
  };
}

async function cleanupFixtures() {
  await resetFixtureUserToBaseline(adminToken, PATIENT_EMAIL);
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(150_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  await cleanupFixtures();

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);

  doctorFixture = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `QA E2E Join Anytime Doktoru ${RUN_SUFFIX}`,
    bio: "qa-agent — katılım zaman kilidinin kalkması + Ödemelerim sekmesi e2e fixture doktoru.",
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
    ([1, 2, 3, 4, 5, 6, 7] as const).map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }))
  );

  patientToken = await getFixtureUserToken(PATIENT_EMAIL, FIXTURE_PASSWORD, PATIENT_NAME);

  // Booking 1 — ödenmemiş (PENDING), regresyon kontrolü için hiçbir zamanlama/durum değişikliği YAPILMAZ.
  const pendingSlot = await pickSlotAtLeastHoursAhead(doctorFixture.slug, 2);
  bookingPending = await createPatientBooking(pendingSlot);

  // Booking 2 — PAID + randevu saati GERÇEKTEN 12+ saat sonrasında (zaman kilidinin kalktığının
  // kanıtı) — `markBookingPaidDirectly` yalnızca `paymentStatus`u değiştirir, randevunun KENDİ
  // `status`ünü ETKİLEMEZ; bu yüzden `setAppointmentStatusDirectly(..., "SCHEDULED")` AYRICA
  // gerekir (booking-bağlı bir randevu `SCHEDULED`/`IN_PROGRESS` DEĞİLSE `meeting-token` durum
  // kontrolüne — henüz ödeme kontrolüne varmadan — çarpar; `patient-portal.spec.ts::bookingCancelled`
  // İLE AYNI iki-adımlı desen). `daysAgo` VERİLMEZ — zamanlama (`startsAt`/`endsAt`) DOKUNULMADAN
  // GERÇEK gelecekteki slotunu korur.
  const futureSlot = await pickSlotAtLeastHoursAhead(doctorFixture.slug, 12);
  bookingActiveFuture = await createPatientBooking(futureSlot);
  markBookingPaidDirectly(bookingActiveFuture.bookingId);
  setAppointmentStatusDirectly(bookingActiveFuture.appointmentId, "SCHEDULED");

  // Booking 3 — PAID, fatura hard-refresh (madde 2) + "Ödemelerim" (madde 4) testleri için.
  const invoiceSlot = await pickSlotAtLeastHoursAhead(doctorFixture.slug, 3);
  bookingPaidForInvoiceAndPayments = await createPatientBooking(invoiceSlot);
  markBookingPaidDirectly(bookingPaidForInvoiceAndPayments.bookingId);
  setAppointmentStatusDirectly(bookingPaidForInvoiceAndPayments.appointmentId, "SCHEDULED");
});

test.afterAll(async () => {
  await cleanupFixtures();
  if (doctorFixture) await deleteAdminDoctorFixture(adminToken, doctorFixture.id).catch(() => undefined);
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

// =============================================================================
// madde 1 [API, white-box] — backend'in YENİ `isJoinable = booking.paymentStatus === "PAID"`
// şartını, randevunun KENDİ `status` kontrolünden (SCHEDULED/IN_PROGRESS) İZOLE ederek doğrudan
// hedefler: randevuyu ARTIFICIALLY `SCHEDULED`ya çekip booking'i HALA `PENDING` bırakırsak,
// yalnızca YENİ ödeme şartı devrede kalır.
// =============================================================================
test("madde 1 [API, white-box]: booking-bağlı randevu SCHEDULED olsa da booking PENDING ise meeting-token 409 döner; booking PAID olunca (zamanlama HİÇ değişmeden) 200 döner", async () => {
  const slot = await pickSlotAtLeastHoursAhead(doctorFixture.slug, 4);
  const booking = await createPatientBooking(slot);
  setAppointmentStatusDirectly(booking.appointmentId, "SCHEDULED");

  const before = await requestMeetingTokenRaw(booking.appointmentId, booking.accessToken);
  expect(before.status, `qa-agent: booking PENDING iken meeting-token 409 dönmeli, gövde: ${JSON.stringify(before)}`).toBe(409);
  expect((before.error as { code?: string } | undefined)?.code).toBe("APPOINTMENT_NOT_JOINABLE");

  markBookingPaidDirectly(booking.bookingId);
  const after = await requestMeetingTokenRaw(booking.appointmentId, booking.accessToken);
  expect(after.status, `qa-agent: booking PAID olunca (zamanlama HİÇ değişmeden) meeting-token 200 dönmeli: ${JSON.stringify(after)}`).toBe(
    200
  );
});

// =============================================================================
// madde 1 [REGRESYON, UI + API] — ödenmemiş (PENDING) booking: "Toplantıya Katıl" HÂLÂ
// disabled/tıklanamaz, doğrudan API çağrısı da HÂLÂ 409 döner.
// =============================================================================
test("madde 1 [REGRESYON]: ödenmemiş (PENDING) booking → /patient/bookings/{id} sayfasında 'Toplantıya Katıl' HÂLÂ disabled/tıklanamaz, meeting-token doğrudan API çağrısıyla da HÂLÂ 409 döner", async ({
  page,
}) => {
  await page.goto(`/patient/bookings/${bookingPending.bookingId}?t=${encodeURIComponent(bookingPending.accessToken)}`);
  const joinButton = page.getByRole("button", { name: "Toplantıya Katıl" });
  await expect(joinButton).toBeVisible({ timeout: 15_000 });
  await expect(joinButton).toHaveAttribute("aria-disabled", "true");
  await expect(joinButton).toHaveCSS("pointer-events", "none");

  const direct = await requestMeetingTokenRaw(bookingPending.appointmentId, bookingPending.accessToken);
  expect(direct.status, `qa-agent: PENDING booking'in randevusu için meeting-token 409 dönmeli: ${JSON.stringify(direct)}`).toBe(409);
});

// =============================================================================
// madde 1 [ASIL DOĞRULAMA] — PAID booking + randevu saati GERÇEKTEN 12+ saat sonrasında olsa da
// "Toplantıya Katıl"/"Görüşmeye Katıl" AKTİF ve TIKLANABİLİR (zaman kilidi TAMAMEN kalktı, geri
// sayım METNİ hâlâ gösteriliyor). GERÇEK LiveKit bağlantısı `chrome-livekit-media` projesindeki
// AYRI dosyada doğrulanır (bkz. final qa-agent raporu).
// =============================================================================
test("madde 1: PAID booking + randevu saati GERÇEKTEN 12+ saat sonrasında olsa da buton AKTİF ve TIKLANABİLİR (zaman kilidi kalktı)", async ({
  page,
}) => {
  const hoursAhead = (new Date(bookingActiveFuture.startsAt).getTime() - Date.now()) / 3_600_000;
  expect(hoursAhead, "qa-agent: fixture randevusu GERÇEKTEN 12+ saat sonrasında olmalı (zaman kaydırma fixture'ı KULLANILMADI).").toBeGreaterThanOrEqual(
    11.9
  );

  await page.goto(`/patient/bookings/${bookingActiveFuture.bookingId}?t=${encodeURIComponent(bookingActiveFuture.accessToken)}`);
  const joinLink = page.getByRole("link", { name: "Toplantıya Katıl" });
  await expect(joinLink).toBeVisible({ timeout: 15_000 });
  await expect(joinLink).not.toHaveAttribute("aria-disabled", "true");
  const pointerEvents = await joinLink.evaluate((el) => getComputedStyle(el).pointerEvents);
  expect(pointerEvents).not.toBe("none");

  await page.goto(`/consultation/${bookingActiveFuture.appointmentId}?t=${encodeURIComponent(bookingActiveFuture.accessToken)}`);
  // Uzak geri sayım cümlesi hâlâ GÖRÜNÜYOR (salt bilgilendirme, buton ARTIK bunu ENGELLEMİYOR).
  await expect(page.getByText(/Randevunuza .*(saat|dakika).*kaldı\./)).toBeVisible({ timeout: 15_000 });
  const consultJoinButton = page.getByRole("button", { name: "Görüşmeye Katıl" });
  await expect(consultJoinButton).toBeVisible({ timeout: 15_000 });
  await expect(consultJoinButton).toBeEnabled();

  const direct = await requestMeetingTokenRaw(bookingActiveFuture.appointmentId, bookingActiveFuture.accessToken);
  expect(direct.status, `qa-agent: PAID + 12+ saat sonrası randevu için meeting-token 200 dönmeli: ${JSON.stringify(direct)}`).toBe(200);
});

// =============================================================================
// madde 2 — fatura sayfası hard-refresh: oturumlu hasta, YENİ bir sayfa (önceki SPA/JS bellek
// state'i YOK, yalnızca httpOnly refresh çerezi kalıcı) + yapay ağ gecikmesiyle (`/auth/refresh`
// GECİKTİRİLİR — `waitingForSession` penceresini GENİŞLETİP yarış durumunu daha GÜVENİLİR
// tetikler) "Rezervasyon bulunamadı" hatası GÖRÜNMEMELİ, fatura doğru içerikle yüklenmelidir.
// =============================================================================
test("madde 2: /patient/bookings/{id}/invoice — GERÇEK hard-navigate (yeni sayfa, SPA state YOK) + yapay ağ gecikmesiyle 'Rezervasyon bulunamadı' GÖRÜNMEZ, fatura doğru yüklenir", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100" });
  try {
    const loginPage = await context.newPage();
    await loginPage.goto("/login");
    await loginPage.getByLabel("E-posta").fill(PATIENT_EMAIL);
    await loginPage.getByLabel("Şifre").fill(FIXTURE_PASSWORD);
    await loginPage.getByRole("button", { name: "Giriş yap" }).click();
    await loginPage.waitForURL(/\/(dashboard|patient)/, { timeout: 15_000 });
    // httpOnly refresh çerezi context'te KALICIDIR — bu sayfayı kapatmak SPA/JS bellek durumunu
    // (bellekteki access token DAHİL, bkz. `lib/api/token-store.ts`) TAMAMEN atar.
    await loginPage.close();

    // `/auth/refresh` yapay olarak GECİKTİRİLİR — `waitingForSession` penceresi genişler, `load()`in
    // gerçekten BEKLEDİĞİNİ (eskiden ANINDA/anonim ateşlediğini) daha GÜVENİLİR şekilde kanıtlar.
    await context.route("**/api/v1/auth/refresh", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.continue();
    });

    const freshPage = await context.newPage();
    await freshPage.goto(`/patient/bookings/${bookingPaidForInvoiceAndPayments.bookingId}/invoice`, { waitUntil: "domcontentloaded" });

    await expect(freshPage.getByText(/[Rr]ezervasyon bulunamadı/)).toHaveCount(0);
    await expect(freshPage.getByText("Ödeme Belgesi (bilgi amaçlıdır)")).toBeVisible({ timeout: 20_000 });
    // `telehealth.routes.ts::GET /appointments/bookings/{id}/invoice` — `buyer` hastanın
    // KENDİSİDİR (doktor adı faturada YOKTUR, satır açıklaması "Online konsültasyon (N dk)"dır).
    // `main` içine SCOPE edilir — `SiteHeader`in hesap menüsü DE aynı hasta adını (kısaltılmış)
    // taşıdığı için strict-mode'a düşmesin diye (`patient-portal.spec.ts::madde 38`teki AYNI ilke).
    const invoiceMain = freshPage.getByRole("main");
    await expect(invoiceMain.getByText(PATIENT_NAME, { exact: false })).toBeVisible();
    await expect(invoiceMain.getByText(PATIENT_EMAIL)).toBeVisible();
    await expect(invoiceMain.getByText("Online konsültasyon", { exact: false })).toBeVisible();
  } finally {
    await context.close();
  }
});

// =============================================================================
// madde 4 — "Ödemelerim" sekmesi: nav'da görünür, `/patient/payments`e gider, PAID booking
// tabloda görünür, "Makbuzu Görüntüle" doğru faturaya yönlendirir; sayfa açılışında YALNIZCA
// `GET /patient/bookings` atılır (fan-out YOK, [KHP] bağlayıcı kuralı — `patient-portal.spec.ts`
// madde 39 İLE AYNI disiplin).
// =============================================================================
async function loginPatient(browser: Browser) {
  const context = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100" });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(PATIENT_EMAIL);
  await page.getByLabel("Şifre").fill(FIXTURE_PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL(/\/(dashboard|patient)/, { timeout: 15_000 });
  return { page, close: () => context.close() };
}

test("madde 4: 'Ödemelerim' sol navda görünür → /patient/payments'e gider, PAID booking tabloda görünür, 'Makbuzu Görüntüle' doğru faturaya gider; sayfa açılışında fan-out YOK", async ({
  browser,
}) => {
  const { page, close } = await loginPatient(browser);
  try {
    await page.goto("/patient");
    const visibleNav = page.locator('nav[aria-label="Hasta portalı gezinmesi"]:visible');
    const paymentsLink = visibleNav.getByRole("link", { name: "Ödemelerim" });
    await expect(paymentsLink).toBeVisible({ timeout: 15_000 });

    // Fan-out kontrolü — [KHP] bağlayıcı yasağı, `patient-portal.spec.ts` madde 39 İLE AYNI desen:
    // sayfa açılışında YALNIZCA `GET /patient/bookings` beklenir (booking sayısı kadar EK istek YOK).
    const bookingsRequests: string[] = [];
    const onRequest = (req: import("@playwright/test").Request) => {
      if (req.method() !== "GET") return;
      if (/\/api\/v1\/patient\/bookings(\?|$)/.test(req.url())) bookingsRequests.push(req.url());
    };
    page.on("request", onRequest);
    await paymentsLink.click();
    await expect(page).toHaveURL(/\/patient\/payments$/);
    await expect(page.getByRole("heading", { name: "Ödemelerim" })).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    page.off("request", onRequest);

    expect(
      bookingsRequests,
      `qa-agent: /patient/payments açılışında GET /patient/bookings tam olarak 1 kez beklenirdi (fan-out YASAK): ${JSON.stringify(
        bookingsRequests
      )}`
    ).toHaveLength(1);

    // Bu hasta/doktor çifti için BİRDEN FAZLA PAID booking olabilir (`bookingActiveFuture` de PAID) —
    // satırı görev tanımının beklediği görünür "Rezervasyon No" sütunuyla (`bookingNumber`, ID
    // DEĞİL) TEK ANLAMLI olarak hedefleriz.
    const desktopTable = page.locator("table");
    const doctorRow = desktopTable.locator("tr", { has: page.getByText(bookingPaidForInvoiceAndPayments.bookingNumber, { exact: true }) });
    await expect(doctorRow).toBeVisible({ timeout: 15_000 });
    await expect(doctorRow.getByText(doctorFixture.fullName, { exact: false })).toBeVisible();
    await expect(doctorRow.getByText("Ödendi")).toBeVisible();
    await expect(doctorRow.getByText("1 Slot (30 Dk)", { exact: false })).toBeVisible();

    await doctorRow.getByRole("button", { name: "Makbuzu Görüntüle" }).click();
    await expect(page).toHaveURL(new RegExp(`/patient/bookings/${bookingPaidForInvoiceAndPayments.bookingId}/invoice`));
    await expect(page.getByText("Ödeme Belgesi (bilgi amaçlıdır)")).toBeVisible({ timeout: 15_000 });
  } finally {
    await close();
  }
});
