import { test, expect, type Browser, type Page } from "@playwright/test";
import { API_BASE_URL, getCachedAdminSession, getFixtureUserToken, getSiteModules, patchSiteModule, postStripeTelehealthBookingPaid } from "./support/api";
import { createAuthenticatedPage, createAuthenticatedPageAs } from "./support/admin-session";
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
  upsertBookingIntakeRaw,
  uploadBookingDocumentRaw,
  markBookingPaidDirectly,
  setAppointmentStatusDirectly,
  shiftAppointmentIntoJoinWindowDirectly,
  setUserEmailVerifiedDirectly,
  type CreatedFixtureDoctor,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — `.claude/architect-scope-telehealth-template.md` [KHP] §9.8.7 "QA kapsamı" (bağlayıcı,
 * madde 34-41) + orkestratörün ek doğrulama maddeleri (ödeme-sonrası anlık görünürlük, doğru LiveKit
 * odasına yönlendirme, belge/epikriz görüntüleme akışları). Kurumsal Hasta Portalı (`/patient`,
 * `/patient/appointments`, `/patient/documents`, `/patient/prescriptions`, `/patient/profile`) —
 * ui-designer (`.claude/design-notes-telehealth.md` §14) + frontend-agent + backend-agent (§9.8.4
 * KARAR O, `scope`/`counts`) ÜÇÜNÜN ÇIKTISINI e2e olarak doğrular. Regresyon koruması (madde 36) AYRI
 * dosyalarda zaten kapsanır (`telehealth-multi-slot-booking.spec.ts` madde 24/28 — magic-link `?t=`
 * ile `/patient/bookings/{id}` erişimi; bu dosyada TEKRAR yazılmaz, yalnızca madde 41 için gereken
 * TEK bir hafif ek kontrol vardır).
 *
 * qa-agent bulgusu (bu turda, REGRESYON — frontend-agent'ın değişikliği yüzünden STALE hale gelen
 * MEVCUT bir test) — `telehealth-portal-isolation.spec.ts` "madde 2" testi `site-header.tsx`'teki
 * "Randevularım" bağlantısının hedefinin `/patient/bookings`'ten `/patient/appointments`'e
 * GÜNCELLENMESİNİ (bu turun kasıtlı, doğru davranışı, §9.8.3) yansıtmıyordu — qa-agent BU TURDA o
 * testin URL beklentisini güncelledi (bkz. final rapor); BURADA TEKRAR test edilmez.
 *
 * İzole fixture doktor/hasta/doktor-hesabı kurar (`telehealth-portal-isolation.spec.ts` İLE AYNI
 * desen) — paylaşımlı `telehealth-clinic` demo verisine BAĞIMLI DEĞİLDİR. `POST /appointments/bookings`
 * 5/dk hız sınırına saygı göstermek için toplam 4 booking oluşturma çağrısı yapılır (aynı dosyanın
 * yaptığı gibi).
 *
 * `mode: "serial"` KULLANILIR (`telehealth-multi-slot-booking.spec.ts` İLE AYNI) — qa-agent bulgusu:
 * `serial` OLMADAN bir test kırmızı olunca (`expect.soft` bile olsa) Playwright bu makinede worker'ı
 * YENİDEN BAŞLATIP `beforeAll`'ı İKİNCİ KEZ çalıştırdı (gözlemlenen davranış — `POST /appointments/
 * bookings` 5/dk hız sınırına gereksiz ikinci bir yük bindirdi). Bunun yerine BİLİNEN kırmızı test
 * (madde 39, aşağıda) dosyanın EN SONUNA taşınır — `serial` modunda bir test kırmızı olunca yalnızca
 * ONDAN SONRAKİ testler atlanır; madde 39'u sona koymak DİĞER TÜM testlerin (34/35/37/38/40/41/ek
 * doğrulamalar) gerçekten ÇALIŞIP raporlanmasını garanti eder.
 */
test.describe.configure({ mode: "serial" });

const FIXTURE_PASSWORD = "QaE2ePatientPortal12345!";
const RUN_SUFFIX = Date.now().toString(36);
const PATIENT_EMAIL = `qa-e2e-patient-portal-${RUN_SUFFIX}@example.com`;
const DOCTOR_USER_EMAIL = `qa-e2e-patient-portal-doctor-${RUN_SUFFIX}@example.com`;
const PATIENT_NAME = `QA E2E Hasta Portalı ${RUN_SUFFIX}`;

let adminToken: string;
let initialTelehealthEnabled: boolean;
let doctorFixture: CreatedFixtureDoctor;
let doctorUserId: string;
let doctorUserToken: string;
let patientToken: string;
let patientUserId: string;

interface FixtureBookingRef {
  bookingId: string;
  appointmentId: string;
  accessToken: string;
}

let bookingUpcoming: FixtureBookingRef; // ödeme webhook'uyla PAID edilir, katılım penceresine kaydırılır
let bookingCancelled: FixtureBookingRef;
let bookingPast: FixtureBookingRef; // kaybolma regresyonu — SCHEDULED ama endsAt geçmişte
let bookingDocsAndNote: FixtureBookingRef; // belge + epikriz görüntüleme akışları

async function pickAvailableSlot(doctorSlug: string): Promise<string> {
  const { from, to } = defaultSlotRangeISODates(14);
  const slotsRes = await getPublicDoctorSlotsRaw(doctorSlug, from, to);
  const slot = (slotsRes.data ?? []).find((s) => s.available);
  if (!slot) throw new Error(`qa-agent: ${doctorSlug} için müsait slot bulunamadı (hasta portalı fixture'ı).`);
  return slot.startsAt;
}

