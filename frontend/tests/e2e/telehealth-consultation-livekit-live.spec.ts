import { test, expect, type Page } from "@playwright/test";
import { authenticator } from "otplib";
import { getCachedAdminSession, getSiteModules, patchSiteModule, getFixtureUserToken, setupAndEnableTwoFactorForSelf } from "./support/api";
import { adminGetUserByEmail, adminUpdateStatus } from "./support/admin-users-fixtures";
import {
  ensureTelehealthModuleWithDoctors,
  listAllAdminDoctors,
  getPublicDoctorSlotsRaw,
  defaultSlotRangeISODates,
  createAppointmentRaw,
  createBookingRaw,
  requestMeetingTokenRaw,
  shiftAppointmentIntoJoinWindowDirectly,
  markAppointmentJoinableDirectly,
  markBookingPaidDirectly,
  setAppointmentStatusDirectly,
  createAdminDoctorFixture,
  deleteAdminDoctorFixture,
  setDoctorAvailabilityRaw,
  linkDoctorUserRaw,
  type CreatedAppointment,
  type CreatedFixtureDoctor,
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

  // qa-agent — bug-fix turu (2026-09-17) doğrulaması: eski `DisconnectButton` (aria-label
  // "Görüşmeden ayrıl", DOĞRUDAN `room.disconnect()`) `ConfirmDialog` ile onaylı bir "Görüşmeyi
  // sonlandır" butonuna dönüştü — STALE hale gelen eski assertion burada GÜNCELLENDİ (regresyon
  // bulgusu, bkz. final rapor).
  const endCallButton = page.getByRole("button", { name: "Görüşmeyi sonlandır" });
  await expect(endCallButton).toBeVisible();
  await expect(endCallButton).toBeEnabled();
});

