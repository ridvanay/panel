import crypto from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import {
  getCachedAdminSession,
  getSiteModules,
  patchSiteModule,
  getFixtureUserToken,
  listAllAdminMedia,
  postStripeTelehealthBookingPaid,
  API_BASE_URL,
} from "./support/api";
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
  listBookingDocumentsRaw,
  getDocumentContentStatusRaw,
  getAppointmentDocumentStoragePathDirectly,
  setUserTwoFactorEnabledDirectly,
  shiftAppointmentIntoJoinWindowDirectly,
  type CreatedFixtureDoctor,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — `.claude/architect-scope-telehealth-template.md` §9.7.11 "QA kapsamı — §10'a EK"
 * (bağlayıcı), madde 21-28. Backend'in KENDİ `tests/integration/telehealth-bookings.test.ts` +
 * `telehealth-webhook.test.ts` + `telehealth-checkout.test.ts` (backend/integration-agent) ZATEN
 * madde 14-20'yi (fiyat hesabı/slot limitleri/webhook idempotency/süre dolumu/2FA/belge yetki
 * matrisi) `app.inject` seviyesinde kapsıyor — BURADA YENİDEN YAZILMAZ (bkz. `TEST_COVERAGE.md`).
 * Bu dosya "gerçek tarayıcı + gerçek backend + gerçek Postgres (`saas_e2e`)" zincirini kapatır:
 * çoklu slot seçimi/toplam tutar (UI), belgeli/belgesiz intake akışı, ödeme sonrası durum +
 * toplantı linki (GERÇEK HTTP webhook + geçerli Stripe imzası, `stripe` SDK'sı hiç çağrılmadan —
 * `support/api.ts::postStripeTelehealthBookingPaid`), belge sızıntı testi (ENGELLEYİCİ),
 * doktor/rol yetki matrisi, 2FA kapısı, magic-link erişim denetimi.
 *
 * Kendi, İZOLE fixture doktorları kurar (`telehealth-doctor-profile-redesign.spec.ts::
 * calendarDoctor` İLE AYNI desen — `createAdminDoctorFixture` + `setDoctorAvailabilityRaw`,
 * haftanın HER günü geniş bir pencere) — paylaşımlı `telehealth-clinic` demo verisine (kısıtlı
 * saatler, başka dosyaların rezervasyonları) BAĞIMLI DEĞİLDİR, bu yüzden `telehealth-template-
 * import.spec.ts`'ten TAMAMEN BAĞIMSIZ çalışır.
 *
 * `POST /appointments/bookings`'in 5/dk route-level hız sınırı — bu dosyada toplam ~4 booking
 * oluşturma çağrısı var (test 21/22/23/24), gerçek tarayıcı adımları arasında geçen süre bu
 * limitin altında kalmayı doğal olarak garanti eder (`telehealth-bookings.test.ts` üstündeki AYNI
 * gerekçe — burada AYRI `app` örneği YOKTUR, tek bir backend süreci paylaşılır).
 */
test.describe.configure({ mode: "serial" });

const FIXTURE_PASSWORD = "QaE2eTelehealthBooking12345!";
const RUN_SUFFIX = Date.now().toString(36);
const DOCTOR_USER_EMAIL = `qa-e2e-telehealth-booking-doctor-${RUN_SUFFIX}@example.com`;
const OTHER_DOCTOR_USER_EMAIL = `qa-e2e-telehealth-booking-other-doctor-${RUN_SUFFIX}@example.com`;
const MANAGER_EMAIL = `qa-e2e-telehealth-booking-manager-${RUN_SUFFIX}@example.com`;
const EDITOR_EMAIL = `qa-e2e-telehealth-booking-editor-${RUN_SUFFIX}@example.com`;

let adminToken: string;
let initialTelehealthEnabled: boolean;
let bookingDoctor: CreatedFixtureDoctor;
let otherDoctor: CreatedFixtureDoctor;
let doctorUserId: string;
let doctorUserToken: string;
let otherDoctorUserToken: string;
let managerToken: string;
let editorToken: string;

/** `customer-portal-module-toggle.spec.ts`/`telehealth-public-booking.spec.ts` İLE AYNI 60 sn ISR toleransı. */
async function gotoAndWaitReady(page: Page, url: string, ready: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await ready();
  }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });
}

/** İlk `n` MÜSAİT checkbox'ı sırayla seçer (seçilen bir checkbox `aria-label`'ını "— seçili"ye
 * çevirdiği için `.first()` her seferinde bir SONRAKİ seçilmemiş slotu bulur). */
async function selectNAvailableSlots(page: Page, n: number): Promise<string[]> {
  const timeLabels: string[] = [];
  for (let i = 0; i < n; i++) {
    const checkbox = page.getByRole("checkbox", { name: /— müsait$/ }).first();
    await expect(checkbox).toBeVisible({ timeout: 15_000 });
    const ariaLabel = await checkbox.getAttribute("aria-label");
    timeLabels.push(ariaLabel!.replace(/ — müsait$/, ""));
    await checkbox.click();
  }
  return timeLabels;
}

