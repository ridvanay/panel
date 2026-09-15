import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession, getSiteModules, patchSiteModule } from "./support/api";
import {
  ensureTelehealthModuleWithDoctors,
  listAllAdminDoctors,
  getPublicDoctorSlotsRaw,
  defaultSlotRangeISODates,
  createAppointmentRaw,
  requestMeetingTokenRaw,
  shiftAppointmentIntoJoinWindowDirectly,
  markAppointmentJoinableDirectly,
  type CreatedAppointment,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — gerçek yerel LiveKit doğrulama turu (2026-09-15). `telehealth-consultation.spec.ts`
 * (backend-agent/frontend-agent/devops-agent'ın bu turda LiveKit'i yerel Docker'a bağladığı, madde
 * 10/11 testlerini kapsayan dosya) İLE AYNI fixture'ları kullanır, AMA BİLEREK AYRI BİR DOSYADA
 * yaşar: bu dosyanın testleri GERÇEKTEN bir kamera/mikrofon track'i publish etmeyi gerektirir, bu
 * yüzden `playwright.config.ts`'in varsayılan `chromium` projesiyle (bundled Chromium, bu Windows
 * makinesinde `--use-fake-device-for-media-stream`'i desteklemiyor — headless'ta `getUserMedia`
 * `NotSupportedError`, headed'da video `NotFoundError`) ÇALIŞAMAZ. Kendi `chrome-livekit-media`
 * projesinde (gerçek sistem Google Chrome, headed, `--use-fake-device-for-media-stream` +
 * `--use-fake-ui-for-media-permissions`) koşar — bkz. `playwright.config.ts` başlığındaki gerekçe.
 * `chromium` projesi bu dosyayı `testIgnore` ile ATLAR (çift/çakışan koşum OLMASIN diye).
 *
 * qa-agent BULGUSU (bu turda keşfedildi, `support/telehealth-fixtures.ts::
 * markAppointmentJoinableDirectly` başlığında AYRINTILI belgelendi) — `shiftAppointmentInto
 * JoinWindowDirectly` TEK BAŞINA gerçek bir bağlantı için YETERLİ DEĞİLDİR: randevu bağlı olduğu
 * `AppointmentBooking` `PAID` olana VE randevunun KENDİ `status`'u `SCHEDULED`'a geçene kadar `POST
 * .../meeting-token` her zaman `409 APPOINTMENT_NOT_JOINABLE` döner (appointment.status kontrolü
 * booking/pencere kontrolünden ÖNCE çalışır). Bu yüzden `markAppointmentJoinableDirectly` her iki
 * testte de `shiftAppointmentIntoJoinWindowDirectly` İLE BİRLİKTE çağrılır.
 *
 * ÇALIŞTIRMA (yerel, manuel — `telehealth-consultation.spec.ts` başlığındaki AYNI
 * backend(4001)/frontend(3100) kurulumuna karşı):
 *   cd frontend && E2E_SKIP_WEBSERVER=1 E2E_FRONTEND_URL=http://siteadi.localhost:3100 \
 *     npx playwright test tests/e2e/telehealth-consultation-livekit-live.spec.ts \
 *     --project=chrome-livekit-media --no-deps
 */
test.describe.configure({ mode: "serial" });

let adminToken: string;
let initialTelehealthEnabled: boolean;
let bookableDoctorSlug: string;
let liveKitConfigured: boolean;

async function gotoAndWaitReady(page: Page, url: string, ready: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await ready();
  }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });
}