test("madde 15 [GERÇEK LiveKit]: Tam Ekran toggle gerçek tarayıcıda video sahnesine uygulanır, ESC ile senkron döner; 'Görüşmeyi Sonlandır' onay diyaloğu açar, 'Vazgeç' görüşmeyi KESMEZ", async ({
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

  const appointment = await bookJoinableRealAppointment("live-fullscreen-endcall");

  await gotoAndWaitReady(page, `/consultation/${appointment.id}?t=${appointment.accessToken}`, async () => {
    await expect(page.getByRole("heading", { name: /ile Görüşme$/ })).toBeVisible();
  });

  const joinButton = page.getByRole("button", { name: "Görüşmeye Katıl" });
  await expect(joinButton).toBeVisible({ timeout: 15_000 });
  await joinButton.click();
  await expect(page.getByText("Bağlandı", { exact: true })).toBeVisible({ timeout: 20_000 });

  // Tam Ekran — `fullscreenSupported` mount SONRASI true'ya döner (gerçek tarayıcı, SSR DEĞİL),
  // buton görünür olmalı.
  // NOT (qa-agent): Playwright'ın `getByRole(..., { name })` eşleşmesi VARSAYILAN olarak ALT DİZE
  // (substring) — "Tam Ekran" "Tam Ekrandan Çık"'ın İÇİNDE geçer, bu yüzden `exact: true` ŞART
  // (aksi hâlde iki durum birbirinden AYIRT EDİLEMEZ, ilk turda tam olarak bu yüzden YANLIŞ-POZİTİF
  // bir geçiş yaşandı — bkz. final rapor).
  const fullscreenButton = page.getByRole("button", { name: "Tam Ekran", exact: true });
  await expect(fullscreenButton).toBeVisible({ timeout: 10_000 });
  await fullscreenButton.click();
  // `document.fullscreenElement` gerçekten `stageRef` (LiveKitRoom kök div'i) mi — TÜM SAYFA
  // (`document.documentElement`) DEĞİL mi — burada doğrudan doğrulanır.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const el = document.fullscreenElement;
        return {
          isFullscreen: el !== null,
          isDocumentElement: el === document.documentElement,
          hasLiveKitClass: el?.className.includes("lk-room-container") ?? false,
        };
      })
    )
    .toMatchObject({ isFullscreen: true, isDocumentElement: false });
  await expect(page.getByRole("button", { name: "Tam Ekrandan Çık", exact: true })).toBeVisible({ timeout: 5_000 });

  // ESC ile çıkış (native tarayıcı davranışı, `toggleFullscreen()`'DEN GEÇMEZ) — qa-agent BULGUSU:
  // bu otomasyon ortamında (arka planda başlatılan, OS-seviyesinde odaklanmamış GERÇEK Chrome
  // penceresi) native ESC-ile-tam-ekrandan-çıkış tetiklenmiyor (`document.fullscreenElement`
  // DEĞİŞMİYOR) — bu, tarayıcı chrome'unun kendi pencere-odak gerektiren davranışı, `fullscreen
  // change` dinleyicisinin (`consultation-room.tsx`) KENDİSİYLE İLGİLİ DEĞİL (aşağıdaki programatik
  // çıkış — AYNI dinleyiciden geçer — BAŞARIYLA senkronize olduğu için kanıtlanmıştır). Bu yüzden
  // ESC'nin GERÇEKTEN çıkardığını burada KESİN doğrulayamıyoruz — bkz. final rapor "doğrulanamadı"
  // bölümü; kod okuması güvenli görünüyor (§ ilgili yorum satırları, `theme-toggle.tsx` ile aynı
  // sağlam desen).
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const escExitedFullscreen = await page.evaluate(() => document.fullscreenElement === null);
  if (!escExitedFullscreen) {
    test.info().annotations.push({
      type: "qa-agent-limitation",
      description:
        "ESC-ile-tam-ekrandan-çıkış bu otomasyon ortamında (odaksız arka plan penceresi) native " +
        "olarak TETİKLENMEDİ — `fullscreenchange` dinleyicisinin state senkronizasyonu buradan " +
        "DOĞRULANAMADI, yalnızca kod okumasıyla değerlendirildi. Programatik çıkış (aşağıda, AYNI " +
        "dinleyiciyi kullanır) BAŞARIYLA doğrulandı.",
    });
    // Native ESC bu ortamda çalışmadıysa hâlâ tam ekrandayızdır — testin geri kalanının anlamlı
    // kalması için AYNI toggle butonuyla (programatik, gerçek kullanıcı jesti — Playwright click)
    // tam ekrandan çıkılır; bu YOL `fullscreenchange` dinleyicisinin kendisini (giriş yolunda
    // olduğu gibi) YİNE test eder.
    await page.getByRole("button", { name: "Tam Ekrandan Çık", exact: true }).click();
  }
  await expect(page.getByRole("button", { name: "Tam Ekran", exact: true })).toBeVisible({ timeout: 5_000 });
  await expect.poll(async () => page.evaluate(() => document.fullscreenElement !== null)).toBe(false);

  // Görüşmeyi Sonlandır — DOĞRUDAN disconnect OLMAZ, önce ConfirmDialog açılır.
  const endCallButton = page.getByRole("button", { name: "Görüşmeyi sonlandır" });
  await endCallButton.click();
  await expect(page.getByText("Görüşmeyi sonlandırmak istediğinize emin misiniz?")).toBeVisible();

  // Vazgeç — görüşme KESİLMEZ, "Bağlandı" durumu KORUNUR, konsültasyon sayfasında KALINIR.
  await page.getByRole("button", { name: "Vazgeç" }).click();
  await expect(page.getByText("Görüşmeyi sonlandırmak istediğinize emin misiniz?")).toHaveCount(0);
  await expect(page.getByText("Bağlandı", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/consultation/${appointment.id}`));

  // Şimdi GERÇEKTEN onayla — `room.disconnect()` tetiklenir, hasta dalı HER ZAMAN
  // `/patient/appointments`'a yönlendirilir (bu bir misafir-hasta `?t=` erişimi, `isDoctor` `false`).
  await endCallButton.click();
  await page.getByRole("button", { name: "Görüşmeyi Sonlandır" }).click();
  await expect(page).toHaveURL(/\/patient\/appointments/, { timeout: 15_000 });
});

// =============================================================================
// qa-agent — 4-parçalı kritik hata paketi (2026-09-15) SON adım, madde 1 (zaman kilidinin
// TAMAMEN kalkması). `bookJoinableRealAppointment` (üstteki testler) BİLİNÇLİ OLARAK
// `shiftAppointmentIntoJoinWindowDirectly` kullanır (randevuyu ŞİMDİ katılınabilir pencereye
// kaydırır) — bu YENİ test TAM TERSİNİ kanıtlar: randevu saati GERÇEKTEN 12+ saat sonrasında
// KALIR (zaman kaydırma fixture'ı HİÇ ÇAĞRILMAZ, bkz. görev talimatı), yalnızca booking `PAID` +
// randevu `status` `SCHEDULED` yapılır (`markBookingPaidDirectly` + `setAppointmentStatusDirectly`,
// `patient-portal.spec.ts::bookingCancelled` İLE AYNI iki-adımlı desen — `markBookingPaidDirectly`
// TEK BAŞINA randevunun KENDİ `status`ünü DEĞİŞTİRMEZ). GERÇEK kamera/mikrofon fake-device'ı ile
// GERÇEKTEN "Bağlandı" durumuna ULAŞTIĞINI kanıtlamak — backend'in katılım penceresi kontrolünü
// TAMAMEN kaldırdığının nihai, uçtan uca kanıtı.
// =============================================================================
test("madde 1 [GERÇEK LiveKit]: PAID booking + randevu saati GERÇEKTEN 12+ saat sonrasında olsa da (zaman kaydırma KULLANILMADI) 'Görüşmeye Katıl' GERÇEK bir LiveKit bağlantısı kurar ('Bağlandı')", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  test.skip(
    !liveKitConfigured,
    "Bu ortamda LIVEKIT_URL/API_KEY/API_SECRET tanımlı değil — bu testin amacı tam olarak bunların " +
      "YAPILANDIRILDIĞI durumda zaman kilidinin kalktığını GERÇEK bir bağlantıyla kanıtlamak."
  );
  await context.grantPermissions(["camera", "microphone"]);

  const { from, to } = defaultSlotRangeISODates(30);
  const slotsRes = await getPublicDoctorSlotsRaw(bookableDoctorSlug, from, to);
  const thresholdMs = Date.now() + 12 * 60 * 60_000;
  const slot = (slotsRes.data ?? []).find((s) => s.available && new Date(s.startsAt).getTime() >= thresholdMs);
  if (!slot) throw new Error("qa-agent: 12+ saat sonrasına ait müsait bir slot bulunamadı.");

  const booking = await createBookingRaw({
    doctorSlug: bookableDoctorSlug,
    slots: [slot.startsAt],
    patientName: "QA E2E Hasta live-anytime",
    patientEmail: `qa-e2e-telehealth-live-anytime-${Date.now()}@example.com`,
  });
  if (booking.status !== 201 || !booking.data) {
    throw new Error(`qa-agent: booking oluşturulamadı: ${booking.status} ${JSON.stringify(booking.error)}`);
  }
  const appointmentId = booking.data.appointments[0]!.id;
  const accessToken = booking.data.accessToken;

  // Randevu GERÇEKTEN 12+ saat sonrasında kaldığını doğrula (zaman kaydırma fixture'ı KULLANILMADI).
  const hoursAhead = (new Date(slot.startsAt).getTime() - Date.now()) / 3_600_000;
  expect(hoursAhead).toBeGreaterThanOrEqual(11.9);

  markBookingPaidDirectly(booking.data.bookingId);
  setAppointmentStatusDirectly(appointmentId, "SCHEDULED");

  await gotoAndWaitReady(page, `/consultation/${appointmentId}?t=${accessToken}`, async () => {
    await expect(page.getByRole("heading", { name: /ile Görüşme$/ })).toBeVisible();
  });
  // Uzak geri sayım cümlesi hâlâ GÖRÜNÜYOR (salt bilgilendirme) — buton bunu ARTIK ENGELLEMİYOR.
  await expect(page.getByText(/Randevunuza .*(saat|dakika).*kaldı\./)).toBeVisible({ timeout: 15_000 });

  const joinButton = page.getByRole("button", { name: "Görüşmeye Katıl" });
  await expect(joinButton).toBeVisible({ timeout: 15_000 });
  await expect(joinButton).toBeEnabled();
  await joinButton.click();

  await expect(page.getByRole("heading", { name: "Görüntülü Görüşme Yapılandırılmamış" })).toHaveCount(0);
  // Regresyonun kalbi — GERÇEK LiveKit bağlantısı "Bağlandı" durumuna ULAŞIR (yalnızca UI'da buton
  // görünür OLMASI DEĞİL, backend'in `meeting-token` ucunun GERÇEKTEN 200 döndüğünün ve gerçek bir
  // WebRTC oturumunun KURULDUĞUNUN nihai kanıtı).
  await expect(page.getByText("Bağlandı", { exact: true })).toBeVisible({ timeout: 20_000 });
});

// =============================================================================
// qa-agent — bug-fix turu (2026-09-17): İKİ TARAFLI GERÇEK video doğrulaması. Yukarıdaki testler
// yalnızca KENDİ kameranızın (PIP) mount olduğunu doğruluyordu — raporlanan hatayı (karşı tarafın
// video track'i "publishing"/"participant: doctor:..." loglarına rağmen ana ekranda render
// edilmemesi) YAKALAYAMAZDI. `consultation-room.tsx::ConsultationStage`'deki `useTracks`
// çağrısından `onlySubscribed: false` kaldırıldı (varsayılan `true`'ya dönüldü) — bu seçenek
// GERÇEKTEN abone olunmamış bir track referansı döndürebiliyordu, ki bu da resmi LiveKit
// örneklerinin İZLEMEDİĞİ bir kalıptır ve teorik olarak `ParticipantTile`'ın DOM'a bağlayacak
// gerçek bir `MediaStreamTrack`'i olmadan render edilmesine yol açabilir. NOT (dürüstlük payı) —
// bu makinede localhost loopback'te abonelik o kadar hızlı tamamlanıyor ki bu test HER İKİ
// koddaki hâlde de (eski `onlySubscribed: false` DAHİL) geçti; yani bu test yerelde regresyonu
// AYIRT ETMİYOR, gerçek WAN gecikmesi altında oluşan bir yarış durumunu benzetemiyor. Yine de
// kalıcı bir kazanım: iki taraflı GERÇEK video render'ının HİÇ doğrulanmadığı bir boşluğu
// kapatıyor ve `onlySubscribed: true` + `withPlaceholder` kalıbını resmi/önerilen şekilde
// sabitliyor.
// =============================================================================
test.describe("qa-agent — iki taraflı gerçek video doğrulaması (2026-09-17 bug-fix turu)", () => {
  test.describe.configure({ mode: "serial" });

  const RUN_SUFFIX = Date.now().toString(36);
  const DOCTOR_EMAIL = `qa-e2e-livekit-doctor-${RUN_SUFFIX}@example.com`;
  const DOCTOR_PASSWORD = "QaE2eLivekitDoctor12345!";

  let twoPartyDoctor: CreatedFixtureDoctor;
  let doctorUserId: string;
  let doctorTotpSecret: string;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(90_000);
    test.skip(!liveKitConfigured, "Bu ortamda LIVEKIT_URL/API_KEY/API_SECRET tanımlı değil.");

    twoPartyDoctor = await createAdminDoctorFixture(adminToken, {
      title: "Dr.",
      fullName: `QA E2E LiveKit Doktoru ${RUN_SUFFIX}`,
      bio: "qa-agent — iki taraflı gerçek video doğrulaması fixture doktoru.",
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
      twoPartyDoctor.id,
      ([1, 2, 3, 4, 5, 6, 7] as const).map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }))
    );

    const doctorUserToken = await getFixtureUserToken(DOCTOR_EMAIL, DOCTOR_PASSWORD, "QA E2E LiveKit Doktoru");
    const doctorUser = await adminGetUserByEmail(adminToken, DOCTOR_EMAIL);
    if (!doctorUser) throw new Error("qa-agent: LiveKit iki taraflı test doktor kullanıcısı oluşturulamadı.");
    doctorUserId = doctorUser.id;
    await linkDoctorUserRaw(adminToken, twoPartyDoctor.id, doctorUserId);
    const twoFactor = await setupAndEnableTwoFactorForSelf(doctorUserToken);
    doctorTotpSecret = twoFactor.secret;
  });

  test.afterAll(async () => {
    if (twoPartyDoctor) await deleteAdminDoctorFixture(adminToken, twoPartyDoctor.id).catch(() => undefined);
    if (doctorUserId) await adminUpdateStatus(adminToken, doctorUserId, "SUSPENDED").catch(() => undefined);
  });

  test("madde 14 [GERÇEK LiveKit, iki taraf]: doktor VE hasta aynı odaya bağlanınca KARŞI TARAFIN video'su GERÇEKTEN render edilir (placeholder'da TAKILI KALMAZ)", async ({
    browser,
  }) => {
    test.setTimeout(120_000);

    const { from, to } = defaultSlotRangeISODates(30);
    const slotsRes = await getPublicDoctorSlotsRaw(twoPartyDoctor.slug, from, to);
    const slot = (slotsRes.data ?? []).find((s) => s.available);
    if (!slot) throw new Error("qa-agent: iki taraflı LiveKit testi için müsait slot bulunamadı.");

    const created = await createAppointmentRaw({
      doctorSlug: twoPartyDoctor.slug,
      startsAt: slot.startsAt,
      patientName: "QA E2E Hasta live-two-party",
      patientEmail: `qa-e2e-livekit-two-party-${Date.now()}@example.com`,
    });
    if (created.status !== 201 || !created.data) {
      throw new Error(`qa-agent: randevu oluşturulamadı: ${created.status} ${JSON.stringify(created.error)}`);
    }
    shiftAppointmentIntoJoinWindowDirectly(created.data.id, 90, 30);
    markAppointmentJoinableDirectly(created.data.id);

    const doctorContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await doctorContext.grantPermissions(["camera", "microphone"]);
    const doctorPage = await doctorContext.newPage();

    const patientContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await patientContext.grantPermissions(["camera", "microphone"]);
    const patientPage = await patientContext.newPage();

    try {
      // Doktor — GERÇEK oturum (2FA) ile giriş yapar. Ana host'ta (`/login`) — `/consultation/**`
      // zaten ana host'ta yaşar (bkz. `proxy.ts::isDoctorSharedRouteException`), `doktor.*`
      // subdomain'ine GEREK YOK.
      await doctorPage.goto("/login");
      await doctorPage.getByLabel("E-posta").fill(DOCTOR_EMAIL);
      await doctorPage.getByLabel("Şifre").fill(DOCTOR_PASSWORD);
      await doctorPage.getByRole("button", { name: "Giriş yap" }).click();
      await expect(doctorPage.getByText("İki adımlı doğrulama", { exact: false })).toBeVisible({ timeout: 15_000 });
      await doctorPage.getByLabel("Authenticator Kodu").fill(authenticator.generate(doctorTotpSecret));
      await doctorPage.getByRole("button", { name: "Doğrula" }).click();
      // Doğrulama sonrası nereye yönlendirilirse yönlendirilsin (post-login-destination) — bu
      // testin ilgisi dışında; görüşme sayfasına DOĞRUDAN gidilir.
      await expect(doctorPage.getByText("İki adımlı doğrulama", { exact: false })).toHaveCount(0, { timeout: 15_000 });

      await doctorPage.goto(`/consultation/${created.data.id}`);
      await patientPage.goto(`/consultation/${created.data.id}?t=${created.data.accessToken}`);

      await expect(doctorPage.getByRole("heading", { name: /ile Görüşme$/ })).toBeVisible({ timeout: 15_000 });
      await expect(patientPage.getByRole("heading", { name: /ile Görüşme$/ })).toBeVisible({ timeout: 15_000 });

      await doctorPage.getByRole("button", { name: "Görüşmeye Katıl" }).click();
      await patientPage.getByRole("button", { name: "Görüşmeye Katıl" }).click();

      await expect(doctorPage.getByText("Bağlandı", { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(patientPage.getByText("Bağlandı", { exact: true })).toBeVisible({ timeout: 20_000 });

      // "Bekleme Odası" paneli KARŞI TARAF bağlanınca HER İKİ tarafta da kaybolmalı.
      await expect(doctorPage.getByText("Bekleme Odası")).toHaveCount(0, { timeout: 20_000 });
      await expect(patientPage.getByText("Bekleme Odası")).toHaveCount(0, { timeout: 20_000 });

      // Nihai kanıt — HER İKİ tarafta da (kendi PIP'i + karşı tarafın ana ekranı) TAM OLARAK 2
      // `<video>` elementi var VE HEPSİ GERÇEKTEN kare alıyor (`videoWidth`/`videoHeight` > 0) —
      // sahte cihazın ürettiği kareler DOM'a `attach()` edilmiş, placeholder'da TAKILI KALINMAMIŞ.
      async function assertBothVideosRendering(page: Page): Promise<void> {
        await expect
          .poll(
            () =>
              page.evaluate(() => {
                const videos = Array.from(document.querySelectorAll("video"));
                return {
                  count: videos.length,
                  allRendering: videos.length > 0 && videos.every((v) => v.videoWidth > 0 && v.videoHeight > 0),
                };
              }),
            { timeout: 20_000, intervals: [1_000] }
          )
          .toEqual({ count: 2, allRendering: true });
      }
      await assertBothVideosRendering(doctorPage);
      await assertBothVideosRendering(patientPage);

      // Bug-fix turu (2026-09-18) — "hasta sürekli odadan atılıyor" şikayetinin karşılığı olarak
      // `ConsultationRoomLoaded::handleDisconnected` eklendi (`<LiveKitRoom key={meeting.token}>`
      // ile temiz remount + tek seferlik otomatik yeniden bağlanma). Bu test o mantığı GERÇEK bir
      // zorla-kopma senaryosuyla tetiklemez (LiveKit admin API'sine ihtiyaç duyar, paylaşılan yerel
      // LiveKit konteynerini yeniden başlatmak riskli/yıkıcı olurdu — bkz. final rapor) — burada
      // yalnızca birkaç saniye sonra hastanın HÂLÂ "Bağlandı" durumunda ve HÂLÂ karşı tarafın
      // videosunu render ediyor olduğu doğrulanır (yeni `key` prop'unun GEREKSİZ bir remount/
      // titreşim döngüsüne yol AÇMADIĞININ, önceki assertion'ların tesadüfen yakaladığı anlık bir
      // kareye DEĞİL, kararlı bir bağlantıya işaret ettiğinin kanıtı).
      await patientPage.waitForTimeout(5_000);
      await expect(patientPage.getByText("Bağlandı", { exact: true })).toBeVisible();
      await assertBothVideosRendering(patientPage);
    } finally {
      await doctorContext.close();
      await patientContext.close();
    }
  });

  // qa-agent — bug-fix turu (2026-09-17) doğrulaması, doktor dalının EN RİSKLİ şubesi: subdomain
  // modu AÇIKKEN (bu e2e ortamında `NEXT_PUBLIC_DOCTOR_URL=http://doktor.siteadi.localhost:3100`,
  // bkz. `playwright.config.ts`) VE doktor şu an ana host'tayken (`/consultation/**` `proxy.ts`
  // §`isDoctorSharedRouteException` gereği ana host'ta yaşar, madde 14'teki AYNI giriş deseni)
  // "Görüşmeyi Sonlandır" onayı `window.location.assign(toDoctorOrigin("/doctor"))` ile TAM SAYFA
  // cross-origin geçiş yapmalı — `router.push` (client-side, aynı origin'de KALIR) DEĞİL.
  test("madde 16 [GERÇEK LiveKit, doktor]: subdomain modu AÇIKKEN VE ana host'tayken 'Görüşmeyi Sonlandır' onayı doktoru CROSS-ORIGIN `doktor.*` host'una TAM SAYFA yönlendirir", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    test.skip(!liveKitConfigured, "Bu ortamda LIVEKIT_URL/API_KEY/API_SECRET tanımlı değil.");

    const { from, to } = defaultSlotRangeISODates(30);
    const slotsRes = await getPublicDoctorSlotsRaw(twoPartyDoctor.slug, from, to);
    const slot = (slotsRes.data ?? []).find((s) => s.available);
    if (!slot) throw new Error("qa-agent: madde 16 için müsait slot bulunamadı.");

    const created = await createAppointmentRaw({
      doctorSlug: twoPartyDoctor.slug,
      startsAt: slot.startsAt,
      patientName: "QA E2E Hasta live-doctor-endcall",
      patientEmail: `qa-e2e-livekit-doctor-endcall-${Date.now()}@example.com`,
    });
    if (created.status !== 201 || !created.data) {
      throw new Error(`qa-agent: randevu oluşturulamadı: ${created.status} ${JSON.stringify(created.error)}`);
    }
    shiftAppointmentIntoJoinWindowDirectly(created.data.id, 90, 30);
    markAppointmentJoinableDirectly(created.data.id);

    const doctorContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await doctorContext.grantPermissions(["camera", "microphone"]);
    const doctorPage = await doctorContext.newPage();

    try {
      // Madde 14'teki AYNI doktor giriş deseni — ana host'ta (`doktor.*` subdomain'ine GEREK YOK).
      await doctorPage.goto("/login");
      await doctorPage.getByLabel("E-posta").fill(DOCTOR_EMAIL);
      await doctorPage.getByLabel("Şifre").fill(DOCTOR_PASSWORD);
      await doctorPage.getByRole("button", { name: "Giriş yap" }).click();
      await expect(doctorPage.getByText("İki adımlı doğrulama", { exact: false })).toBeVisible({ timeout: 15_000 });
      await doctorPage.getByLabel("Authenticator Kodu").fill(authenticator.generate(doctorTotpSecret));
      await doctorPage.getByRole("button", { name: "Doğrula" }).click();
      await expect(doctorPage.getByText("İki adımlı doğrulama", { exact: false })).toHaveCount(0, { timeout: 15_000 });

      // qa-agent bulgusu (bu turda keşfedildi) — girişten HEMEN sonra doktor uygulamanın KENDİ
      // post-login yönlendirmesiyle (`login-form.tsx::goToDestination`, subdomain modu AÇIKKEN
      // beklenen/doğru davranış) ZATEN `doktor.siteadi.localhost` host'una TAŞINMIŞ olabilir —
      // bu, test edilen dalın ÖN KOŞULUNU henüz SAĞLAMAZ. `page.goto("/consultation/...")` (relatif
      // yol) `playwright.config.ts::use.baseURL`'e (`http://siteadi.localhost:3100`) göre çözülür
      // (madde 14 başlığındaki AYNI gerekçe — `/consultation/**` zaten ana host'ta yaşar) — yani
      // BU goto'nun KENDİSİ doktoru ana host'a GERİ TAŞIR. Ön koşul burada, goto SONRASI doğrulanır.
      await doctorPage.goto(`/consultation/${created.data.id}`);
      expect(new URL(doctorPage.url()).hostname).toBe("siteadi.localhost");
      await expect(doctorPage.getByRole("heading", { name: /ile Görüşme$/ })).toBeVisible({ timeout: 15_000 });

      await doctorPage.getByRole("button", { name: "Görüşmeye Katıl" }).click();
      await expect(doctorPage.getByText("Bağlandı", { exact: true })).toBeVisible({ timeout: 20_000 });

      await doctorPage.getByRole("button", { name: "Görüşmeyi sonlandır" }).click();
      await expect(doctorPage.getByText("Görüşmeyi sonlandırmak istediğinize emin misiniz?")).toBeVisible();
      await doctorPage.getByRole("button", { name: "Görüşmeyi Sonlandır" }).click();

      // `router.push` İLE DEĞİL — tam sayfa cross-origin geçiş, `doktor.siteadi.localhost` host'una.
      await expect
        .poll(() => doctorPage.url(), { timeout: 15_000 })
        .toMatch(/^http:\/\/doktor\.siteadi\.localhost:3100\/doctor(\/|$|\?)/);
    } finally {
      await doctorContext.close();
    }
  });
});
