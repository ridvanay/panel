import { test, expect, type Browser, type Page } from "@playwright/test";
import { API_BASE_URL, getCachedAdminSession, getFixtureUserToken, getSiteModules, patchSiteModule } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";
import { adminGetUserByEmail, resetFixtureUserToBaseline } from "./support/admin-users-fixtures";
import {
  ensureTelehealthModuleWithDoctors,
  createAdminDoctorFixture,
  deleteAdminDoctorFixture,
  setDoctorAvailabilityRaw,
  linkDoctorUserRaw,
  createBookingRaw,
  markBookingPaidDirectly,
  getPublicDoctorSlotsRaw,
  defaultSlotRangeISODates,
  shiftAppointmentIntoJoinWindowDirectly,
  setAppointmentStatusDirectly,
  type CreatedFixtureDoctor,
  type CreatedAppointment,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — orkestratörün doğrudan görev talimatı: LiveKit Egress + S3/MinIO görüşme kaydı
 * özelliğinin (feature/telehealth-recording) uçtan uca doğrulaması. architect/security-agent/
 * compliance-agent bu turda ENGELLEYİCİ denetimlerini ZATEN yaptı (PASS) — backend'in kendi
 * `tests/integration/telehealth-recording.test.ts`'i (24 test, `vi.mock("livekit-server-sdk")`
 * ile) rıza akışının (PENDING_CONSENT → RECORDING/CONSENT_DENIED → PROCESSING/FAILED) durum
 * makinesini ZATEN kapsıyor — BURADA TEKRARLANMAZ.
 *
 * Bu ortamda `backend/.env.e2e` LiveKit için SAHTE ama "dolu" değerler taşır (`LIVEKIT_URL=wss://
 * e2e-fake.livekit.cloud` — yalnızca yerel JWT imzalamak için, gerçek bir sunucuya asla ulaşılmaz)
 * ama `STORAGE_DRIVER=local` (S3 DEĞİL) — yani `isLiveKitConfigured()` TRUE, `isRecordingConfigured()`
 * (`lib/livekit-egress.ts`) FALSE döner: `/appointments/{id}/recording/start` HER ZAMAN dürüst bir
 * `503 RECORDING_NOT_CONFIGURED` verir. Bu dosya GERÇEK bir Egress/S3 akışını (video dosyasının
 * GERÇEKTEN kaydedilmesi) test ETMEZ — kapsam, görev talimatının kendisinin sınırladığı gibi:
 * (a) modül kapalıyken TÜM uçların 404 vermesi, (b) modül açık ama yapılandırılmamışken dürüst 503,
 * (c) frontend UI'ın (rıza dialogu/rozet/kontroller) doğru koşullarda görünüp gizlenmesi, (d)
 * `/admin/modules`'teki zorunlu uyarı dialogu.
 *
 * "Doktor görüşme odasına girer" senaryosu (a/b) GERÇEKTEN `<LiveKitRoom connect>`'i mount eder —
 * `LIVEKIT_URL` sahte/ulaşılamaz olduğundan bağlantı ASLA `Connected`'a ulaşmaz, ama bu bilinçli
 * ve yeterlidir: `RecordingControls`/`RecordingIndicator` bağlantı DURUMUNA değil yalnızca
 * `isDoctor`/`recording` state'ine bakarak render olur (bkz. `consultation-room.tsx`), bu yüzden
 * "buton doğru koşulda görünüyor mu" sorusu gerçek bir video bağlantısı GEREKTİRMEDEN yanıtlanabilir.
 * `page.on("pageerror", ...)` ile TÜM testlerde sayfanın çökmediği (beyaz ekran/uncaught exception
 * YOK) ayrıca doğrulanır.
 *
 * qa-agent BULGUSU (bu dosyada belgelenir, DÜZELTİLMEZ — bkz. proje kökü CLAUDE.md "qa-agent:
 * Bug'ı kendi düzeltme" + görev talimatı "gerçek bir ÜRÜN BUG'I bulursan DÜZELTME, rapor et"):
 * `consultation-room.tsx::ConsultationVideoRoom` içinde `RecordingControls` YALNIZCA `isDoctor`
 * koşuluna bağlıdır — `telehealth-recording` modülünün açık/kapalı olduğuna dair HİÇBİR frontend
 * kontrolü YOKTUR (`useModules()` bu dosyada hiç import edilmiyor). Yani modül KAPALIYKEN (bu
 * ortamın/her yeni kurulumun VARSAYILANI, `module-registry.ts` `defaultEnabled: false`) doktor
 * GENE DE "Kaydı Başlat" butonunu görür; tıklayınca backend'in modül guard'ı `404 NOT_FOUND`
 * ("Kaynak bulunamadı.") döner ve bu, buton altında GENEL/yanıltıcı bir hata metni olarak
 * görüntülenir (çökme YOK, ama görev talimatının beklediği "buton HİÇ GÖRÜNMEZ" davranışı
 * KARŞILANMIYOR). frontend-agent'a yönlendirilmelidir: `RecordingControls` (ve muhtemelen
 * `RecordingIndicator`'ın da tutarlılık için) `useModules()` ile `telehealth-recording` durumunu
 * okuyup kapalıyken hiç render ETMEMELİDİR — `admin/modules/page.tsx`'in F7 uyarı dialogu deseninin
 * mantıksal tamamlayıcısı. Bu dosya, mevcut (buggy) davranışı test eder ve ÇÖKMEDİĞİNİ doğrular
 * (proje konvansiyonu — bkz. `admin-appearance-header-colors.spec.ts` başlığı: "atlatılıyor,
 * DÜZELTİLMİYOR").
 *
 * qa-agent BULGUSU #2 (backend, bilgi amaçlı — kritik DEĞİL): `backend/src/lib/recording-
 * retention.ts::registerRecordingRetentionScheduler` uygulama AÇILIŞINDA (ve her 24 saatte bir)
 * `isRecordingStorageConfigured()`'i HİÇ KONTROL ETMEDEN `telehealthRecordingStorage.listStaging()`
 * çağırır — `STORAGE_DRIVER=local` (S3 yapılandırılmamış) iken bu her seferinde
 * `CredentialsProviderError: Could not load credentials from any providers` ile BAŞARISIZ olup
 * `ERROR` seviyesinde loglanır (bu turda backend'i `.env.e2e` ile başlatırken GÖZLEMLENDİ,
 * `server.log`'da mevcuttur). Sunucuyu ÇÖKÜRTMÜYOR (yakalanıp loglanıyor) ama görev talimatının
 * her yerde uyguladığı "dürüst yapılandırılmamışlık" felsefesine aykırı — süpürücü
 * `isRecordingStorageConfigured()` FALSE'sa sessizce no-op olmalı (route katmanının
 * `RecordingNotConfiguredError` deseniyle TUTARLI). backend-agent'a yönlendirilmelidir
 * (observability-agent için gürültülü/yanıltıcı ERROR logu üretir).
 */
test.describe.configure({ mode: "serial" });

const RUN_SUFFIX = Date.now().toString(36);
const DOCTOR_EMAIL = `qa-e2e-th-recording-doctor-${RUN_SUFFIX}@example.com`;
const DOCTOR_PASSWORD = "QaE2eTelehealthRecording12345!";
const RECORDING_MODULE_LABEL = "Görüşme Kaydı";
const RECORDING_MODULE_KEY = "telehealth-recording";

let adminToken: string;
let initialTelehealthEnabled: boolean;
let initialRecordingModuleEnabled: boolean;
let doctorFixture: CreatedFixtureDoctor;

let adminPage: Page;
let closeAdminSession: () => Promise<void>;
let doctorPage: Page;
let closeDoctorSession: () => Promise<void>;

/** `telehealth-portal-isolation.spec.ts::loginDoctorDirectlyWithTwoFactor` İLE AYNI desen, 2FA
 *  ADIMI OLMADAN — bu dosyanın doktor fixture'ı hiç 2FA etkinleştirmez (bu testin odağı DEĞİL).
 *  `support/admin-session.ts::createAuthenticatedPageAs` KULLANILMAZ: o `/dashboard`'a yönlendirme
 *  bekler, ama `resolvePostLoginPath` (telehealth AÇIK + `doctorProfileId` dolu) düz `/login`'den
 *  giren bir doktoru `/doctor`'a yönlendirir (bkz. `lib/post-login-destination.ts`) — yanlış
 *  bekleme `waitForURL` timeout'una yol açardı. Kamera/mikrofon izinleri baştan verilir (`<LiveKitRoom
 *  video audio>` gerçek `getUserMedia` isteyebilir — izin İSTEMİ olmadan sessizce reddedilmesi
 *  yerine, mevcutsa gerçek bir sahte cihaz kullanılabilsin/izin diyaloğu hiç açılmasın diye). */
async function loginDoctorDirectly(browser: Browser, email: string, password: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3100",
    permissions: ["camera", "microphone"],
  });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL(/\/doctor$/, { timeout: 15_000 });
  return {
    page,
    close: async () => {
      await context.close();
    },
  };
}

/**
 * qa-agent BULGUSU (bu dosyada belgelenir/atlatılır, frontend-agent'a raporlandı — bkz. final
 * rapor, KRİTİK — DETERMİNİSTİK, "flaky" bir yarış DEĞİL): `ConsultationRoom::loadAppointment()`
 * mount'ta HEMEN (`useEffect`, hiçbir bekleme olmadan) `GET /appointments/{id}` çağırır.
 * `AuthProvider`'ın kendi mount-time `authApi.refresh()`'i (httpOnly cookie → yeni access token,
 * bellek-içi `token-store.ts`) React'in "child effect'ler ATA effect'lerden ÖNCE çalışır" kuralı
 * gereği HER ZAMAN `ConsultationRoom`'un (derinlerde bir alt bileşen) effect'inden SONRA başlar —
 * yani `?t=` misafir token'ı OLMADAN (yalnızca oturuma dayalı) HER TAM SAYFA YÜKLEMESİNDE
 * `getAppointment` isteği `Authorization` header'ı OLMADAN gider (elle doğrulandı — `curl`/Node
 * script + gerçek Playwright tarayıcısıyla: `getAccessToken()` her seferinde `null`), backend bunu
 * (doğru biçimde, IDOR'a karşı) misafir/token'sız kabul edip `404 Randevu bulunamadı.` döner.
 * `ConsultationRoom` bu durumdan KENDİLİĞİNDEN toparlanmaz — yalnızca manuel "Tekrar Dene" butonu
 * vardır; o ana kadar `AuthProvider`'ın `refresh()`'i ZATEN tamamlanmış olduğundan (aynı sayfada,
 * yalnızca ikinci bir `fetch` denemesi) tıklanınca `200` döner (elle doğrulandı). Bu YÜZDEN
 * `telehealth-consultation.spec.ts::gotoAndWaitReady`'nin "tam navigasyonu TEKRARLA" deseni BURADA
 * İŞE YARAMAZ (denendi — 45sn boyunca HER tekrar navigasyon AYNI şekilde kaybetti, çünkü sıralama
 * rastgele değil DETERMİNİSTİK); doğru atlatma "Tekrar Dene" BUTONUNA tıklamaktır (sayfa YENİDEN
 * yüklenmez, `getAccessToken()` artık dolu). frontend-agent'a raporlanmalıdır: `loadAppointment()`
 * `useAuthOptional()`'ın `status === "loading"`'den çıkmasını beklemeli (veya en azından bir kez
 * otomatik yeniden denemeli) — gerçek bir doktor/hasta `/consultation/{id}`'e doğrudan bir link/yer
 * imiyle (SPA içi client-side navigasyon DEĞİL, tam sayfa yüklemesi) geldiğinde HER ZAMAN önce bu
 * yanlış-negatif "Randevu bulunamadı" ekranını görür.
 */
async function gotoConsultationAndWaitReady(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const heading = page.getByRole("heading", { name: /ile Görüşme$/ });
  const retryButton = page.getByRole("button", { name: "Tekrar Dene" });
  await Promise.race([
    heading.waitFor({ state: "visible", timeout: 20_000 }),
    retryButton.waitFor({ state: "visible", timeout: 20_000 }).then(() => retryButton.click()),
  ]);
  await expect(heading).toBeVisible({ timeout: 15_000 });
}

/**
 * Her çağrıda GERÇEK rezervasyon akışından (public `POST /appointments/bookings`, tek slot) geçen
 * taze bir randevu üretir — `telehealth-portal-isolation.spec.ts` İLE AYNI desen (`createBookingRaw`
 * + `markBookingPaidDirectly` + `setAppointmentStatusDirectly(..., "SCHEDULED")`).
 *
 * qa-agent BULGUSU (bu turda keşfedildi — DEPRECATED `POST /appointments` (tekil randevu) ucunu
 * KULLANMAKTAN VAZGEÇİLDİ): `createAppointmentRaw` ([TCT] §9.7.3 gereği) içeride YİNE bir
 * `AppointmentBooking` satırı üretir (`paymentStatus: PENDING`) — `setAppointmentStatusDirectly`
 * ile randevunun KENDİ `status`'unu `SCHEDULED` yapmak YETERLİ DEĞİLDİR: `meeting-token`/
 * `recording/start` uçlarındaki katılım penceresi hesabı `booking` VARSA HER ZAMAN
 * `getBookingJoinWindow(...)`'a düşer ve bu fonksiyon `paymentStatus !== "PAID"` iken (ödeme hiç
 * tamamlanmadığı için) `null`/`null` (asla katılınabilir DEĞİL) döner — `status` alanı SCHEDULED
 * olsa bile `409 APPOINTMENT_NOT_JOINABLE` ile sonuçlanır (elle, doğrudan API çağrılarıyla
 * doğrulandı). Bu yüzden `bookingId`'e doğrudan erişimin olduğu `createBookingRaw` kullanılır —
 * `markBookingPaidDirectly` booking'in `paymentStatus`'unu da `PAID` yapar.
 */
async function bookRealAppointment(patientSuffix: string): Promise<CreatedAppointment> {
  const { from, to } = defaultSlotRangeISODates(30);
  const slotsRes = await getPublicDoctorSlotsRaw(doctorFixture.slug, from, to);
  const slot = (slotsRes.data ?? []).find((s) => s.available);
  if (!slot) throw new Error("qa-agent: recording e2e testleri için müsait slot bulunamadı.");
  const res = await createBookingRaw({
    doctorSlug: doctorFixture.slug,
    slots: [slot.startsAt],
    patientName: `QA E2E Recording Hasta ${patientSuffix}`,
    patientEmail: `qa-e2e-recording-${patientSuffix}-${Date.now()}@example.com`,
  });
  if (res.status !== 201 || !res.data) {
    throw new Error(`qa-agent: recording e2e randevusu oluşturulamadı (${patientSuffix}): ${res.status} ${JSON.stringify(res.error)}`);
  }
  markBookingPaidDirectly(res.data.bookingId);
  const appointment = res.data.appointments[0]!;
  return {
    id: appointment.id,
    doctorSlug: doctorFixture.slug,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    status: appointment.status,
    priceCents: doctorFixture.sessionPriceCents,
    currency: doctorFixture.currency,
    accessToken: res.data.accessToken,
  };
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(180_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;

  await resetFixtureUserToBaseline(adminToken, DOCTOR_EMAIL);

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  initialRecordingModuleEnabled = modules.find((m) => m.key === RECORDING_MODULE_KEY)?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);
  // Baseline — bu suite'in madde 1/3 testleri modülün KAPALI durumunu varsayar (module-registry.ts
  // `defaultEnabled: false` ile TUTARLI, her yeni kurulumun gerçek varsayılanı).
  await patchSiteModule(adminToken, RECORDING_MODULE_KEY, false);

  doctorFixture = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `QA E2E Kayıt Doktoru ${RUN_SUFFIX}`,
    bio: "qa-agent — görüşme kaydı e2e fixture doktoru.",
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

  await getFixtureUserToken(DOCTOR_EMAIL, DOCTOR_PASSWORD, "QA E2E Kayıt Doktoru Hesabı");
  const doctorUser = await adminGetUserByEmail(adminToken, DOCTOR_EMAIL);
  if (!doctorUser) throw new Error("qa-agent: doktor fixture kullanıcısı oluşturulamadı.");
  await linkDoctorUserRaw(adminToken, doctorFixture.id, doctorUser.id);

  ({ page: adminPage, close: closeAdminSession } = await createAuthenticatedPage(browser));
  ({ page: doctorPage, close: closeDoctorSession } = await loginDoctorDirectly(browser, DOCTOR_EMAIL, DOCTOR_PASSWORD));
});

test.afterAll(async () => {
  if (closeAdminSession) await closeAdminSession();
  if (closeDoctorSession) await closeDoctorSession();
  await resetFixtureUserToBaseline(adminToken, DOCTOR_EMAIL);
  // Doktorun GERÇEK randevuları var (`Appointment.doctor` `onDelete: Restrict`) — silme isteği 409
  // ile başarısız olabilir, leftover satır sonraki koşumları BOZMAZ (RUN_SUFFIX benzersiz) —
  // `telehealth-portal-isolation.spec.ts::afterAll` İLE AYNI desen.
  if (doctorFixture) await deleteAdminDoctorFixture(adminToken, doctorFixture.id).catch(() => undefined);
  await patchSiteModule(adminToken, RECORDING_MODULE_KEY, initialRecordingModuleEnabled).catch(() => undefined);
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

// =============================================================================
// madde 1 — `telehealth-recording` KAPALIYKEN (varsayılan durum)
// =============================================================================
test("madde 1: modül kapalıyken RecordingIndicator hiç görünmez, getRecordingStatus 404'ü sessizce yutulur (video odası çökmez)", async () => {
  test.setTimeout(60_000);
  const appointment = await bookRealAppointment("module-off");
  shiftAppointmentIntoJoinWindowDirectly(appointment.id, 30, 30);
  // Randevunun KENDİ `status`'unu da `SCHEDULED`'a alır — bkz. `bookRealAppointment()` başlığındaki
  // qa-agent notu (booking `paymentStatus: PAID` TEK BAŞINA yeterli değildir).
  setAppointmentStatusDirectly(appointment.id, "SCHEDULED");

  const pageErrors: Error[] = [];
  doctorPage.on("pageerror", (err) => pageErrors.push(err));

  await gotoConsultationAndWaitReady(doctorPage, `/consultation/${appointment.id}`);

  const joinButton = doctorPage.getByRole("button", { name: "Görüşmeye Katıl" });
  await expect(joinButton).toBeVisible({ timeout: 15_000 });

  const recordingStatusResponse = doctorPage.waitForResponse(
    (res) => res.url().includes(`/appointments/${appointment.id}/recording`) && !res.url().includes("/recording/"),
    { timeout: 15_000 }
  );
  await joinButton.click();

  // `RecordingSignalBridge` yalnızca `<LiveKitRoom>` mount olduktan SONRA (RoomContext içinde)
  // çalışır — bağlantı hedefi (`LIVEKIT_URL=wss://e2e-fake.livekit.cloud`) sahte/ulaşılamaz
  // olduğundan `Connected` durumuna HİÇ ulaşılmaz, ama bu testin amacı için gerekmez: kontrol
  // çubuğu (mikrofon/kamera/ekran paylaşım butonları) ve bağlantı rozeti `RoomContext` kurulur
  // kurulmaz render olur.
  await expect(doctorPage.getByLabel(/Mikrofonu (aç|kapat)/)).toBeVisible({ timeout: 20_000 });

  const statusRes = await recordingStatusResponse;
  expect(statusRes.status(), "modül kapalıyken GET .../recording 404 dönmeli (module guard)").toBe(404);

  // Kayıt özelliği HİÇBİR ZAMAN `recording` state'ini dolduramadı (404 sessizce yutuldu) — kırmızı
  // "Bu görüşme kaydediliyor" rozeti hiç görünmemeli.
  await expect(doctorPage.getByText("Bu görüşme kaydediliyor")).toHaveCount(0);

  // qa-agent BULGUSU (dosya başlığında detaylandırıldı, frontend-agent'a raporlandı) —
  // `RecordingControls` modül durumundan BAĞIMSIZ olarak `isDoctor` iken HER ZAMAN render olur;
  // "Kaydı Başlat" butonu bu yüzden burada GÖRÜNÜR (beklenen/doğru davranış OLMASAYDI HİÇ
  // görünmemesi gerekirdi). Bu test mevcut (buggy) davranışı belgeler ve tıklandığında sayfanın
  // ÇÖKMEDİĞİNİ, backend'in modül guard'ının ürettiği 404'ün dürüst/genel bir hata metni olarak
  // (beyaz ekran/uncaught exception YERİNE) gösterildiğini doğrular.
  const startButton = doctorPage.getByRole("button", { name: "Kaydı Başlat" });
  await expect(startButton).toBeVisible();
  await startButton.click();
  await expect(doctorPage.getByText("Kaynak bulunamadı.", { exact: false })).toBeVisible({ timeout: 10_000 });

  // Görüşme odası hâlâ tam işlevsel — kontrol çubuğu/bağlantı rozeti DOM'da kalmaya devam ediyor.
  await expect(doctorPage.getByLabel(/Mikrofonu (aç|kapat)/)).toBeVisible();
  expect(pageErrors, `Sayfada yakalanmamış hata(lar): ${pageErrors.map((e) => e.message).join(", ")}`).toHaveLength(0);
});