async function fillAndSubmitBookingForm(page: Page, patientName: string, patientEmail: string): Promise<void> {
  await page.getByLabel("Ad soyad").fill(patientName);
  await page.getByLabel("E-posta").fill(patientEmail);
  // `telehealth-public-booking.spec.ts`'teki AYNI gerekçe — gerçek etkileşimli kök `id="consent"`
  // DEĞİL, `<label for="consent">`'a tıklamak her tarayıcıda checkbox'ı değiştirir.
  await page.locator('label[for="consent"]').click();
  await page.getByRole("button", { name: "Randevuyu Onayla" }).click();
}

/** 5 MB'ın altında, magic-byte'ı GERÇEKTEN PDF olan küçük bir test dosyası (`backend`'in kendi
 * `%PDF-1.4` + rastgele bayt deseniyle AYNI, bkz. `telehealth-bookings.test.ts`). */
function fakePdfBytes(): Buffer {
  return Buffer.concat([Buffer.from("%PDF-1.4\n"), crypto.randomBytes(64)]);
}

/** `bookingDoctor`'ın haftanın HER günü 08:00-22:00 penceresi VARDIR (bkz. `beforeAll`) — ama
 * "şu andan itibaren sabit N saat sonrası" bir randevu zamanı GÜN SINIRINI (ör. gece 22:00'den
 * sonrasına taşarsa) AŞABİLİR (§4.2 rezervasyon tamponu + günlük pencere kesişimi saat-bağımlıdır).
 * Sabit bir ofset yerine GERÇEK `GET /doctors/{slug}/slots`'tan müsait bir slot seçmek —
 * `telehealth-consultation.spec.ts::bookRealAppointment` İLE AYNI, bu depoda YERLEŞİK desen —
 * saat-bağımlı 422 hatalarına karşı SAĞLAMDIR. */
async function pickAvailableSlotIso(doctorSlug: string): Promise<string> {
  const { from, to } = defaultSlotRangeISODates(14);
  const slotsRes = await getPublicDoctorSlotsRaw(doctorSlug, from, to);
  const slot = (slotsRes.data ?? []).find((s) => s.available);
  if (!slot) throw new Error(`${doctorSlug} için müsait bir slot bulunamadı.`);
  return slot.startsAt;
}

async function cleanupFixtures() {
  await resetFixtureUserToBaseline(adminToken, MANAGER_EMAIL);
  await resetFixtureUserToBaseline(adminToken, EDITOR_EMAIL);
  await resetFixtureUserToBaseline(adminToken, DOCTOR_USER_EMAIL);
  await resetFixtureUserToBaseline(adminToken, OTHER_DOCTOR_USER_EMAIL);
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(180_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  await cleanupFixtures();

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);

  // Kendi İZOLE fixture doktoru — haftanın HER günü 08:00-22:00 (§dosya başlığı) — çoklu slot
  // seçimini (>=2 aynı gün) demo veriden BAĞIMSIZ, GÜVENİLİR biçimde garanti eder.
  bookingDoctor = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `QA E2E Booking Doktoru ${RUN_SUFFIX}`,
    bio: "qa-agent — çoklu slot booking/ödeme/sağlık verisi e2e fixture doktoru.",
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
    bookingDoctor.id,
    ([1, 2, 3, 4, 5, 6, 7] as const).map((dayOfWeek) => ({ dayOfWeek, startMinute: 8 * 60, endMinute: 22 * 60 }))
  );

  otherDoctor = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `QA E2E Diğer Doktor ${RUN_SUFFIX}`,
    bio: "qa-agent — madde 26 yetki matrisi (başka doktor) fixture'ı.",
    languages: ["tr"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: 40000,
    currency: "TRY",
    isVerified: true,
    isActive: true,
  });

  doctorUserToken = await getFixtureUserToken(DOCTOR_USER_EMAIL, FIXTURE_PASSWORD, "QA E2E Booking Doktor Hesabı");
  const doctorUser = await adminGetUserByEmail(adminToken, DOCTOR_USER_EMAIL);
  if (!doctorUser) throw new Error("Doktor fixture kullanıcısı oluşturulamadı.");
  doctorUserId = doctorUser.id;
  await linkDoctorUserRaw(adminToken, bookingDoctor.id, doctorUserId);

  otherDoctorUserToken = await getFixtureUserToken(OTHER_DOCTOR_USER_EMAIL, FIXTURE_PASSWORD, "QA E2E Diğer Doktor Hesabı");
  const otherDoctorUser = await adminGetUserByEmail(adminToken, OTHER_DOCTOR_USER_EMAIL);
  if (!otherDoctorUser) throw new Error("Diğer doktor fixture kullanıcısı oluşturulamadı.");
  await linkDoctorUserRaw(adminToken, otherDoctor.id, otherDoctorUser.id);

  managerToken = await getFixtureUserToken(MANAGER_EMAIL, FIXTURE_PASSWORD, "QA E2E Booking Manager");
  const managerUser = await adminGetUserByEmail(adminToken, MANAGER_EMAIL);
  if (!managerUser) throw new Error("Manager fixture kullanıcısı oluşturulamadı.");
  await adminUpdateRole(adminToken, managerUser.id, "MANAGER");

  editorToken = await getFixtureUserToken(EDITOR_EMAIL, FIXTURE_PASSWORD, "QA E2E Booking Editor");
  const editorUser = await adminGetUserByEmail(adminToken, EDITOR_EMAIL);
  if (!editorUser) throw new Error("Editor fixture kullanıcısı oluşturulamadı.");
  await adminUpdateRole(adminToken, editorUser.id, "EDITOR");
});

