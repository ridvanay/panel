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
  type CreatedAppointment,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — `.claude/architect-scope-telehealth-template.md` §10 (QA kapsamı) madde 10/11. Backend'in
 * `tests/unit/telehealth-livekit.test.ts` + `tests/integration/telehealth-livekit.test.ts` ZATEN
 * grant kapsamı/TTL/IDOR/`503`/`409` matrisini `app.inject` seviyesinde (ve gerektiğinde SAHTE
 * `LIVEKIT_*` env değişkenleriyle) kapsıyor — BURADA YENİDEN YAZILMAZ. Bu dosya "gerçek tarayıcı +
 * gerçek backend + `/consultation/[id]` sayfası" zincirini kapatır: randevu bilgileri doğru mu
 * gösteriliyor, geri sayım çalışıyor mu, "yapılandırılmamış" paneli dürüst mü, sahte video YOK mu,
 * `?t=` yetkilendirmesi doğru mu uygulanıyor.
 *
 * Randevular §3.6 gereği HER ZAMAN GERÇEK rezervasyon akışından (`POST /appointments`) geçilerek
 * üretilir — sahte/elle INSERT edilmiş randevu YOKTUR. `shiftAppointmentIntoJoinWindowDirectly()`
 * (bkz. `support/telehealth-fixtures.ts` başlığı) yalnızca GERÇEK bir randevunun ZAMANLAMASINI
 * "şimdi katılınabilir" pencereye kaydırır — randevunun kendisi sahte değildir.
 *
 * `telehealth-template-import.spec.ts`'ten TAMAMEN BAĞIMSIZ çalışır — bkz.
 * `telehealth-public-booking.spec.ts` dosya başlığındaki AYNI gerekçe.
 */
test.describe.configure({ mode: "serial" });

let adminToken: string;
let initialTelehealthEnabled: boolean;
let bookableDoctorSlug: string;
/** Bu e2e ortamında (`backend/.env.e2e`) `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`
 *  tanımlı mı? — aşağıdaki "probe" ile keşfedilir (bkz. `beforeAll`). */
let liveKitConfigured: boolean;

/** `customer-portal-module-toggle.spec.ts`'teki AYNI 60 sn ISR toleransı deseni (`/consultation/*`
 *  de `doctors/layout.tsx` İLE AYNI `isModuleEnabledServer()` — 60 sn önbellekli — guard'ını kullanır,
 *  bkz. `(site)/consultation/layout.tsx`). */
async function gotoAndWaitReady(page: Page, url: string, ready: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await ready();
  }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });
}

/** Her çağrıda GERÇEK rezervasyon akışından (public `POST /appointments`) geçen taze bir randevu üretir. */
async function bookRealAppointment(patientSuffix: string): Promise<CreatedAppointment> {
  const { from, to } = defaultSlotRangeISODates(30);
  const slotsRes = await getPublicDoctorSlotsRaw(bookableDoctorSlug, from, to);
  const slot = (slotsRes.data ?? []).find((s) => s.available);
  if (!slot) throw new Error("Konsültasyon testleri için müsait slot bulunamadı.");
  const res = await createAppointmentRaw({
    doctorSlug: bookableDoctorSlug,
    startsAt: slot.startsAt,
    patientName: `QA E2E Hasta ${patientSuffix}`,
    patientEmail: `qa-e2e-telehealth-consult-${patientSuffix}-${Date.now()}@example.com`,
  });
  if (res.status !== 201 || !res.data) {
    throw new Error(`Randevu oluşturulamadı (${patientSuffix}): ${res.status} ${JSON.stringify(res.error)}`);
  }
  return res.data;
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

  // §4.4 madde 3 sırası — `isLiveKitConfigured()` kontrolü randevu/katılım-penceresi kontrolünden
  // ÖNCE çalışır (bkz. `telehealth.livekit.routes.ts`), bu yüzden VAR OLMAYAN bir randevu id'siyle
  // dahi 503 mü 404 mü döndüğüne bakarak bu ortamda LiveKit'in yapılandırılıp yapılandırılmadığını
  // güvenle keşfedebiliriz (randevu aranmadan ÖNCE 503 kontrolü yapılıyor).
  const probe = await requestMeetingTokenRaw("00000000-0000-0000-0000-000000000000");
  liveKitConfigured = probe.status !== 503;
});

