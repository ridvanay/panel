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
  type CreatedFixtureDoctor,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — orkestratörün doğrudan görev talimatı (bug-fix turu, 2026-09-15): backend-agent'ın
 * doktoru `POST .../meeting-token`teki katılım penceresi kontrolünden TAMAMEN muaf tutması
 * (`telehealth.livekit.routes.ts` — yalnızca randevu iptal/tamamlanmamış VE booking `paymentStatus
 * === "PAID"` şartı KORUNUR) + frontend-agent'ın buna karşılık gelen İKİ değişikliği:
 *   1) `join-meeting-button.tsx::mergeRemainingTime` modu artık pencere açık/kapalı/henüz
 *      gelmemiş FARK ETMEKSİZİN HER ZAMAN gerçek, tıklanabilir bir `<a>` render eder (eski
 *      regresyon: pencere kapalıyken buton `<span>`/`<Badge>`'e dönüşüp TAMAMEN KAYBOLUYORDU) +
 *      `consultation-room.tsx::useJoinState`in doktor için zaman kısıtından bypass olması.
 *   2) `doctor-console-patient-card.tsx` üst-sol saat bloğunda doktorun KENDİ diliminde saat +
 *      (`timeZone !== "Europe/Istanbul"` ise) parantez içinde hastanın Europe/Istanbul rezervasyon
 *      saati (`"(HH:mm TSİ)"`) ek gösterimi.
 *
 * `telehealth-doctor-session-guard.spec.ts`/`doctor-console-dashboard-layout.spec.ts` İLE AYNI
 * desen: kendi, İZOLE fixture doktoru/doktorları (`createAdminDoctorFixture` + haftanın HER günü
 * 00:00-24:00 geniş pencere) + kendi-kendine-servis 2FA (`setupAndEnableTwoFactorForSelf`) —
 * paylaşımlı `telehealth-clinic` demo verisine BAĞIMLI DEĞİL.
 */
test.describe.configure({ mode: "serial" });

const FIXTURE_PASSWORD = "QaE2eDoctorJoinWindow12345!";
const RUN_SUFFIX = Date.now().toString(36);
const DOCTOR_TR_EMAIL = `qa-e2e-doctor-join-window-tr-${RUN_SUFFIX}@example.com`;
const DOCTOR_NY_EMAIL = `qa-e2e-doctor-join-window-ny-${RUN_SUFFIX}@example.com`;

const PATIENT_TR = `QA Join Window TSİ Hastası ${RUN_SUFFIX}`;
const PATIENT_NY = `QA Join Window NY Hastası ${RUN_SUFFIX}`;

let adminToken: string;
let initialTelehealthEnabled: boolean;

let doctorTr: CreatedFixtureDoctor;
let doctorTrUserId: string;
let doctorTrUserToken: string;
let doctorTrTotpSecret: string;
let doctorTrAppointmentId: string;
let doctorTrStartsAt: string;
let doctorTrEndsAt: string;

let doctorNy: CreatedFixtureDoctor;
let doctorNyUserId: string;
let doctorNyUserToken: string;
let doctorNyTotpSecret: string;
let doctorNyStartsAt: string;
let doctorNyEndsAt: string;

async function cleanupFixtures() {
  await resetFixtureUserToBaseline(adminToken, DOCTOR_TR_EMAIL);
  await resetFixtureUserToBaseline(adminToken, DOCTOR_NY_EMAIL);
}

/** `GET /doctors/{slug}/slots`'tan İLK müsait slotu döner — `SLOT_BOOKING_BUFFER_MS` (2 saat,
 * `backend/src/modules/telehealth/lib/availability.ts`) müsait dönen HER slotun katılım
 * penceresinin (`JOIN_WINDOW_BEFORE_START_MS`, 10 dk) ÇOK ötesinde/kapalı olduğunu garanti eder —
 * `telehealth-multi-slot-booking.spec.ts::pickAvailableSlotIso` İLE AYNI desen. */