async function bookRealAppointment(patientSuffix: string): Promise<CreatedAppointment> {
  const { from, to } = defaultSlotRangeISODates(30);
  const slotsRes = await getPublicDoctorSlotsRaw(bookableDoctorSlug, from, to);
  const slot = (slotsRes.data ?? []).find((s) => s.available);
  if (!slot) throw new Error("Konsültasyon testleri için müsait slot bulunamadı.");
  const res = await createAppointmentRaw({
    doctorSlug: bookableDoctorSlug,
    startsAt: slot.startsAt,
    patientName: `QA E2E Hasta ${patientSuffix}`,
    patientEmail: `qa-e2e-telehealth-live-${patientSuffix}-${Date.now()}@example.com`,
  });
  if (res.status !== 201 || !res.data) {
    throw new Error(`Randevu oluşturulamadı (${patientSuffix}): ${res.status} ${JSON.stringify(res.error)}`);
  }
  return res.data;
}

/** Gerçekten katılınabilir (ödenmiş + SCHEDULED + katılım penceresi içinde) taze bir randevu. */
async function bookJoinableRealAppointment(patientSuffix: string): Promise<CreatedAppointment> {
  const appointment = await bookRealAppointment(patientSuffix);
  shiftAppointmentIntoJoinWindowDirectly(appointment.id, 90, 30);
  markAppointmentJoinableDirectly(appointment.id);
  return appointment;
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(150_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;

  await ensureTelehealthModuleWithDoctors(adminToken);

  const doctors = await listAllAdminDoctors(adminToken);
  const { from, to } = defaultSlotRangeISODates(30);
  for (const doctor of doctors) {
    const slotsRes = await getPublicDoctorSlotsRaw(doctor.slug, from, to);
    if (slotsRes.status === 200 && (slotsRes.data ?? []).some((s) => s.available)) {
      bookableDoctorSlug = doctor.slug;
      break;
    }
  }
  if (!bookableDoctorSlug) throw new Error("Konsültasyon testleri için müsait slotu olan bir doktor bulunamadı.");

  // `telehealth-consultation.spec.ts::beforeAll` İLE AYNI "probe" deseni.
  const probe = await requestMeetingTokenRaw("00000000-0000-0000-0000-000000000000");
  liveKitConfigured = probe.status !== 503;
});