// =============================================================================
// madde 4 — backend API guard matrisi (Playwright `request` context, tarayıcı GEREKMEZ)
// =============================================================================
test("madde 4: modül kapalıyken TÜM kayıt uçları 404 döner; POST /webhooks/livekit modül guard'sız olduğu için (geçersiz imzayla) 400 döner", async ({
  request,
}) => {
  const appointment = await bookRealAppointment("api-guard-matrix");
  const base = `${API_BASE_URL}/appointments/${appointment.id}/recording`;

  const startRes = await request.post(`${base}/start`);
  expect(startRes.status(), "POST .../recording/start").toBe(404);

  const consentRes = await request.post(`${base}/consent`, { data: { granted: true } });
  expect(consentRes.status(), "POST .../recording/consent").toBe(404);

  const stopRes = await request.post(`${base}/stop`);
  expect(stopRes.status(), "POST .../recording/stop").toBe(404);

  const getRes = await request.get(base);
  expect(getRes.status(), "GET .../recording").toBe(404);

  const contentRes = await request.get(`${base}/content`);
  expect(contentRes.status(), "GET .../recording/content").toBe(404);

  const deleteRes = await request.delete(base);
  expect(deleteRes.status(), "DELETE .../recording").toBe(404);

  // `telehealth.egress-webhook.routes.ts` başlığındaki BİLİNÇLİ istisna (architect onaylı) —
  // modül guard'ı YOKTUR (kayıt sürerken modül kapatılsa dahi `egress_ended` işlenmelidir), bu
  // yüzden `telehealth-recording` kapalıyken bile bu uç 404 DEĞİL, imza doğrulamasının kendi
  // hata koduyla (400, `Authorization` header'ı eksik) yanıt verir.
  const webhookRes = await request.post(`${API_BASE_URL}/webhooks/livekit`, {
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify({ event: "egress_ended" }),
  });
  expect(webhookRes.status(), "POST /webhooks/livekit (imzasız)").toBe(400);
});