async function createPatientBooking(doctorSlug: string): Promise<FixtureBookingRef> {
  const slot = await pickAvailableSlot(doctorSlug);
  const res = await createBookingRaw({ doctorSlug, slots: [slot], patientName: PATIENT_NAME, patientEmail: PATIENT_EMAIL }, patientToken);
  if (res.status !== 201 || !res.data) {
    throw new Error(`qa-agent: hasta portalı fixture booking'i oluşturulamadı: ${res.status} ${JSON.stringify(res.error)}`);
  }
  return { bookingId: res.data.bookingId, appointmentId: res.data.appointments[0]!.id, accessToken: res.data.accessToken };
}

async function cleanupFixtures() {
  await resetFixtureUserToBaseline(adminToken, PATIENT_EMAIL);
  await resetFixtureUserToBaseline(adminToken, DOCTOR_USER_EMAIL);
}

test.beforeAll(async () => {
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  await cleanupFixtures();

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);

  // ---- İzole fixture doktor (haftanın HER günü geniş pencere) ----
  doctorFixture = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `QA E2E Hasta Portalı Doktoru ${RUN_SUFFIX}`,
    bio: "qa-agent — kurumsal hasta portalı e2e fixture doktoru.",
    languages: ["tr"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: 50000,
    currency: "TRY",
    isVerified: true,
    isActive: true,
  });
  await setDoctorAvailabilityRaw(
    adminToken,
    doctorFixture.id,
    ([1, 2, 3, 4, 5, 6, 7] as const).map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }))
  );

  // ---- Doktor hesabı (2FA GEREKMEZ — bu dosyada yalnızca `/patient` guard'ı ve konsültasyon
  // notu yazma ucu test edilir, doktor konsolu oturum akışı DEĞİL). ----
  doctorUserToken = await getFixtureUserToken(DOCTOR_USER_EMAIL, FIXTURE_PASSWORD, "QA E2E Hasta Portalı Doktoru Hesabı");
  const doctorUser = await adminGetUserByEmail(adminToken, DOCTOR_USER_EMAIL);
  if (!doctorUser) throw new Error("qa-agent: doktor fixture kullanıcısı oluşturulamadı.");
  doctorUserId = doctorUser.id;
  await linkDoctorUserRaw(adminToken, doctorFixture.id, doctorUserId);

  // ---- Hasta hesabı — künye (identity) `createBookingRaw`'ın VARSAYILANI (`VALID_TEST_TR_IDENTITY`)
  // ile otomatik doldurulur (test 40'ın künye bölümü buna dayanır). E-posta BİLİNÇLİ OLARAK
  // doğrulanmış işaretlenir (test 40'ın `success` tonlu rozet ihtimalini de kapsaması için). ----
  patientToken = await getFixtureUserToken(PATIENT_EMAIL, FIXTURE_PASSWORD, PATIENT_NAME);
  const patientUser = await adminGetUserByEmail(adminToken, PATIENT_EMAIL);
  if (!patientUser) throw new Error("qa-agent: hasta fixture kullanıcısı oluşturulamadı.");
  patientUserId = patientUser.id;
  setUserEmailVerifiedDirectly(patientUserId, true);

  // ---- Booking 1/4 — "Aktif" (upcoming): GERÇEK Stripe webhook'uyla PENDING → PAID (ödeme
  // sonrası anlık görünürlük doğrulaması bu booking üzerinden yapılır), ardından katılım
  // penceresine kaydırılır (Toplantıya Katıl / doğru LiveKit odası doğrulaması). ----
  bookingUpcoming = await createPatientBooking(doctorFixture.slug);
  const webhookRes = await postStripeTelehealthBookingPaid(bookingUpcoming.bookingId, { rawAccessToken: bookingUpcoming.accessToken });
  if (webhookRes.status !== 200) {
    throw new Error(`qa-agent: ödeme webhook'u başarısız: ${webhookRes.status}`);
  }

  // ---- Booking 2/4 — "İptal" (cancelled). ----
  bookingCancelled = await createPatientBooking(doctorFixture.slug);
  markBookingPaidDirectly(bookingCancelled.bookingId);
  setAppointmentStatusDirectly(bookingCancelled.appointmentId, "CANCELLED");

  // ---- Booking 3/4 — "Geçmiş" (past, kaybolma regresyonu — SCHEDULED ama randevu saati geçmişte). ----
  bookingPast = await createPatientBooking(doctorFixture.slug);
  markBookingPaidDirectly(bookingPast.bookingId);
  setAppointmentStatusDirectly(bookingPast.appointmentId, "SCHEDULED", { daysAgo: 2 });

  // ---- Booking 4/4 — belge + epikriz (doktorun GERÇEK `/complete` ucuyla yazdığı konsültasyon
  // notu + hastanın GERÇEK yüklediği bir belge). ----
  bookingDocsAndNote = await createPatientBooking(doctorFixture.slug);
  markBookingPaidDirectly(bookingDocsAndNote.bookingId);
  setAppointmentStatusDirectly(bookingDocsAndNote.appointmentId, "SCHEDULED");
  // §9.7.5 KARAR J — belge yüklemeden ÖNCE AYRI, açık sağlık-verisi rızası (`healthDataConsent`)
  // ZORUNLU (`telehealth-bookings.test.ts` "healthDataConsent olmadan ... belge yükleme de RIZA
  // OLMADAN reddedilir" testiyle AYNI ön koşul).
  const intakeRes = await upsertBookingIntakeRaw(
    bookingDocsAndNote.bookingId,
    { note: "qa-agent fixture — belge/epikriz akışı ön bilgi notu.", healthDataConsent: true },
    { bearerToken: patientToken }
  );
  if (intakeRes.status !== 200) {
    throw new Error(`qa-agent: sağlık verisi rızası (intake) kaydedilemedi: ${intakeRes.status} ${JSON.stringify(intakeRes.error)}`);
  }
  const uploadRes = await uploadBookingDocumentRaw(
    bookingDocsAndNote.bookingId,
    { filename: "qa-e2e-patient-portal-tahlil.pdf", mimeType: "application/pdf", bytes: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("qa-agent-patient-portal-fixture")]) },
    { bearerToken: patientToken }
  );
  if (uploadRes.status !== 201) {
    throw new Error(`qa-agent: belge yüklenemedi: ${uploadRes.status} ${JSON.stringify(uploadRes.error)}`);
  }
  const completeRes = await fetch(`${API_BASE_URL}/appointments/${bookingDocsAndNote.appointmentId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${doctorUserToken}` },
    body: JSON.stringify({ note: "<p>Reçete: Parasetamol 500mg günde 2 kez — qa-agent fixture notu.</p>" }),
  });
  if (completeRes.status !== 200) {
    throw new Error(`qa-agent: konsültasyon notu yazılamadı: ${completeRes.status} ${await completeRes.text()}`);
  }

  // Katılım penceresi (bookingUpcoming) — booking'lerin HEPSİ oluşturulduktan SONRA kaydırılır ki
  // pencere testinin ÇALIŞMA ANINA olabildiğince yakın kalsın (5/dk hız sınırına saygı için
  // booking oluşturma çağrıları arasında zaman geçer).
  shiftAppointmentIntoJoinWindowDirectly(bookingUpcoming.appointmentId, 90, 30);
});

