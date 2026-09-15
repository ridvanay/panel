import { test, expect } from "@playwright/test";
import { getCachedAdminSession, getFixtureUserToken, getSiteModules, patchSiteModule } from "./support/api";
import {
  ensureTelehealthModuleWithDoctors,
  listAllAdminDoctors,
  createBookingRaw,
  getPublicDoctorSlotsRaw,
  defaultSlotRangeISODates,
  type FixtureDoctor,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — 4-parçalı kritik hata paketi (2026-09-15), madde 2 ("Toplantıya Katıl" görsel durumu)
 * + madde 3 (rezervasyon iptali) canlı doğrulaması. `telehealth-admin-demo-payment-toggle.spec.ts`
 * İLE AYNI desen (misafir magic-link erişimi, `?t=`, hasta LOGIN'i GEREKMEZ) — bu dosya SADECE
 * `JoinMeetingButton`in disabled durumda GÖRSEL OLARAK da soluk göründüğünü (`aria-disabled:opacity-50`
 * fix'i) ve `POST /appointments/bookings/{bookingId}/cancel`in artık `.nullish()` body ile 422
 * ÜRETMEDEN 200 döndüğünü, booking rozetinin sayfa YENİLENMEDEN "Süresi Doldu" (EXPIRED) durumuna
 * geçtiğini ve "Rezervasyonu İptal Et" butonunun kaybolduğunu hedefler.
 *
 * `demoPaymentsSupported=true` gerektiren kısım (aktif/renkli buton regresyonu, katılım penceresi
 * içindeyken) — bu ortamda (`ENABLE_DEMO_PAYMENTS=true`, `docker-compose.dev.yml`) `demo-pay` ucu
 * ile booking'i PAID yapıp `shiftAppointmentIntoJoinWindowDirectly`e GEREK KALMADAN
 * `telehealth-fixtures.ts::markAppointmentJoinableDirectly` ile katılım penceresini açar — bu, PAID
 * dalını (aktif/renkli, opacity ~1) GERÇEK bir demo ödeme + GERÇEK bir DB zaman kaydırmasıyla, iki
 * AYRI kod yolunu birlikte kanıtlar.
 */
test.describe.configure({ mode: "serial" });

const RUN_SUFFIX = Date.now().toString(36);
const PATIENT_EMAIL = `qa-e2e-join-cancel-${RUN_SUFFIX}@example.com`;
const PATIENT_PASSWORD = "QaE2eJoinCancel12345!";
const PATIENT_NAME = `QA Join/Cancel Hasta ${RUN_SUFFIX}`;

let adminToken: string;
let initialTelehealthEnabled: boolean;
let doctorFixture: FixtureDoctor;

// ---- Booking A — madde 2 (görsel disabled durumu + PAID/katılım penceresi aktif durumu). ----
let bookingAId: string;
let bookingAToken: string;

// ---- Booking B — madde 3 (PENDING iptal akışı). ----
let bookingBId: string;
let bookingBToken: string;

async function demoPayBookingRaw(id: string, accessToken: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const { API_BASE_URL } = await import("./support/api");
  const url = new URL(`${API_BASE_URL}/appointments/bookings/${id}/demo-pay`);
  url.searchParams.set("t", accessToken);
  const res = await fetch(url, { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

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
  if (availableSlots.length < 2) throw new Error("qa-agent: join/cancel testi için en az 2 müsait slot gerekli.");

  const createdA = await createBookingRaw(
    { doctorSlug: doctorFixture.slug, slots: [availableSlots[0]!.startsAt], patientName: PATIENT_NAME, patientEmail: PATIENT_EMAIL },
    patientToken
  );
  expect(createdA.status).toBe(201);
  bookingAId = createdA.data!.bookingId;
  bookingAToken = createdA.data!.accessToken;

  const createdB = await createBookingRaw(
    { doctorSlug: doctorFixture.slug, slots: [availableSlots[1]!.startsAt], patientName: PATIENT_NAME, patientEmail: PATIENT_EMAIL },
    patientToken
  );
  expect(createdB.status).toBe(201);
  expect(createdB.data!.paymentStatus).toBe("PENDING");
  bookingBId = createdB.data!.bookingId;
  bookingBToken = createdB.data!.accessToken;
});

test.afterAll(async () => {
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

test("madde 2a: PENDING booking'in detay sayfasında 'Toplantıya Katıl' FONKSİYONEL OLARAK disabled VE GÖRSEL OLARAK da soluk (opacity < 1)", async ({
  page,
}) => {
  await page.goto(`/patient/bookings/${bookingAId}?t=${encodeURIComponent(bookingAToken)}`);
  const joinButton = page.getByRole("button", { name: "Toplantıya Katıl" });
  await expect(joinButton).toBeVisible({ timeout: 15_000 });
  await expect(joinButton).toHaveAttribute("aria-disabled", "true");
  await expect(joinButton).toHaveCSS("pointer-events", "none");

  // qa-agent — ASIL raporlanan şikayetin kök doğrulaması: `aria-disabled:opacity-50` GERÇEKTEN
  // hesaplanmış stile yansımalı (fonksiyonel disabled ile GÖRSEL disabled ARASINDAKİ ayrışmanın
  // kanıtı). `toHaveCSS` tam "0.5" beklemez (Tailwind/tarayıcı yuvarlaması riskine karşı) — < 1
  // olduğunu sayısal olarak doğrular.
  const opacity = await joinButton.evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(opacity, "qa-agent: disabled 'Toplantıya Katıl' butonu GÖRSEL OLARAK soluk DEĞİL (regresyon).").toBeLessThan(1);
  expect(opacity).toBeCloseTo(0.5, 1);
});

test("madde 2b: booking demo ödemeyle PAID olup katılım penceresi açıldıktan SONRA 'Toplantıya Katıl' aktif/tam opak (opacity=1) görünür (regresyon: aktif durum bozulmadı)", async ({
  page,
}) => {
  const paid = await demoPayBookingRaw(bookingAId, bookingAToken);
  expect(paid.status, `qa-agent: demo-pay 200 dönmeli, gövde: ${JSON.stringify(paid.body)}`).toBe(200);

  // `demo-pay` ZATEN booking'i PAID + randevuyu SCHEDULED yapar (`confirmBookingPayment`,
  // `markAppointmentJoinableDirectly`'YE GEREK YOK — bu fonksiyon SADECE ödeme/durum önkoşulunu
  // karşılar, ZAMANLAMAYA dokunmaz). Randevunun `startsAt`i (`defaultSlotRangeISODates(28)` ile
  // seçilen, günler sonrasına ait bir slot) katılım penceresinin İÇİNE alınması için
  // `shiftAppointmentIntoJoinWindowDirectly` GEREKİR (`telehealth-admin-demo-payment-toggle.spec.ts`
  // İLE AYNI ihtiyaç, `patient-portal.spec.ts::bookingUpcoming` İLE AYNI desen).
  const { shiftAppointmentIntoJoinWindowDirectly } = await import("./support/telehealth-fixtures");
  const { data } = paid.body as { data?: { appointments?: { id: string }[] } };
  const appointmentId = data?.appointments?.[0]?.id;
  if (!appointmentId) throw new Error("qa-agent: demo-pay yanıtında appointmentId bulunamadı.");
  shiftAppointmentIntoJoinWindowDirectly(appointmentId, 60, 30);

  await page.goto(`/patient/bookings/${bookingAId}?t=${encodeURIComponent(bookingAToken)}`);
  const joinLink = page.getByRole("link", { name: "Toplantıya Katıl" });
  await expect(joinLink).toBeVisible({ timeout: 15_000 });
  await expect(joinLink).not.toHaveAttribute("aria-disabled", "true");
  const opacity = await joinLink.evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(opacity, "qa-agent: PAID + katılım penceresi açık durumunda buton TAM OPAK olmalı (regresyon).").toBe(1);
});

test("madde 3: PENDING booking → 'Rezervasyonu İptal Et' (confirm onaylanır) → 422 OLMADAN tamamlanır, rozet sayfa YENİLENMEDEN 'Süresi Doldu'ya döner, iptal butonu KAYBOLUR", async ({
  page,
}) => {
  await page.goto(`/patient/bookings/${bookingBId}?t=${encodeURIComponent(bookingBToken)}`);
  const cancelButton = page.getByRole("button", { name: "Rezervasyonu İptal Et" });
  await expect(cancelButton).toBeVisible({ timeout: 15_000 });

  // 422/hata rejeksiyonu doğrulaması — istek YAPILIRKEN yanıt kodunu yakalarız.
  const [cancelResponse] = await Promise.all([
    page.waitForResponse((res) => /\/appointments\/bookings\/[^/]+\/cancel/.test(res.url()) && res.request().method() === "POST"),
    (async () => {
      page.once("dialog", (dialog) => void dialog.accept());
      await cancelButton.click();
    })(),
  ]);
  expect(cancelResponse.status(), "qa-agent: rezervasyon iptali 422/başka bir hata DÖNMEMELİ.").toBe(200);

  // Sayfa YENİLENMEDEN — booking rozeti "Süresi Doldu" (EXPIRED, nötr ton) göstermeli.
  const expiredBadge = page.getByText("Süresi Doldu");
  await expect(expiredBadge).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Rezervasyonu İptal Et" })).toHaveCount(0);
});