test.afterAll(async () => {
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

test("madde 10: LiveKit yapılandırılmamışken 'yapılandırılmamış' paneli görünür, sahte video YOK, geri sayım çalışır, randevu bilgileri doğru", async ({
  page,
}) => {
  test.setTimeout(90_000);
  test.skip(
    liveKitConfigured,
    "Bu ortamda LiveKit yapılandırılmış (LIVEKIT_URL/API_KEY/API_SECRET dolu) — 'yapılandırılmamış' panel senaryosu bu koşumda tetiklenemez."
  );

  const appointment = await bookRealAppointment("livekit-panel");
  // GERÇEK randevunun ZAMANLAMASI (yalnızca startsAt/endsAt) "şimdi katılınabilir" pencereye
  // kaydırılır — randevunun kendisi §3.6 gereği gerçek rezervasyon akışından geçmiştir.
  shiftAppointmentIntoJoinWindowDirectly(appointment.id, 90, 30);

  await gotoAndWaitReady(page, `/consultation/${appointment.id}?t=${appointment.accessToken}`, async () => {
    await expect(page.getByRole("heading", { name: /ile Görüşme$/ })).toBeVisible();
  });

  // Randevu bilgileri doğru — hasta adı görünür.
  await expect(page.getByText("QA E2E Hasta livekit-panel", { exact: false })).toBeVisible();

  // Geri sayım çalışıyor — MM:SS biçiminde bir etiket GÖRÜNÜR (ya da randevu saati zaten gelmiştir).
  const countdownVisible = page.getByText(/^\d{2}:\d{2}$/);
  const arrivedVisible = page.getByText("Randevu saatiniz geldi.");
  await expect(countdownVisible.or(arrivedVisible)).toBeVisible({ timeout: 15_000 });

  const joinButton = page.getByRole("button", { name: "Görüşmeye Katıl" });
  await expect(joinButton).toBeVisible({ timeout: 15_000 });
  await joinButton.click();

  // §4.4 madde 3 — dürüst durum ekranı, hata sayfası DEĞİL.
  await expect(page.getByRole("heading", { name: "Görüntülü Görüşme Yapılandırılmamış" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("LIVEKIT_URL", { exact: false })).toBeVisible();
  await expect(page.getByText("LIVEKIT_API_KEY", { exact: false })).toBeVisible();
  await expect(page.getByText("LIVEKIT_API_SECRET", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tekrar Dene" })).toBeVisible();

  // Sahte/mock video YASAK ([DTI] §8.2 + mimari §4.4 madde 1) — gerçek LiveKit odası hiç mount
  // edilmedi, sayfada TEK BİR `<video>` elemanı bile YOK.
  await expect(page.locator("video")).toHaveCount(0);
});

test("madde 11a: randevu penceresi (henüz) açılmamışken 'Görüşmeye Katıl' butonu HİÇ gösterilmez, uzak geri sayım cümlesi görünür", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const appointment = await bookRealAppointment("far-future");

  await gotoAndWaitReady(page, `/consultation/${appointment.id}?t=${appointment.accessToken}`, async () => {
    await expect(page.getByRole("heading", { name: /ile Görüşme$/ })).toBeVisible();
  });

  await expect(page.getByText(/Randevunuza .*(saat|dakika).*kaldı\./)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Görüşmeye Katıl" })).toHaveCount(0);
  await expect(page.locator("video")).toHaveCount(0);
});

test("madde 11b: randevu penceresi dışında API'den doğrudan meeting-token isteği → 409 APPOINTMENT_NOT_JOINABLE", async () => {
  test.skip(
    !liveKitConfigured,
    "Bu ortamda LIVEKIT_URL/API_KEY/API_SECRET tanımlı değil (backend/.env.e2e) — " +
      "`telehealth.livekit.routes.ts`'te 'yapılandırılmamış' kontrolü (503) katılım-penceresi " +
      "kontrolünden (409) ÖNCE çalıştığı için bu senaryo bu ortamda tetiklenemiyor. ESKALASYON " +
      "(devops-agent): backend'in kendi `tests/integration/telehealth-livekit.test.ts`'indeki İLE " +
      "AYNI desende — gerçek ağa hiç çıkmayan, yalnızca yerel JWT imzalamak için kullanılan SAHTE " +
      "`LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` değerleri `backend/.env.e2e`'ye eklenirse " +
      "bu test gerçekten çalışır hâle gelir."
  );

  const appointment = await bookRealAppointment("out-of-window");
  // Taze rezervasyon zaten katılım penceresinin (startsAt - 5dk) çok ilerisindedir (rezervasyon
  // tamponu §4.2 en az 2 saat ileri bir slot zorunlu kılar) — ZAMANLAMA hiç DEĞİŞTİRİLMEDEN
  // doğrudan meeting-token istenir.
  const res = await requestMeetingTokenRaw(appointment.id, appointment.accessToken);
  expect(res.status).toBe(409);
  expect(res.error?.code).toBe("APPOINTMENT_NOT_JOINABLE");
});

test("madde 11c: yetkilendirme — `?t=` katılım token'ı OLMADAN erişim reddedilir", async ({ page }) => {
  const appointment = await bookRealAppointment("no-token");

  await gotoAndWaitReady(page, `/consultation/${appointment.id}`, async () => {
    await expect(page.getByText("Randevu bulunamadı.", { exact: false })).toBeVisible({ timeout: 5_000 });
  });
  // IDOR koruması (§8) — randevunun VARLIĞI dahi sızdırılmaz, hasta adı/doktor bilgisi GÖRÜNMEZ.
  await expect(page.getByText("QA E2E Hasta no-token", { exact: false })).toHaveCount(0);
});

test("madde 11d: yetkilendirme — YANLIŞ `?t=` katılım token'ı ile erişim reddedilir", async ({ page }) => {
  const appointment = await bookRealAppointment("wrong-token");

  await gotoAndWaitReady(page, `/consultation/${appointment.id}?t=bu-kesinlikle-yanlis-bir-erisim-tokeni`, async () => {
    await expect(page.getByText("Randevu bulunamadı.", { exact: false })).toBeVisible({ timeout: 5_000 });
  });
  await expect(page.getByText("QA E2E Hasta wrong-token", { exact: false })).toHaveCount(0);
});