test.afterAll(async () => {
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
  await cleanupFixtures();
  // Doktorun GERÇEK randevuları var (`Appointment.doctor` `onDelete: Restrict`) — silme 409 ile
  // başarısız olabilir, `telehealth-portal-isolation.spec.ts::afterAll` İLE AYNI gerekçeyle
  // SESSİZCE yutulur (leftover satır RUN_SUFFIX benzersizliği sayesinde sonraki koşumları bozmaz).
  await deleteAdminDoctorFixture(adminToken, doctorFixture.id).catch(() => undefined);
});

async function loginAsPatient(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  return createAuthenticatedPageAs(browser, PATIENT_EMAIL, FIXTURE_PASSWORD);
}

// =============================================================================
// [KHP] §9.8.7 test 34 — hero kartı + 5 hedefli gezinme
// =============================================================================
test("madde 34: oturumlu hasta /patient → hero kartı + 5 hedefli gezinme görünür, her hedefe tıklanabilir", async ({ browser }) => {
  const { page, close } = await loginAsPatient(browser);
  try {
    await page.goto("/patient");
    await expect(page.getByRole("heading", { name: `Merhaba, ${PATIENT_NAME}` })).toBeVisible({ timeout: 15_000 });
    // "En yakın randevu" paneli — `bookingUpcoming` (PAID, katılım penceresi açık) seçilmeli.
    await expect(page.getByText(`${doctorFixture.title} ${doctorFixture.fullName}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Toplantıya Katıl" })).toBeVisible();

    // `PatientPortalNav` İKİ KEZ render edilir (`variant="strip"` `<lg`, `variant="rail"` `lg:`,
    // §14.1) — AYNI `aria-label`'ı paylaşırlar. Varsayılan masaüstü viewport'ta (`lg`+) yalnızca
    // `rail` GÖRÜNÜRDÜR (`strip` `lg:hidden`); CSS `:visible` sözde-seçicisiyle YALNIZCA görünen
    // nav'ı hedefleriz — aksi halde `.first()` DOM sırasına göre GİZLİ `strip` linkini seçip
    // tıklama sonsuza kadar zaman aşımına uğrardı.
    const visibleNav = page.locator('nav[aria-label="Hasta portalı gezinmesi"]:visible');
    await expect(visibleNav).toHaveCount(1);

    for (const [label, href] of [
      ["Genel Bakış", "/patient"],
      ["Randevularım", "/patient/appointments"],
      ["Belgelerim", "/patient/documents"],
      ["Reçetelerim", "/patient/prescriptions"],
      ["Profilim", "/patient/profile"],
    ] as const) {
      const navLink = visibleNav.getByRole("link", { name: label });
      await expect(navLink).toBeVisible();
      await navLink.click();
      await expect(page).toHaveURL(new RegExp(`${href.replace(/\//g, "\\/")}$`));
    }
  } finally {
    await close();
  }
});

// =============================================================================
// [KHP] §9.8.7 test 35 — 3 sekme, URL `?scope=`, sayaçlar sekmeye göre DEĞİŞMEZ
// =============================================================================
test("madde 35: /patient/appointments — 3 sekme, sekme değişince liste ve URL değişir; sayaç rozetleri DEĞİŞMEZ", async ({ browser }) => {
  const { page, close } = await loginAsPatient(browser);
  try {
    await page.goto("/patient/appointments");
    await expect(page.getByRole("heading", { name: "Randevularım" })).toBeVisible({ timeout: 15_000 });

    // Varsayılan sekme "Aktif" (`upcoming`) — yalnızca `bookingUpcoming` eşleşir.
    await expect(page).toHaveURL(/\?scope=upcoming$|\/appointments$/);
    const activeTab = page.getByRole("tab", { name: /^Aktif/ });
    const pastTab = page.getByRole("tab", { name: /^Geçmiş/ });
    const cancelledTab = page.getByRole("tab", { name: /^İptal/ });
    await expect(activeTab).toBeVisible();

    const activeBadgeBefore = await activeTab.locator("span").last().textContent();
    const pastBadgeBefore = await pastTab.locator("span").last().textContent();
    const cancelledBadgeBefore = await cancelledTab.locator("span").last().textContent();

    // `BookingListView` AYNI ANDA hem mobil kart listesini (`md:hidden`) hem masaüstü tabloyu
    // (`hidden md:table`) render eder (§12.5.1/§12.5.2) — varsayılan masaüstü viewport'ta (`md`+)
    // yalnızca `<table>` GÖRÜNÜRDÜR; `getByText` ikisini BİRDEN eşleştirip strict-mode'a düşmesin
    // diye `table` köküne SCOPE edilir.
    const desktopTable = page.locator("table");

    await pastTab.click();
    await expect(page).toHaveURL(/scope=past/);
    await expect(desktopTable.getByText(`${doctorFixture.title} ${doctorFixture.fullName}`)).toBeVisible({ timeout: 15_000 });

    await cancelledTab.click();
    await expect(page).toHaveURL(/scope=cancelled/);
    await expect(desktopTable.getByText(`${doctorFixture.title} ${doctorFixture.fullName}`)).toBeVisible({ timeout: 15_000 });

    // Sayaç rozetleri sekme değişse de DEĞİŞMEMELİ (§14.4 — `meta.counts` `scope`'tan bağımsızdır).
    await expect(activeTab.locator("span").last()).toHaveText(activeBadgeBefore ?? "");
    await expect(pastTab.locator("span").last()).toHaveText(pastBadgeBefore ?? "");
    await expect(cancelledTab.locator("span").last()).toHaveText(cancelledBadgeBefore ?? "");
  } finally {
    await close();
  }
});

// =============================================================================
// Ek doğrulama — ödeme sonrası anlık görünürlük (GERÇEK Stripe webhook'u, `beforeAll`'da tetiklendi)
// =============================================================================
test("ek doğrulama: webhook ile ödenen booking ANINDA /patient (hero) ve /patient/appointments panelinde görünür", async ({ browser }) => {
  const { page, close } = await loginAsPatient(browser);
  try {
    await page.goto("/patient");
    await expect(page.getByText(`${doctorFixture.title} ${doctorFixture.fullName}`)).toBeVisible({ timeout: 15_000 });
    // Ödenmiş + katılım penceresi açık → "Ödemeyi Tamamla" DEĞİL, "Toplantıya Katıl" görünür.
    await expect(page.getByRole("link", { name: "Ödemeyi Tamamla" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Toplantıya Katıl" })).toBeVisible();

    await page.goto("/patient/appointments");
    // `BookingListView` mobil kart + masaüstü tablo İKİSİNİ BİRDEN render eder — masaüstü
    // viewport'ta yalnızca `<table>` görünür (bkz. "madde 35" testindeki AYNI gerekçe).
    await expect(page.locator("table").getByText(`${doctorFixture.title} ${doctorFixture.fullName}`)).toBeVisible({ timeout: 15_000 });
  } finally {
    await close();
  }
});

// =============================================================================
// Ek doğrulama — "Toplantıya Katıl" doğru LiveKit odasına (doğru randevuya) yönlendiriyor
// =============================================================================
test("ek doğrulama: hero karttaki 'Toplantıya Katıl' doğru randevunun konsültasyon sayfasına yönlendirir", async ({ browser }) => {
  const { page, close } = await loginAsPatient(browser);
  try {
    await page.goto("/patient");
    const joinLink = page.getByRole("link", { name: "Toplantıya Katıl" });
    await expect(joinLink).toBeVisible({ timeout: 15_000 });
    await joinLink.click();
    await expect(page).toHaveURL(new RegExp(`/consultation/${bookingUpcoming.appointmentId}`));
    // Oda başlığı DOĞRU doktorun adını taşır — `ConsultationRoom` `appointmentId`'den GERÇEK
    // randevuyu çözer, bu yüzden başlığın doğru doktoru göstermesi "doğru LiveKit odasına
    // yönlendirme" iddiasının (route/appointment eşleşmesi düzeyinde) somut kanıtıdır.
    await expect(page.getByRole("heading", { name: `${doctorFixture.title} ${doctorFixture.fullName} ile Görüşme` })).toBeVisible({
      timeout: 15_000,
    });
  } finally {
    await close();
  }
});

// =============================================================================
// [KHP] §9.8.7 test 41 — aggregate sayfalar `?t=` KABUL ETMEZ
// =============================================================================
test("madde 41: oturumsuz /patient/documents?t=<geçerli-booking-token> → login'e yönlenir (aggregate sayfa token kabul etmez)", async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100" });
  const page = await context.newPage();
  try {
    await page.goto(`/patient/documents?t=${bookingUpcoming.accessToken}`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login\?next=/, { timeout: 15_000 });
  } finally {
    await context.close();
  }
});

// =============================================================================
// [KHP] §9.8.7 test 40 — dil taraması (ENGELLEYİCİ) + e-posta rozeti
// =============================================================================
test("madde 40: /patient/profile — künyede 'doğrulandı/verified' GEÇMEZ, tone nötr; e-posta rozeti success tonuyla 'Doğrulandı' gösterir", async ({
  browser,
}) => {
  const { page, close } = await loginAsPatient(browser);
  try {
    await page.goto("/patient/profile");
    await expect(page.getByRole("heading", { name: "Profilim" })).toBeVisible({ timeout: 15_000 });

    const identitySection = page.locator("section", { has: page.getByRole("heading", { name: "Kimlik Bilgileri" }) });
    await expect(identitySection).toBeVisible({ timeout: 15_000 });
    await expect(identitySection.getByText("Kimlik bilgisi alındı —", { exact: false })).toBeVisible();

    const identityText = (await identitySection.textContent()) ?? "";
    for (const forbidden of ["doğrulandı", "Doğrulandı", "verified", "Verified", "onaylandı", "Onaylandı", "doğrulanmış", "Doğrulanmış"]) {
      expect(identityText, `Kimlik bölümünde YASAK ifade bulundu: "${forbidden}"`).not.toContain(forbidden);
    }
    // Nötr ton — `success`/yeşil/onay ikonu YOK (§14.6 A, ENGELLEYİCİ).
    await expect(identitySection.locator(".text-success, [class*='success']")).toHaveCount(0);
    await expect(identitySection.getByLabel(/onay|verified|check/i)).toHaveCount(0);

    // E-posta rozeti — AYRI kart, `success` tonuyla "E-posta Doğrulandı" (fixture `beforeAll`'da
    // `setUserEmailVerifiedDirectly(patientUserId, true)` ile GERÇEK bir doğrulama kaydı yazdı).
    const accountSection = page.locator("section", { has: page.getByRole("heading", { name: "Hesap Bilgileri" }) });
    await expect(accountSection.getByText("E-posta Doğrulandı")).toBeVisible();
    await expect(accountSection.getByText(PATIENT_EMAIL)).toBeVisible();
  } finally {
    await close();
  }
});

// =============================================================================
// Ek doğrulama — belge görüntüleme akışı (/patient/documents → booking kartı → BookingDocumentsDialog)
// =============================================================================
test("ek doğrulama: /patient/documents — booking kartı 'Görüntüle' → BookingDocumentsDialog yüklenen belgeyi listeler", async ({ browser }) => {
  const { page, close } = await loginAsPatient(browser);
  try {
    await page.goto("/patient/documents");
    await expect(page.getByRole("heading", { name: "Belgelerim" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Tıbbi Belgeler (1)")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Görüntüle" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText("qa-e2e-patient-portal-tahlil.pdf")).toBeVisible({ timeout: 10_000 });
  } finally {
    await close();
  }
});

// =============================================================================
// Ek doğrulama — epikriz görüntüleme akışı (/patient/prescriptions → booking kartı → PatientConsultationNoteDialog)
// =============================================================================
test("ek doğrulama: /patient/prescriptions — booking kartı 'Görüntüle' → doktorun yazdığı konsültasyon notu (epikriz) görüntülenir", async ({
  browser,
}) => {
  const { page, close } = await loginAsPatient(browser);
  try {
    await page.goto("/patient/prescriptions");
    await expect(page.getByRole("heading", { name: "Reçetelerim" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Epikriz Mevcut")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Görüntüle" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    // Dialog İÇİNDEKİ "Görüntüle" — kartın ARKA PLANDA hâlâ mount edilmiş kendi "Görüntüle"
    // butonuyla KARIŞMASIN diye `dialog` içine SCOPE edilir (aksi halde 2 eşleşme → strict-mode).
    await dialog.getByRole("button", { name: "Görüntüle" }).click();
    await expect(dialog.getByText("Parasetamol 500mg", { exact: false })).toBeVisible({ timeout: 10_000 });
  } finally {
    await close();
  }
});

// =============================================================================
// [KHP] §9.8.7 test 37 — doktor oturumu → sessizce /doctor'a gider
// =============================================================================
test("madde 37: doktor oturumuyla /patient → sessizce /doctor'a (doktor origin'ine) gider", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100" });
  const page = await context.newPage();
  try {
    await page.goto("/login");
    await page.getByLabel("E-posta").fill(DOCTOR_USER_EMAIL);
    await page.getByLabel("Şifre").fill(FIXTURE_PASSWORD);
    await page.getByRole("button", { name: "Giriş yap" }).click();
    // 2FA fixture'da AÇILMADI — doğrudan doktor hedefine düşer (`DoctorPortalRouteGuard` subdomain
    // modunda tam sayfa `window.location.assign` ile `doktor.siteadi.localhost`e geçer).
    await page.waitForURL(/\/doctor$/, { timeout: 15_000 });

    await page.goto("/patient");
    await page.waitForURL(/doktor\.siteadi\.localhost.*\/doctor/, { timeout: 15_000 });
  } finally {
    await context.close();
  }
});

// =============================================================================
// [KHP] §9.8.7 test 38 — ADMIN oturumu → yönlenmez, boş durum
// =============================================================================
test("madde 38: ADMIN oturumuyla /patient → yönlenmez, hero kartı boş durumu gösterir", async ({ browser }) => {
  const { page, close } = await createAuthenticatedPage(browser);
  try {
    await page.goto("/patient");
    await expect(page).toHaveURL(/\/patient$/);
    await expect(page.getByRole("heading", { name: /^Merhaba,/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Henüz bir randevunuz bulunmuyor.")).toBeVisible({ timeout: 15_000 });
    // `SiteHeader`in gezinme çubuğunda (Katman 1) AYRI bir "Randevu Al" bağlantısı zaten var —
    // hero kartın KENDİ CTA'sıyla KARIŞMASIN diye `main` içeriğine SCOPE edilir (2 eşleşme →
    // strict-mode, Playwright'ın kendi önerdiği ayrım).
    await expect(page.getByRole("main").getByRole("link", { name: "Randevu Al" })).toBeVisible();
  } finally {
    await close();
  }
});

// =============================================================================
// [KHP] §9.8.7 test 39 — fan-out yasağı. BİLİNÇLİ OLARAK DOSYA SONUNA ALINDI: `serial` modunda bir
// test kırmızı olunca yalnızca ONDAN SONRAKİ testler atlanır (bkz. dosya başı yorumu) — bu test
// BİLİNEN bir bug'dan dolayı kırmızı KALACAĞI için sona konur ki YUKARIDAKİ TÜM testler (34-38, 40,
// 41, ek doğrulamalar) gerçekten çalışıp raporlansın.
// =============================================================================
test("madde 39: /patient/documents ve /patient/prescriptions sayfa açılışında YALNIZCA GET /patient/bookings atılır (fan-out YOK)", async ({
  browser,
}) => {
  const { page, close } = await loginAsPatient(browser);
  try {
    for (const path of ["/patient/documents", "/patient/prescriptions"] as const) {
      const bookingsRequests: string[] = [];
      const contentRequests: string[] = [];
      const onRequest = (req: import("@playwright/test").Request) => {
        if (req.method() !== "GET") return;
        const url = req.url();
        if (/\/api\/v1\/patient\/bookings(\?|$)/.test(url)) bookingsRequests.push(url);
        if (/\/appointments\/bookings\/[^/]+\/(documents|consultation-note)/.test(url)) contentRequests.push(url);
      };
      page.on("request", onRequest);
      await page.goto(path, { waitUntil: "networkidle" });
      page.off("request", onRequest);

      // `expect.soft` — belge/epikriz fan-out kontrolü (§9.8.4'ün ASIL bağlayıcı yasağı, her
      // booking-scoped okuma denetim kaydı üretir) `bookingsRequests` sayısı yüzünden HİÇ
      // ÇALIŞTIRILMADAN atlanmasın diye ikisi de BAĞIMSIZ raporlanır.
      //
      // qa-agent BULGUSU (bu turda — BUG, frontend-agent'a yönlendirilir, qa-agent BURADA
      // DÜZELTMEZ): `GET /patient/bookings` bu iki YENİ panelde (`patient-documents-panel.tsx`,
      // `patient-prescriptions-panel.tsx`) sayfa açılışında 2 KEZ atılıyor — kardeş panel
      // `patient-bookings-panel.tsx` (`/patient/appointments`) `doctor-bookings-panel.tsx`teki
      // AYNI "StrictMode-fantom-çağrı koruması" (`lastLoadedScopeRef`) deseniyle BUNA KARŞI
      // KORUNUYORDU; bu iki yeni panelin `useEffect(() => { load() }, [load])`'u AYNI korumadan
      // YOKSUN — `doctor-subdomain-isolation.spec.ts`teki "senaryo 12" bulgusuyla AYNI kök neden
      // ailesi (StrictMode/effect çift-tetikleme). Kesin teşhis/düzeltme frontend-agent'ındır;
      // beklenen değer BİLİNÇLİ OLARAK `toHaveLength(1)` DOĞRU DEĞERİNDE BIRAKILDI (test doğru
      // şekilde KIRIK KALMALI — kırmızıyı yeşile boyayıp bug'ı gizlemek qa-agent'ın görevi DEĞİL).
      expect
        .soft(bookingsRequests, `${path}: GET /patient/bookings tam olarak 1 kez beklenirdi: ${JSON.stringify(bookingsRequests)}`)
        .toHaveLength(1);
      expect
        .soft(
          contentRequests,
          `${path}: sayfa açılışında booking-scoped belge/epikriz içeriği YASAK (fan-out): ${JSON.stringify(contentRequests)}`
        )
        .toHaveLength(0);
    }
  } finally {
    await close();
  }
});