test.afterAll(async () => {
  await cleanupFixtures();
  if (bookingDoctor) await deleteAdminDoctorFixture(adminToken, bookingDoctor.id).catch(() => undefined);
  if (otherDoctor) await deleteAdminDoctorFixture(adminToken, otherDoctor.id).catch(() => undefined);
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

// ===========================================================================
// madde 21 — çoklu slot seçimi (13:30+14:00 tarzı 2 slot) → "2 Slot · 60 Dk" + toplam = 2×ücret
// ===========================================================================
test("madde 21: iki slot seçilince Hizmet Özeti '2 Slot · 60 Dk' ve toplam = 2×seans ücreti gösterir; booking sunucu-hesaplı totalCents ile oluşur", async ({
  page,
}) => {
  test.setTimeout(90_000);

  await gotoAndWaitReady(page, `/doctors/${bookingDoctor.slug}`, async () => {
    await expect(page.getByRole("heading", { name: "Müsaitlik ve Randevu" })).toBeVisible();
  });
  await page.waitForTimeout(500); // hidrasyon sonrası ziyaretçi dilimi yeniden hesaplanır (§4.2).

  const timeLabels = await selectNAvailableSlots(page, 2);
  expect(timeLabels).toHaveLength(2);

  // Hizmet Özeti paneli — `doctor-service-summary.tsx::"{slotCount} Slot · {slotCount*duration} Dk"`.
  await expect(page.getByText("2 Slot · 60 Dk", { exact: true })).toBeVisible();
  const expectedUnit = new Intl.NumberFormat("tr-TR", { style: "currency", currency: bookingDoctor.currency }).format(
    bookingDoctor.sessionPriceCents / 100
  );
  const expectedTotal = new Intl.NumberFormat("tr-TR", { style: "currency", currency: bookingDoctor.currency }).format(
    (bookingDoctor.sessionPriceCents * 2) / 100
  );
  await expect(page.getByText(`${expectedUnit} × 2 seans`, { exact: true })).toBeVisible();
  await expect(page.getByText("Toplam")).toBeVisible();
  // `doctor-service-summary.tsx` toplamı İKİ YERDE render eder (masaüstü Hizmet Özeti paneli +
  // mobil sabit alt bar, `telehealth-doctor-profile-redesign.spec.ts`'teki AYNI strict-mode notu)
  // — `.first()` bu çakışmayı önler.
  await expect(page.getByText(expectedTotal, { exact: true }).first()).toBeVisible();

  let capturedBody: { doctorSlug?: string; slots?: string[] } | undefined;
  await page.route("**/appointments/bookings", async (route) => {
    if (route.request().method() === "POST") {
      capturedBody = route.request().postDataJSON() as { doctorSlug?: string; slots?: string[] };
    }
    await route.continue();
  });

  const patientEmail = `qa-e2e-telehealth-multislot-${Date.now()}@example.com`;
  await fillAndSubmitBookingForm(page, "QA E2E Çoklu Slot Hastası", patientEmail);

  await expect(page.getByText(/Rezervasyonunuz oluşturuldu/)).toBeVisible({ timeout: 20_000 });
  // `BookingPostCreationFlow`'un başarı `Alert`'i — "2 Slot · Toplam ₺800,00. Bu rezervasyon
  // slotu 30 dakika tutar; ..." tek bir paragrafın İÇİNDE (tam metin eşleşmesi YAPILAMAZ, `exact:
  // false` alt dize araması kullanılır).
  await expect(page.getByText(`2 Slot · Toplam ${expectedTotal}`, { exact: false })).toBeVisible();

  // İstemcinin gönderdiği payload'da `totalCents` HİÇ YOKTUR (madde 14 — backend'in kendi
  // entegrasyon testi bunun YOK SAYILDIĞINI zaten kanıtlıyor; burada istemcinin böyle bir alan
  // GÖNDERMEDİĞİNİ de doğruluyoruz — "yok sayma" ihtiyacı bile duyulmuyor).
  expect(capturedBody?.doctorSlug).toBe(bookingDoctor.slug);
  expect(capturedBody?.slots).toHaveLength(2);
  expect((capturedBody as unknown as { totalCents?: unknown })?.totalCents).toBeUndefined();
});

// ===========================================================================
// madde 22 — belgeli senaryo (intake adımında rıza + PDF yükle)
// ===========================================================================
let documentedBookingId: string;
let documentedDocumentId: string;
let documentedFilename: string;

test("madde 22: belgeli senaryo — intake adımında rıza + PDF yükle → randevu oluşur, doktor panelinde belge görünür", async ({ page }) => {
  test.setTimeout(90_000);

  await gotoAndWaitReady(page, `/doctors/${bookingDoctor.slug}`, async () => {
    await expect(page.getByRole("heading", { name: "Müsaitlik ve Randevu" })).toBeVisible();
  });
  await page.waitForTimeout(500);
  await selectNAvailableSlots(page, 1);

  const patientEmail = `qa-e2e-telehealth-with-doc-${Date.now()}@example.com`;
  const bookingResponsePromise = page.waitForResponse(
    (res) => res.url().includes("/appointments/bookings") && res.request().method() === "POST"
  );
  await fillAndSubmitBookingForm(page, "QA E2E Belgeli Hasta", patientEmail);
  const bookingResponse = await bookingResponsePromise;
  const bookingResponseBody = (await bookingResponse.json()) as { data: { bookingId: string } };
  documentedBookingId = bookingResponseBody.data.bookingId;
  await expect(page.getByText(/Rezervasyonunuz oluşturuldu/)).toBeVisible({ timeout: 20_000 });

  // Intake adımı — rıza kutusu + not (`PUT .../intake`), ARDINDAN GERÇEK bir PDF yükleme
  // (mock/sahte upload YOK). `booking-intake-step.tsx` — `DocumentUploader` YALNIZCA
  // `PUT .../intake` BAŞARILI OLDUKTAN (`saved === true`) SONRA render edilir; bu yüzden önce
  // "Kaydet ve Devam Et" ile notu/rızayı kaydetmek GEREKİR (belge yükleme rızadan BAĞIMSIZ bir adım
  // DEĞİLDİR — §9.7.5 madde 2: rıza satırının VARLIĞI zaten belge yüklemenin ÖN ŞARTI).
  await expect(page.getByText("Sağlık Verisi Paylaşım İzni")).toBeVisible();
  await page.locator('label[for="health-data-consent"]').click();
  await page.getByLabel("Şikâyet / ön not").fill("QA e2e — baş ağrısı şikayeti (test verisi).");
  await page.getByRole("button", { name: "Kaydet ve Devam Et" }).click();
  await expect(page.getByText("Bilgileriniz kaydedildi.", { exact: false })).toBeVisible({ timeout: 15_000 });

  documentedFilename = `qa-e2e-leak-test-${crypto.randomUUID()}.pdf`;
  const fileChooserPromise = page.waitForEvent("filechooser").catch(() => null);
  await page.getByText("Dosyaları buraya sürükleyin").click();
  const fileChooser = await fileChooserPromise;
  const bytes = fakePdfBytes();
  if (fileChooser) {
    await fileChooser.setFiles({ name: documentedFilename, mimeType: "application/pdf", buffer: bytes });
  } else {
    await page.locator('input[type="file"]').setInputFiles({ name: documentedFilename, mimeType: "application/pdf", buffer: bytes });
  }

  await expect(page.getByText(documentedFilename)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Devam Et" }).click();

  // Belge yüklendikten sonra "Devam Et" — ödeme adımına geçilir.
  await expect(page.getByText("Ödenecek Tutar")).toBeVisible({ timeout: 15_000 });

  // Doktorun 2FA'sı henüz AÇIK DEĞİL bu noktada (madde 27 testinden ÖNCE çalışıyoruz) — `/doctor/*`
  // portal uçları bu yüzden 403 verir; bu ayrıca "2FA kapısının GERÇEKTEN uygulandığının" erken bir
  // kanıtıdır (madde 27'nin asıl testinden BAĞIMSIZ, bilgi amaçlı bir yan doğrulama).
  const doctorBookingsBeforeTwoFactor = await fetch(`${API_BASE_URL}/doctor/bookings?limit=50`, {
    headers: { Authorization: `Bearer ${doctorUserToken}` },
  });
  expect(doctorBookingsBeforeTwoFactor.status).toBe(403);

  const documents = await listBookingDocumentsRaw(documentedBookingId, { bearerToken: adminToken });
  expect(documents.status).toBe(200);
  expect(documents.data).toHaveLength(1);
  expect(documents.data![0]!.filename).toBe(documentedFilename);
  documentedDocumentId = documents.data![0]!.id;

  // "Doktor panelinde belge görünür" — doktorun 2FA'sını ANINDA açıp (bu testin kendi ölçeğinde,
  // madde 27'nin ayrı testini ETKİLEMEZ — o test sonunda tekrar KAPATIR) doktorun KENDİ bearer'ıyla
  // GERÇEK API'den (mock DEĞİL) belge listesinin göründüğünü doğruluyoruz.
  setUserTwoFactorEnabledDirectly(doctorUserId, true);
  try {
    const doctorDocs = await listBookingDocumentsRaw(documentedBookingId, { bearerToken: doctorUserToken });
    expect(doctorDocs.status).toBe(200);
    expect(doctorDocs.data).toHaveLength(1);
    expect(doctorDocs.data![0]!.filename).toBe(documentedFilename);

    const contentStatus = await getDocumentContentStatusRaw(documentedDocumentId, { bearerToken: doctorUserToken });
    expect(contentStatus).toBe(200); // "önizlenebilir" — GERÇEK belge akışı 200 döner.
  } finally {
    setUserTwoFactorEnabledDirectly(doctorUserId, false);
  }
});

// ===========================================================================
// madde 23 — belgesiz senaryo (intake adımı ATLANIR) — rezervasyon/ödeme AYNI ŞEKİLDE tamamlanır
// ===========================================================================
let undocumentedBookingId: string;
let undocumentedAccessToken: string;

test("madde 23: belgesiz senaryo — intake adımı atlanır, rezervasyon ve ödeme adımı AYNI ŞEKİLDE tamamlanır", async ({ page }) => {
  test.setTimeout(90_000);

  await gotoAndWaitReady(page, `/doctors/${bookingDoctor.slug}`, async () => {
    await expect(page.getByRole("heading", { name: "Müsaitlik ve Randevu" })).toBeVisible();
  });
  await page.waitForTimeout(500);
  await selectNAvailableSlots(page, 1);

  const patientEmail = `qa-e2e-telehealth-no-doc-${Date.now()}@example.com`;
  const bookingResponsePromise = page.waitForResponse(
    (res) => res.url().includes("/appointments/bookings") && res.request().method() === "POST"
  );
  await fillAndSubmitBookingForm(page, "QA E2E Belgesiz Hasta", patientEmail);
  const bookingResponse = await bookingResponsePromise;
  const bookingResponseBody = (await bookingResponse.json()) as { data: { bookingId: string; accessToken: string } };
  undocumentedBookingId = bookingResponseBody.data.bookingId;
  // Madde 28'in "doğru token'la erişim ÇALIŞIYOR" ucu bu booking'i YENİDEN KULLANIR (bkz. o test) —
  // `POST /appointments/bookings`'in paylaşılan 5/dk hız sınırına (§9.7.11 madde-tablosu) karşı
  // fazladan bir booking oluşturma çağrısı YAPILMAZ (bu dosyadaki suite başına toplam çağrı
  // sayısını bilinçli olarak düşük tutar, bkz. dosya başlığındaki rate-limit notu).
  undocumentedAccessToken = bookingResponseBody.data.accessToken;
  await expect(page.getByText(/Rezervasyonunuz oluşturuldu/)).toBeVisible({ timeout: 20_000 });

  await expect(page.getByText("Bu adım opsiyoneldir", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Bu adımı atla" }).click();

  // Adım ATLANMASINA RAĞMEN ödeme adımına GEÇİLDİ — rezervasyonun kendisi ETKİLENMEDİ.
  await expect(page.getByText("Ödenecek Tutar")).toBeVisible({ timeout: 15_000 });

  const booking = await getBookingRaw(undocumentedBookingId, { bearerToken: adminToken });
  expect(booking.status).toBe(200);
  expect(booking.data!.hasIntakeNote).toBe(false);
  expect(booking.data!.documentCount).toBe(0);
  expect(booking.data!.paymentStatus).toBe("PENDING");
});

// ===========================================================================
// madde 24 — ödeme sonrası (mock webhook): "Ödendi" rozeti, randevu SCHEDULED, "Toplantıya Katıl"
// aktif, magic-link ile giriş çalışıyor.
// ===========================================================================
test("madde 24: mock Stripe webhook sonrası booking 'Ödendi' rozeti, randevu SCHEDULED, 'Toplantıya Katıl' aktif, magic-link erişimi çalışıyor", async ({
  page,
}) => {
  test.setTimeout(90_000);

  const created = await createBookingRaw({
    doctorSlug: bookingDoctor.slug,
    slots: [await pickAvailableSlotIso(bookingDoctor.slug)],
    patientName: "QA E2E Ödeme Hastası",
    patientEmail: `qa-e2e-telehealth-paid-${Date.now()}@example.com`,
  });
  expect(created.status).toBe(201);
  const booking = created.data!;

  const before = await getBookingRaw(booking.bookingId, { magicLinkToken: booking.accessToken });
  expect(before.data!.paymentStatus).toBe("PENDING");

  // GERÇEK HTTP webhook isteği, GEÇERLİ Stripe imzasıyla (`postStripeTelehealthBookingPaid` —
  // `stripe.checkout.sessions.create` HİÇ ÇAĞRILMAZ, yalnızca `POST /webhooks/stripe`'ın kendi
  // imza doğrulama + `handleTelehealthBookingPaid` kod yolu GERÇEKTEN tetiklenir).
  const webhookRes = await postStripeTelehealthBookingPaid(booking.bookingId, { rawAccessToken: booking.accessToken });
  expect(webhookRes.status).toBe(200);

  const after = await getBookingRaw(booking.bookingId, { magicLinkToken: booking.accessToken });
  expect(after.status).toBe(200);
  expect(after.data!.paymentStatus).toBe("PAID");
  expect(after.data!.appointments[0]!.status).toBe("SCHEDULED");

  // Katılım penceresine GİRSİN diye randevunun ZAMANLAMASI (yalnızca startsAt/endsAt) kaydırılır —
  // randevunun kendisi GERÇEK rezervasyon+ödeme akışından geçti (`telehealth-consultation.spec.ts`
  // İLE AYNI, önceden belgelenmiş desen).
  shiftAppointmentIntoJoinWindowDirectly(booking.appointments[0]!.id, 90, 30);

  // AYNI ORİJİNAL magic-link token'ı ödeme SONRASI da ÇALIŞIYOR (rawAccessToken webhook'a taşındığı
  // için accessTokenHash ROTATE EDİLMEDİ — `lib/booking.ts::confirmBookingPayment` yorumu).
  await gotoAndWaitReady(page, `/patient/bookings/${booking.bookingId}?t=${booking.accessToken}`, async () => {
    await expect(page.getByText(booking.bookingNumber)).toBeVisible();
  });

  await expect(page.getByText("Ödendi", { exact: true })).toBeVisible();
  const joinLink = page.getByRole("link", { name: "Toplantıya Katıl" });
  await expect(joinLink).toBeVisible({ timeout: 15_000 });
  // Aktif hâl gerçek bir `<a href>`dır (disabled `<button>` DEĞİL, bkz. `join-meeting-button.tsx`).
  await expect(joinLink).toHaveAttribute("href", new RegExp(`/consultation/${booking.appointments[0]!.id}`));
});

// ===========================================================================
// madde 25 — SIZINTI TESTİ (ENGELLEYİCİ) — yüklenen belge /uploads/** altından ERİŞİLEMİYOR,
// GET /admin/media listesinde GÖRÜNMÜYOR.
// ===========================================================================
test("madde 25 [ENGELLEYİCİ]: yüklenen tıbbi belge /uploads/** altından erişilemez ve GET /admin/media listesinde görünmez", async () => {
  test.setTimeout(60_000);
  expect(documentedDocumentId, "madde 22 testinin önce çalışıp bir belge oluşturmuş olması gerekir").toBeTruthy();

  const storagePath = getAppointmentDocumentStoragePathDirectly(documentedDocumentId);
  expect(storagePath).toMatch(/^[0-9a-f-]{36}\.(pdf|png|jpe?g)$/i);

  const backendOrigin = API_BASE_URL.replace(/\/api\/v1\/?$/, "");
  const leaked = await fetch(`${backendOrigin}/uploads/${storagePath}`);
  // §9.7.11 madde 25 (ENGELLEYİCİ) — kesin `404` beklenir (backend'in kendi
  // `telehealth-bookings.test.ts`'i İLE BİREBİR AYNI iddia, burada GERÇEK HTTP sunucusuna karşı).
  expect(leaked.status).toBe(404);

  const mediaList = await listAllAdminMedia(adminToken);
  expect(mediaList.some((m) => m.filename === documentedFilename)).toBe(false);
  // Sağlık belgesi hiçbir zaman bir `Media` satırı DEĞİLDİR — dolaylı da olsa hiçbir PDF/tıbbi
  // belge dosya adı medya kütüphanesinde YOKTUR.
  expect(mediaList.some((m) => m.mimeType === "application/pdf")).toBe(false);
});

// ===========================================================================
// madde 26 — yetki matrisi: başka doktor → 404, MANAGER → içerik 404/sayı 200, EDITOR → 404.
// (Not: openapi.yaml `/appointments/documents/{documentId}/content` — "MANAGER/EDITOR/diğer
// doktorlar → 404 (varlık sızdırılmaz)" BAĞLAYICI kontrattır; görev talimatındaki "403" ifadesi
// bu kontratla ÇELİŞİYOR — burada GERÇEK/bağlayıcı kontrata göre test edilir, bkz. final rapor.)
// ===========================================================================
test("madde 26: yetki matrisi — başka doktor → 404, MANAGER → içerik 404/booking(sayı) 200, EDITOR → 404", async () => {
  test.setTimeout(60_000);
  expect(documentedBookingId, "madde 22 testinin önce çalışmış olması gerekir").toBeTruthy();
  expect(documentedDocumentId).toBeTruthy();

  // Başka bir doktorun (bu booking'le İLGİSİZ) bağlı kullanıcısı → 404 (IDOR, varlık sızdırılmaz).
  const otherDoctorContent = await getDocumentContentStatusRaw(documentedDocumentId, { bearerToken: otherDoctorUserToken });
  expect(otherDoctorContent).toBe(404);
  const otherDoctorBookingView = await getBookingRaw(documentedBookingId, { bearerToken: otherDoctorUserToken });
  expect(otherDoctorBookingView.status).toBe(404);

  // MANAGER — İÇERİĞE 404 (sağlık verisi, §9.7.5 madde 7 ENGELLEYİCİ), ama booking'in KENDİSİNE
  // (dolayısıyla `documentCount` SAYISINA) 200 erişir (§9.7.10 view eşiği — ADMIN+MANAGER).
  const managerContent = await getDocumentContentStatusRaw(documentedDocumentId, { bearerToken: managerToken });
  expect(managerContent).toBe(404);
  const managerDocList = await listBookingDocumentsRaw(documentedBookingId, { bearerToken: managerToken });
  expect(managerDocList.status).toBe(404); // METADATA listesi de sağlık verisi eşiğine tabidir.
  const managerBookingView = await getBookingRaw(documentedBookingId, { bearerToken: managerToken });
  expect(managerBookingView.status).toBe(200);
  expect(managerBookingView.data!.documentCount).toBe(1); // "sayıya erişebiliyor" — booking DTO'sunun `documentCount` alanı.

  // EDITOR — hem içeriğe hem booking'in kendisine (view eşiği ADMIN+MANAGER, EDITOR HARİÇ) 404.
  const editorContent = await getDocumentContentStatusRaw(documentedDocumentId, { bearerToken: editorToken });
  expect(editorContent).toBe(404);
  const editorBookingView = await getBookingRaw(documentedBookingId, { bearerToken: editorToken });
  expect(editorBookingView.status).toBe(404);

  // Kontrast — booking'in GERÇEK doktoru (2FA kapısı bu uçları ETKİLEMEZ, yalnızca `/doctor/*`
  // portal uçlarını etkiler) içeriğe erişebiliyor (yetki matrisinin "izin verilen" ucu da çalışıyor).
  const ownDoctorContent = await getDocumentContentStatusRaw(documentedDocumentId, { bearerToken: doctorUserToken });
  expect(ownDoctorContent).toBe(200);
});

// ===========================================================================
// madde 27 — 2FA kapısı: 2FA'sı kapalı bir doktor /doctor/* sayfasında dürüst bir uyarı görür,
// erişemez; 2FA açılınca erişebilir.
// ===========================================================================
test("madde 27 (API seviyesi): 2FA'sı kapalı bir doktor GET /doctor/me → 403 TWO_FACTOR_REQUIRED; 2FA açılınca 200", async () => {
  test.setTimeout(30_000);

  // Bu noktada doktorun 2FA'sı KAPALI olmalı (madde 22 testi kendi `finally` bloğunda geri kapattı).
  const before = await fetch(`${API_BASE_URL}/doctor/me`, { headers: { Authorization: `Bearer ${doctorUserToken}` } });
  expect(before.status).toBe(403);
  const beforeBody = (await before.json()) as { error: { code: string } };
  expect(beforeBody.error.code).toBe("TWO_FACTOR_REQUIRED");

  setUserTwoFactorEnabledDirectly(doctorUserId, true);
  try {
    const after = await fetch(`${API_BASE_URL}/doctor/me`, { headers: { Authorization: `Bearer ${doctorUserToken}` } });
    expect(after.status).toBe(200);
    const afterBody = (await after.json()) as { data: { doctorProfile: { fullName: string } } };
    expect(afterBody.data.doctorProfile.fullName).toBe(bookingDoctor.fullName);
  } finally {
    setUserTwoFactorEnabledDirectly(doctorUserId, false);
  }
});

test("madde 27 (UI seviyesi): /doctor ve /doctor/profile sayfaları çalışır (500 REGRESYONU DÜZELTİLDİ), 2FA'sı kapalı doktor dürüst bir uyarı görür", async ({
  page,
}) => {
  // KÖK NEDEN (frontend-agent tarafından DÜZELTİLDİ): `frontend/src/app/[lang]/(site)/doctor/
  // page.tsx` (Server Component) `<DoctorPortalShell>{(profile) => <DoctorBookingsPanel
  // profile={profile} />}</DoctorPortalShell>` şeklinde bir FONKSİYONU (render-prop) `children`
  // olarak `"use client"` işaretli `DoctorPortalShell`'e geçiriyordu — RSC sınırında fonksiyonlar
  // serileştirilemediği için (`frontend/AGENTS.md`) bu HER İSTEKTE `500` veriyordu (`/doctor/
  // profile`'da da AYNI desen tekrarlanıyordu). DÜZELTME: `DoctorPortalShell` artık çektiği
  // `profile`'ı bir React Context ile expose ediyor (`useDoctorPortalProfile()`), sayfalar
  // `PatientPortalShell`/`HesabimShell` İLE AYNI plain-`ReactNode`-children desenine döndü;
  // `DoctorBookingsPanel`/`DoctorProfilePanel` artık `profile` prop'u yerine hook'tan okuyor.
  test.setTimeout(30_000);

  await page.goto("/doctor");
  await page.waitForURL(/\/login\?next=/, { timeout: 10_000 });
  await page.getByLabel("E-posta").fill(DOCTOR_USER_EMAIL);
  await page.getByLabel("Şifre").fill(FIXTURE_PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL(/\/doctor$/, { timeout: 15_000 });

  await expect(page.getByText("iki adımlı doğrulamanın (2FA) etkin olması gerekir", { exact: false })).toBeVisible({ timeout: 15_000 });
});

// ===========================================================================
// madde 28 — `?t=` olmadan / yanlış token ile /patient/bookings/{id}'a erişim yok.
// ===========================================================================
test("madde 28: /patient/bookings/{id} — ?t= olmadan ve yanlış token ile erişim REDDEDİLİR; doğru token ile ÇALIŞIR", async ({ page }) => {
  test.setTimeout(90_000);
  expect(undocumentedBookingId, "madde 23 testinin önce çalışmış olması gerekir").toBeTruthy();

  // `/patient/bookings/{id}` public `/doctors*` GİBİ `revalidate: 60` ile ÖNBELLEKLENMEZ (her
  // istek DİNAMİK) — bu yüzden ISR toleransı (`gotoAndWaitReady`) GEREKMEZ, düz `page.goto` yeterli.
  // `PatientBookingDetailPanel::loadError` DOLUYSA (backend'in HAM hata mesajı, ör. "Rezervasyon
  // bulunamadı.") jenerik "Bu rezervasyon bulunamadı ya da erişim bağlantınız geçersiz." metnine
  // DEĞİL, o ham mesaja düşer (`{loadError ?? "..."}`) — bu yüzden ikisini de KAPSAYAN bir regex
  // kullanılır (`gerçek varlık sızdırılmaz` iddiası ikisi için de AYNI ölçüde geçerlidir).
  const notFoundText = /[Rr]ezervasyon bulunamadı/;

  await page.goto(`/patient/bookings/${undocumentedBookingId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(notFoundText)).toBeVisible({ timeout: 15_000 });
  // IDOR — booking'in VARLIĞI dahi sızdırılmaz, hasta adı/rezervasyon numarası GÖRÜNMEZ.
  await expect(page.locator("body")).not.toContainText("QA E2E Belgesiz Hasta");

  await page.goto(`/patient/bookings/${undocumentedBookingId}?t=kesinlikle-yanlis-bir-magic-link-tokeni`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(notFoundText)).toBeVisible({ timeout: 15_000 });

  // API seviyesinde de AYNI doğrulama — 404, 403 DEĞİL (IDOR deseni, varlık sızdırılmaz).
  const noToken = await getBookingRaw(undocumentedBookingId);
  expect(noToken.status).toBe(404);
  const wrongToken = await getBookingRaw(undocumentedBookingId, { magicLinkToken: "kesinlikle-yanlis" });
  expect(wrongToken.status).toBe(404);

  // DOĞRU token'la erişim ÇALIŞIYOR — AYNI booking'in GERÇEK token'ı (madde 23'ün kendi fixture'ı,
  // network yanıtından yakalandı) — yeni bir booking OLUŞTURULMAZ (rate-limit notu, dosya başlığı).
  expect(undocumentedAccessToken, "madde 23 testinin accessToken'ı yakalamış olması gerekir").toBeTruthy();
  const withToken = await getBookingRaw(undocumentedBookingId, { magicLinkToken: undocumentedAccessToken });
  expect(withToken.status).toBe(200);

  await page.goto(`/patient/bookings/${undocumentedBookingId}?t=${undocumentedAccessToken}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(withToken.data!.bookingNumber)).toBeVisible({ timeout: 15_000 });
});