async function pickAvailableSlotIso(doctorSlug: string): Promise<string> {
  const { from, to } = defaultSlotRangeISODates(14);
  const slotsRes = await getPublicDoctorSlotsRaw(doctorSlug, from, to);
  const slot = (slotsRes.data ?? []).find((s) => s.available);
  if (!slot) throw new Error(`${doctorSlug} için müsait bir slot bulunamadı.`);
  return slot.startsAt;
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(150_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  await cleanupFixtures();

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);

  // ---- Doktor 1 — Europe/Istanbul (madde 1: katılım penceresi bypass'ı + madde 2a: TSİ regresyonu) ----
  doctorTr = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `QA E2E Katılım Penceresi TSİ Doktoru ${RUN_SUFFIX}`,
    bio: "qa-agent — doktor konsolu katılım penceresi bypass'ı + saat gösterimi e2e fixture doktoru.",
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
    doctorTr.id,
    ([1, 2, 3, 4, 5, 6, 7] as const).map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }))
  );
  doctorTrUserToken = await getFixtureUserToken(DOCTOR_TR_EMAIL, FIXTURE_PASSWORD, "QA E2E Doktor Join Window TSİ");
  const doctorTrUser = await adminGetUserByEmail(adminToken, DOCTOR_TR_EMAIL);
  if (!doctorTrUser) throw new Error("qa-agent: TSİ doktor fixture kullanıcısı oluşturulamadı.");
  doctorTrUserId = doctorTrUser.id;
  await linkDoctorUserRaw(adminToken, doctorTr.id, doctorTrUserId);
  const doctorTrTwoFactor = await setupAndEnableTwoFactorForSelf(doctorTrUserToken);
  doctorTrTotpSecret = doctorTrTwoFactor.secret;

  const trSlot = await pickAvailableSlotIso(doctorTr.slug);
  const trBooking = await createBookingRaw({
    doctorSlug: doctorTr.slug,
    slots: [trSlot],
    patientName: PATIENT_TR,
    patientEmail: `qa-e2e-join-window-tr-${RUN_SUFFIX}@example.com`,
  });
  if (trBooking.status !== 201 || !trBooking.data) {
    throw new Error(`qa-agent: TSİ doktoru için booking oluşturulamadı: ${JSON.stringify(trBooking.error)}`);
  }
  markBookingPaidDirectly(trBooking.data.bookingId);
  doctorTrAppointmentId = trBooking.data.appointments[0]!.id;
  doctorTrStartsAt = trBooking.data.appointments[0]!.startsAt;
  doctorTrEndsAt = trBooking.data.appointments[0]!.endsAt;

  // ---- Doktor 2 — America/New_York (madde 2b: çift saat gösterimi) ----
  doctorNy = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `QA E2E Katılım Penceresi NY Doktoru ${RUN_SUFFIX}`,
    bio: "qa-agent — doktor konsolu çift saat dilimi gösterimi e2e fixture doktoru.",
    languages: ["en"],
    timeZone: "America/New_York",
    sessionDurationMin: 30,
    sessionPriceCents: 40000,
    currency: "USD",
    isVerified: true,
    isActive: true,
  });
  await setDoctorAvailabilityRaw(
    adminToken,
    doctorNy.id,
    ([1, 2, 3, 4, 5, 6, 7] as const).map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }))
  );
  doctorNyUserToken = await getFixtureUserToken(DOCTOR_NY_EMAIL, FIXTURE_PASSWORD, "QA E2E Doktor Join Window NY");
  const doctorNyUser = await adminGetUserByEmail(adminToken, DOCTOR_NY_EMAIL);
  if (!doctorNyUser) throw new Error("qa-agent: NY doktor fixture kullanıcısı oluşturulamadı.");
  doctorNyUserId = doctorNyUser.id;
  await linkDoctorUserRaw(adminToken, doctorNy.id, doctorNyUserId);
  const doctorNyTwoFactor = await setupAndEnableTwoFactorForSelf(doctorNyUserToken);
  doctorNyTotpSecret = doctorNyTwoFactor.secret;

  const nySlot = await pickAvailableSlotIso(doctorNy.slug);
  const nyBooking = await createBookingRaw({
    doctorSlug: doctorNy.slug,
    slots: [nySlot],
    patientName: PATIENT_NY,
    patientEmail: `qa-e2e-join-window-ny-${RUN_SUFFIX}@example.com`,
  });
  if (nyBooking.status !== 201 || !nyBooking.data) {
    throw new Error(`qa-agent: NY doktoru için booking oluşturulamadı: ${JSON.stringify(nyBooking.error)}`);
  }
  markBookingPaidDirectly(nyBooking.data.bookingId);
  doctorNyStartsAt = nyBooking.data.appointments[0]!.startsAt;
  doctorNyEndsAt = nyBooking.data.appointments[0]!.endsAt;
});