// =============================================================================
// madde 4 (devam) — `/admin/modules` zorunlu uyarı dialogu
// =============================================================================
test("madde 2: /admin/modules — 'Vazgeç' modülü AÇMAZ, 'Anladım, Etkinleştir' AÇAR", async () => {
  await adminPage.goto("/admin/modules");
  await expect(adminPage.getByText(RECORDING_MODULE_LABEL, { exact: true })).toBeVisible({ timeout: 15_000 });

  const offSwitch = adminPage.getByRole("switch", { name: `${RECORDING_MODULE_LABEL} modülünü etkinleştir` });
  await expect(offSwitch).toBeVisible();

  // ---- "Vazgeç" — modül AÇILMAZ ----
  await offSwitch.click();
  await expect(adminPage.getByRole("heading", { name: "Görüşme Kaydını Etkinleştir" })).toBeVisible({ timeout: 10_000 });
  await expect(
    adminPage.getByText("Görüşme kaydı özel nitelikli sağlık verisi (ses+görüntü) oluşturur", { exact: false })
  ).toBeVisible();
  await adminPage.getByRole("button", { name: "Vazgeç" }).click();
  await expect(adminPage.getByRole("heading", { name: "Görüşme Kaydını Etkinleştir" })).toHaveCount(0);
  await expect(adminPage.getByRole("switch", { name: `${RECORDING_MODULE_LABEL} modülünü etkinleştir` })).toBeVisible();
  expect((await getSiteModules(adminToken)).find((m) => m.key === RECORDING_MODULE_KEY)?.enabled).toBe(false);

  // ---- "Anladım, Etkinleştir" — modül GERÇEKTEN açılır ----
  await offSwitch.click();
  await expect(adminPage.getByRole("heading", { name: "Görüşme Kaydını Etkinleştir" })).toBeVisible({ timeout: 10_000 });
  await adminPage.getByRole("button", { name: "Anladım, Etkinleştir" }).click();
  await expect(adminPage.getByText(`"${RECORDING_MODULE_LABEL}" modülü etkinleştirildi.`, { exact: false })).toBeVisible({ timeout: 10_000 });
  await expect(adminPage.getByRole("switch", { name: `${RECORDING_MODULE_LABEL} modülünü devre dışı bırak` })).toBeVisible();
  expect((await getSiteModules(adminToken)).find((m) => m.key === RECORDING_MODULE_KEY)?.enabled).toBe(true);
});