test.afterAll(async () => {
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

test("madde 12: LiveKit yapılandırılmışken 'Görüntülü Görüşme Yapılandırılmamış' paneli ARTIK GÖRÜNMEZ, gerçek bağlantı 'Bağlandı' rozetine ULAŞIR", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  test.skip(
    !liveKitConfigured,
    "Bu ortamda LIVEKIT_URL/API_KEY/API_SECRET tanımlı değil — regresyon testinin amacı tam olarak " +
      "bunların YAPILANDIRILDIĞI durumu doğrulamak (bkz. devops-agent'ın yerel `livekit` Docker " +
      "servisi + `backend/.env.e2e` güncellemesi)."
  );
  await context.grantPermissions(["camera", "microphone"]);

  const appointment = await bookJoinableRealAppointment("live-badge");

  await gotoAndWaitReady(page, `/consultation/${appointment.id}?t=${appointment.accessToken}`, async () => {
    await expect(page.getByRole("heading", { name: /ile Görüşme$/ })).toBeVisible();
  });
  await expect(page.getByText(`QA E2E Hasta live-badge`, { exact: false })).toBeVisible();

  const joinButton = page.getByRole("button", { name: "Görüşmeye Katıl" });
  await expect(joinButton).toBeVisible({ timeout: 15_000 });
  await joinButton.click();

  // Regresyonun kalbi — dürüst "yapılandırılmamış" durum ekranı ARTIK HİÇ görünmez (§4.4 madde 3
  // panelinin `telehealth-consultation.spec.ts` madde 10'daki KENDİSİ DEĞİL, bu ortamda artık
  // hiç tetiklenemeyen bir durumun YOKLUĞUNU doğruluyoruz).
  await expect(page.getByRole("heading", { name: "Görüntülü Görüşme Yapılandırılmamış" })).toHaveCount(0);

  // Gerçek LiveKit bağlantısı `ConnectionStatusBadge`'in "Bağlandı" (success tone, `Wifi` ikonu)
  // durumuna ULAŞIR — yalnızca websocket seviyesinde DEĞİL (bu, kamera/mikrofon track publish'i
  // BAŞARISIZ olduğunda dahi gerçekleşir ve rozet SONSUZA KADAR "Bağlanıyor…"da takılı kalır,
  // qa-agent'ın `chromium` (varsayılan, sahte-medya-cihazı DESTEKLEMEYEN) projesiyle elle
  // doğrulanmış bir bulgu — bkz. `playwright.config.ts::chrome-livekit-media` başlığı).
  await expect(page.getByText("Bağlandı", { exact: true })).toBeVisible({ timeout: 20_000 });
});

test("madde 13: odaya bağlanınca kamera/mikrofon/ekran paylaşımı kontrolleri AKTİF — video mount olur, mikrofon/kamera toggle GERÇEKTEN çalışır", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  test.skip(
    !liveKitConfigured,
    "Bu ortamda LIVEKIT_URL/API_KEY/API_SECRET tanımlı değil — kontrol çubuğu yalnızca gerçek bir " +
      "odaya bağlanıldığında (LiveKitRoom altında) render edilir."
  );
  await context.grantPermissions(["camera", "microphone"]);

  const appointment = await bookJoinableRealAppointment("live-controls");

  await gotoAndWaitReady(page, `/consultation/${appointment.id}?t=${appointment.accessToken}`, async () => {
    await expect(page.getByRole("heading", { name: /ile Görüşme$/ })).toBeVisible();
  });

  const joinButton = page.getByRole("button", { name: "Görüşmeye Katıl" });
  await expect(joinButton).toBeVisible({ timeout: 15_000 });
  await joinButton.click();

  await expect(page.getByText("Bağlandı", { exact: true })).toBeVisible({ timeout: 20_000 });

  // Gerçek `<video>` mount oluyor — sahte device'ın yerel kamera track'i kendi PIP kartında render
  // edilir (`consultation-room.tsx::ConsultationStage`'in `localCameraTrack` dalı).
  await expect.poll(async () => page.locator("video").count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);

  // Mikrofon — başlangıçta AÇIK (`audio` prop'u `true`), `aria-label` "Mikrofonu kapat". Tıklayınca
  // GERÇEKTEN kapanır ve etiket "Mikrofonu aç"a döner (mute/unmute çalışıyor).
  const micOnButton = page.getByRole("button", { name: "Mikrofonu kapat" });
  await expect(micOnButton).toBeVisible({ timeout: 15_000 });
  await expect(micOnButton).toBeEnabled();
  await micOnButton.click();
  await expect(page.getByRole("button", { name: "Mikrofonu aç" })).toBeVisible({ timeout: 10_000 });

  // Kamera — AYNI toggle deseni (başlangıçta AÇIK → "Kamerayı kapat" → tıkla → "Kamerayı aç").
  const cameraOnButton = page.getByRole("button", { name: "Kamerayı kapat" });
  await expect(cameraOnButton).toBeVisible({ timeout: 15_000 });
  await expect(cameraOnButton).toBeEnabled();
  await cameraOnButton.click();
  await expect(page.getByRole("button", { name: "Kamerayı aç" })).toBeVisible({ timeout: 10_000 });

  // Ekran paylaşımı — kontrol çubuğunda render/tıklanabilir olduğu doğrulanır (görev tanımı gereği
  // GERÇEKTEN başlatılması test EDİLMEZ — `getDisplayMedia` fake cihazı ayrı bir karmaşıklık).
  const screenShareButton = page.getByRole("button", { name: "Ekranı paylaş" });
  await expect(screenShareButton).toBeVisible({ timeout: 10_000 });
  await expect(screenShareButton).toBeEnabled();

  // Ayrıl butonu da kontrol çubuğunun bir parçası — varlığı/erişilebilirliği doğrulanır.
  await expect(page.getByRole("button", { name: "Görüşmeden ayrıl" })).toBeVisible();
});