test.afterAll(async () => {
  await cleanupFixtures();
  if (doctorTr) await deleteAdminDoctorFixture(adminToken, doctorTr.id).catch(() => undefined);
  if (doctorNy) await deleteAdminDoctorFixture(adminToken, doctorNy.id).catch(() => undefined);
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

/** `telehealth-doctor-session-guard.spec.ts::loginDoctorWithTwoFactor` İLE AYNI desen — düz
 * `/login`'den GERÇEK 2FA login akışı, `/doctor`'a düşer. */
async function loginDoctorWithTwoFactor(browser: Browser, email: string, totpSecret: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3100",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill(FIXTURE_PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();

  await expect(page.getByText("Kimlik doğrulama uygulamanızdaki 6 haneli kodu", { exact: false })).toBeVisible({ timeout: 15_000 });
  const code = authenticator.generate(totpSecret);
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

// `formatTime`/`formatTimeZoneAbbreviation` (`frontend/src/lib/telehealth-format.ts`) İLE BİREBİR
// AYNI mantık — testin KENDİ, bağımsız kopyası (uygulama kaynağı import EDİLMEZ, bu dosyanın diğer
// yardımcılarındaki ilke).
function formatTimeInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("tr-TR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}
function formatTimeZoneAbbreviationInZone(iso: string, timeZone: string): string {
  if (timeZone === "Europe/Istanbul") return "TSİ";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(new Date(iso));
  return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
}

// =============================================================================
// madde 1a — doktor konsolunda "Odaya Katıl" HER ZAMAN gerçek/tıklanabilir bir link olarak render
// edilir (katılım penceresi kapalı OLSA BİLE), doğru `/consultation/{id}` hedefini taşır.
// =============================================================================
test("madde 1a: katılım penceresi KAPALIYKEN bile 'Odaya Katıl' /doctor konsolunda gerçek, tıklanabilir bir link'tir (doğru href taşır)", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const { page, close } = await loginDoctorWithTwoFactor(browser, DOCTOR_TR_EMAIL, doctorTrTotpSecret);
  try {
    await expect(page.getByRole("heading", { name: "Doktor Konsolu" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(PATIENT_TR, { exact: true })).toBeVisible({ timeout: 15_000 });

    // Regresyonun asıl konusu: randevu saatine saatler/günler kalmış (katılım penceresi KAPALI —
    // `SLOT_BOOKING_BUFFER_MS` 2 saat ötesinde bir slot seçildi, bkz. `pickAvailableSlotIso`), ama
    // buton yine de DOM'da mevcut, GÖRÜNÜR ve tıklanabilir GERÇEK bir `<a>` (eski davranışta bu
    // durumda buton tamamen `<span>`/`<Badge>`'e dönüşüp KAYBOLUYORDU).
    const joinLink = page.getByRole("link", { name: "Odaya Katıl" });
    await expect(joinLink).toBeVisible({ timeout: 15_000 });
    await expect(joinLink).not.toHaveAttribute("aria-disabled", "true");
    // `disabled:pointer-events-none` Tailwind sınıfı HER `Button`'da (varyant fark etmeksizin)
    // KOD OLARAK vardır — yalnızca gerçek bir `:disabled` durumunda AKTİF olur. Bu yüzden sınıf
    // adı metniyle DEĞİL, gerçek hesaplanmış stille (`getComputedStyle().pointerEvents`) doğrulanır.
    const pointerEvents = await joinLink.evaluate((el) => getComputedStyle(el).pointerEvents);
    expect(pointerEvents).not.toBe("none");
    await expect(joinLink).toHaveAttribute("href", new RegExp(`/consultation/${doctorTrAppointmentId}`));
  } finally {
    await close();
  }
});

// =============================================================================
// madde 1b [qa-agent BULGUSU → architect KARARI ile ÇÖZÜLDÜ, 2026-09-15] — doktor-subdomain
// izolasyonu AÇIKKEN (`NEXT_PUBLIC_DOCTOR_URL` ayrı bir hostname'e çözülüyorsa, bu e2e ortamının
// KENDİSİ DAHİL, bkz. `playwright.config.ts` dosya başlığı) "Odaya Katıl" tıklaması GERÇEKTEN
// konsültasyon odasına GÖTÜRÜR. Bu test, İKİ TAMAMLAYICI düzeltmeyi birlikte korur
// (`.claude/architect-scope-doctor-subdomain.md` §5.6.1):
//   1) `join-meeting-button.tsx` (`mergeRemainingTime` modu) href'i `SITE_ORIGIN` ile MUTLAK üretir
//      → tarayıcı doktor host'undan ANA site origin'ine cross-origin gider (oturum §6'daki refresh
//      çerezi ile yeni origin'de yeniden kurulur).
//   2) `doctor-portal-route-guard.tsx::isDoctorSharedRouteException()` → `/consultation/{id}` guard'ın
//      DAR kapsamlı TEK istisnasıdır; doktor orada KALIR (önceki regresyon: guard `/doctor`'a ANINDA
//      geri gönderiyordu, `page.waitForURL(/\/consultation\/.../)` asla gerçekleşmiyordu).
// Bu desen `proxy.ts::DOCTOR_PORTAL_ROUTE_PATTERN`'a TAŞINMAZ (hasta `?t=` erişimini bozar) —
// gerekçe §5.6.1'de ve guard dosyasındadır.
// =============================================================================
test(
  "madde 1b: doktor-subdomain izolasyonu açıkken 'Odaya Katıl' tıklaması doktoru GERÇEKTEN konsültasyon odasına götürür",
  async ({ browser }) => {
    test.setTimeout(60_000);
    const { page, close } = await loginDoctorWithTwoFactor(browser, DOCTOR_TR_EMAIL, doctorTrTotpSecret);
    try {
      const joinLink = page.getByRole("link", { name: "Odaya Katıl" });
      await expect(joinLink).toBeVisible({ timeout: 15_000 });
      await joinLink.click();
      await page.waitForURL(new RegExp(`/consultation/${doctorTrAppointmentId}`), { timeout: 20_000 });
      // Guard'ın "geri itme"si ASENKRONDUR (auth `loading` → `authenticated` geçişinden SONRA
      // tetiklenir) — bu yüzden URL'e varmak TEK BAŞINA yeterli kanıt DEĞİLDİR; oturum kurulup
      // guard'ın çalışma fırsatı bulduğu ana kadar bekleyip URL'in HÂLÂ konsültasyon odasında
      // olduğunu doğrularız.
      await expect
        .poll(async () => new URL(page.url()).pathname, { timeout: 15_000, intervals: [1_000, 1_000, 1_000, 2_000, 2_000] })
        .toContain(`/consultation/${doctorTrAppointmentId}`);

      await expect(page.getByText("Bu randevunun katılım penceresi kapanmıştır")).toHaveCount(0);
      const joinButton = page.getByRole("button", { name: "Görüşmeye Katıl" });
      const notConfiguredHeading = page.getByRole("heading", { name: "Görüntülü Görüşme Yapılandırılmamış" });
      await expect(joinButton.or(notConfiguredHeading).first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await close();
    }
  }
);

// =============================================================================
// madde 2a — Europe/Istanbul doktoru için saat regresyonu: yalnızca doktorun (= hastanın) TEK
// dilimindeki saat + "(TSİ)" gösterilir, çift saat EKLENMEZ.
// =============================================================================
test("madde 2a: doktorun kendi dilimi Europe/Istanbul ise kart yalnızca TEK saat aralığı + '(TSİ)' gösterir (çift saat YOK)", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const { page, close } = await loginDoctorWithTwoFactor(browser, DOCTOR_TR_EMAIL, doctorTrTotpSecret);
  try {
    await expect(page.getByText(PATIENT_TR, { exact: true })).toBeVisible({ timeout: 15_000 });

    const expectedStart = formatTimeInZone(doctorTrStartsAt, "Europe/Istanbul");
    const expectedEnd = formatTimeInZone(doctorTrEndsAt, "Europe/Istanbul");

    await expect(page.getByText(`${expectedStart} - ${expectedEnd}`, { exact: false })).toBeVisible();
    await expect(page.getByText("(TSİ)", { exact: true })).toBeVisible();
  } finally {
    await close();
  }
});

// =============================================================================
// madde 2b — doktorun dilimi Europe/Istanbul'DAN FARKLIYSA (America/New_York) kart HEM doktorun
// kendi diliminde saati HEM DE parantez içinde hastanın Europe/Istanbul rezervasyon saatini
// ("(HH:mm TSİ)") gösterir.
// =============================================================================
test("madde 2b: doktorun dilimi America/New_York ise kart doktor-diliminde saat + parantez içinde hastanın TSİ rezervasyon saatini gösterir", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const { page, close } = await loginDoctorWithTwoFactor(browser, DOCTOR_NY_EMAIL, doctorNyTotpSecret);
  try {
    await expect(page.getByText(PATIENT_NY, { exact: true })).toBeVisible({ timeout: 15_000 });

    const expectedDoctorStart = formatTimeInZone(doctorNyStartsAt, "America/New_York");
    const expectedDoctorEnd = formatTimeInZone(doctorNyEndsAt, "America/New_York");
    const expectedAbbrev = formatTimeZoneAbbreviationInZone(doctorNyStartsAt, "America/New_York");
    const expectedIstanbulStart = formatTimeInZone(doctorNyStartsAt, "Europe/Istanbul");

    // Doktorun KENDİ diliminde saat aralığı — kartın en belirgin (sol üst) öğesi.
    await expect(page.getByText(`${expectedDoctorStart} - ${expectedDoctorEnd}`, { exact: false })).toBeVisible();

    // Parantez içi ek gösterim — kısaltma + hastanın GERÇEK Europe/Istanbul rezervasyon saati.
    // `doctor-console-patient-card.tsx`'in ürettiği BİREBİR metin: "{abbrev} ({HH:mm} TSİ)".
    await expect(page.getByText(`${expectedAbbrev} (${expectedIstanbulStart} TSİ)`, { exact: false })).toBeVisible();

    // Kontrast — sade "(TSİ)" (madde 2a'nın tek-dilim biçimi) BU kartta GÖRÜNMEZ, dual-time biçimi
    // her zaman kısaltma + parantez taşır.
    await expect(page.getByText("(TSİ)", { exact: true })).toHaveCount(0);
  } finally {
    await close();
  }
});