// =============================================================================
// madde 3 — `telehealth-recording` AÇIK ama LiveKit/S3 yapılandırılmamış (bu ortamın gerçek durumu)
// =============================================================================
test("madde 3: modül açık ama S3/webhook yapılandırılmamışken 'Kaydı Başlat' dürüst 503 hatası gösterir, çökme yok", async () => {
  test.setTimeout(60_000);
  // Önceki test modülü GERÇEKTEN açtı (`PATCH /admin/modules/telehealth-recording`) — burada
  // ayrıca doğrulanır (bu testin ön koşulu, sıralı `describe` modu ile GARANTİ edilir).
  expect((await getSiteModules(adminToken)).find((m) => m.key === RECORDING_MODULE_KEY)?.enabled).toBe(true);

  const appointment = await bookRealAppointment("module-on-not-configured");
  shiftAppointmentIntoJoinWindowDirectly(appointment.id, 30, 30);
  // Randevunun KENDİ `status`'unu da `SCHEDULED`'a alır — bkz. `bookRealAppointment()` başlığındaki
  // qa-agent notu (booking `paymentStatus: PAID` TEK BAŞINA yeterli değildir).
  setAppointmentStatusDirectly(appointment.id, "SCHEDULED");

  const pageErrors: Error[] = [];
  doctorPage.on("pageerror", (err) => pageErrors.push(err));

  await gotoConsultationAndWaitReady(doctorPage, `/consultation/${appointment.id}`);

  const joinButton = doctorPage.getByRole("button", { name: "Görüşmeye Katıl" });
  await expect(joinButton).toBeVisible({ timeout: 15_000 });
  await joinButton.click();
  await expect(doctorPage.getByLabel(/Mikrofonu (aç|kapat)/)).toBeVisible({ timeout: 20_000 });

  const startButton = doctorPage.getByRole("button", { name: "Kaydı Başlat" });
  await expect(startButton).toBeVisible();

  const startResponse = doctorPage.waitForResponse((res) => res.url().endsWith(`/appointments/${appointment.id}/recording/start`), {
    timeout: 15_000,
  });
  await startButton.click();
  const startRes = await startResponse;
  expect(startRes.status(), "modül açık ama S3/webhook yapılandırılmamışken 503 RECORDING_NOT_CONFIGURED dönmeli").toBe(503);

  // Dürüst, anlamlı hata mesajı — `RecordingNotConfiguredError` varsayılan metni AYNEN gösterilir
  // (`friendlyErrorMessage` → `err.message`), beyaz ekran/çökme YOK.
  await expect(
    doctorPage.getByText("Görüşme kaydı altyapısı bu kurulumda yapılandırılmamış.", { exact: false })
  ).toBeVisible({ timeout: 10_000 });

  // Görüşme odası hâlâ tam işlevsel.
  await expect(doctorPage.getByLabel(/Mikrofonu (aç|kapat)/)).toBeVisible();
  await expect(doctorPage.getByRole("button", { name: "Kaydı Başlat" })).toBeVisible();
  expect(pageErrors, `Sayfada yakalanmamış hata(lar): ${pageErrors.map((e) => e.message).join(", ")}`).toHaveLength(0);
});
