import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession, getSiteModules, patchSiteModule } from "./support/api";
import {
  ensureTelehealthModuleWithDoctors,
  createAdminDoctorFixture,
  deleteAdminDoctorFixture,
  setDoctorAvailabilityRaw,
  getPublicDoctorSlotsRaw,
  defaultSlotRangeISODates,
  type CreatedFixtureDoctor,
} from "./support/telehealth-fixtures";
import { submitBookingIdentityStep } from "./support/telehealth-identity-ui";

/**
 * qa-agent — 2026-09-18 kullanıcı talebi: "Randevu alma sihirbazında kullanıcı slot seçip sonraki
 * adıma geçtiğinde rezervasyon ön-kilitleme (hold) mekanizması saati direkt 'Dolu' durumuna
 * getiriyor. Sayfa yenilendiğinde veya akış terk edildiğinde ödeme tamamlanmadığı halde ilgili
 * slot ... 'Dolu' görünüyor."
 *
 * Kök neden analizi (bu turda yapıldı) — backend'de ZATEN eksiksiz bir çözüm vardı:
 * `POST /appointments/bookings/{id}/cancel`, booking `PENDING` iken randevu satırlarını ANINDA
 * siler (`telehealth.routes.ts`), 5dk'lık süpürücüyü (`booking-expiry.ts`) BEKLEMEZ. Eksik olan,
 * `booking-wizard.tsx`'in bu ucu HİÇ ÇAĞIRMAMASIYDI. Düzeltme SADECE frontend'de: booking
 * oluşturulduktan (Adım 4) SONRA ödeme BAŞLAMADAN akış terk edilirse (SPA-içi unmount → normal
 * `cancelBooking()` fetch'i; gerçek sayfa kapanışı/F5 → `pagehide`da `navigator.sendBeacon`)
 * booking otomatik iptal edilir — bkz. `booking-wizard.tsx` dosya başı yorumu.
 *
 * `telehealth-booking-wizard.spec.ts` İLE AYNI izole fixture doktoru + "önce/sonra KÜME FARKI al"
 * deseni (paylaşımlı `telehealth-clinic` demo verisine BAĞIMLI DEĞİL, bkz. `telehealth-
 * fixtures.ts` dosya başı yorumu) — o dosyanın kapsamı (adım geçişleri/stepper) BURADA TEKRAR
 * EDİLMEZ, yalnızca terk-etme/slot-serbest-bırakma senaryosu test edilir.
 */
const RUN_SUFFIX = Date.now().toString(36);

let adminToken: string;
let initialTelehealthEnabled: boolean;
let doctorFixture: CreatedFixtureDoctor;

/** `telehealth-booking-wizard.spec.ts::selectAnyAvailableSlot` İLE AYNI (paylaşımlı DEĞİL — bkz.
 * o dosyanın "YENİDEN İCAT EDİLMEDİ, ÖRNEK ALINDI" notu, bu suite'in kendi kuralı). */
async function selectAnyAvailableSlot(page: Page): Promise<void> {
  let checkbox = page.getByRole("checkbox", { name: /— müsait$/ }).first();
  if (await checkbox.isVisible().catch(() => false)) {
    await checkbox.click();
    return;
  }
  const availableDays = page.getByRole("button", { name: /— müsait/ });
  const count = await availableDays.count();
  for (let i = 0; i < count; i++) {
    await availableDays.nth(i).click();
    checkbox = page.getByRole("checkbox", { name: /— müsait$/ }).first();
    if (await checkbox.isVisible().catch(() => false)) {
      await checkbox.click();
      return;
    }
  }
  throw new Error("qa-agent: Takvimde görünür hiçbir günde müsait bir saat slotu bulunamadı.");
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);

  doctorFixture = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `QA E2E Terk Edilen Rezervasyon Doktoru ${RUN_SUFFIX}`,
    bio: "qa-agent — ödeme öncesi terk edilen rezervasyonun slotu anında serbest bırakması e2e fixture doktoru.",
    languages: ["tr"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: 35000,
    currency: "TRY",
    isVerified: true,
    isActive: true,
  });
  await setDoctorAvailabilityRaw(
    adminToken,
    doctorFixture.id,
    ([1, 2, 3, 4, 5, 6, 7] as const).map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }))
  );
});

test.afterAll(async () => {
  if (doctorFixture) await deleteAdminDoctorFixture(adminToken, doctorFixture.id).catch(() => undefined);
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

test("Adım 4'e geçip ödeme tamamlanmadan sayfa terk edilirse (yenileme) slot ANINDA tekrar müsait olur", async ({ page }) => {
  test.setTimeout(120_000);

  const { from, to } = defaultSlotRangeISODates(14);
  const slotsBefore = await getPublicDoctorSlotsRaw(doctorFixture.slug, from, to);
  const availableBefore = new Set((slotsBefore.data ?? []).filter((s) => s.available).map((s) => s.startsAt));
  expect(availableBefore.size).toBeGreaterThan(0);

  await page.goto(`/doctors/${doctorFixture.slug}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Müsaitlik ve Randevu" })).toBeVisible();

  await selectAnyAvailableSlot(page);
  const continueButton = page.getByRole("button", { name: "Devam Et" }).first();
  await expect(continueButton).toBeEnabled();
  await continueButton.click();

  await submitBookingIdentityStep(page, { patientEmail: `qa-e2e-abandon-${RUN_SUFFIX}@example.com` });
  await expect(page.getByText("Rezervasyonunuz oluşturuldu", { exact: false })).toBeVisible({ timeout: 15_000 });

  // Booking oluştu (Adım 4) — hold aktif. "Önce/sonra küme farkı" (bkz. dosya başı yorumu):
  // seçilen slot ARTIK `availableBefore` kümesinde olsa da doluluk listesinden düşmüş olmalı.
  const slotsDuringHold = await getPublicDoctorSlotsRaw(doctorFixture.slug, from, to);
  const availableDuringHold = new Set((slotsDuringHold.data ?? []).filter((s) => s.available).map((s) => s.startsAt));
  const heldSlots = [...availableBefore].filter((s) => !availableDuringHold.has(s));
  expect(heldSlots.length).toBe(1);
  const heldSlot = heldSlots[0]!;

  // Ödeme adımına HİÇ gelmeden sayfa yenilenir (F5) — `pagehide`da `navigator.sendBeacon` ile
  // booking'i iptal eden istek tetiklenmeli.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Müsaitlik ve Randevu" })).toBeVisible();

  // Beacon teslimatı/backend işlemesi ile bu sayfanın ilk render'ı arasında küçük bir yarış payı
  // OLABİLİR (gerçek tarayıcı davranışı — `sendBeacon` teslimatı GARANTİLİDİR ama "bir SONRAKİ
  // sayfa yüklemesinden ÖNCE bitmiş olması" GARANTİ DEĞİLDİR); bu yüzden `toPass` ile kısa bir
  // yeniden-deneme penceresi kullanılır (`telehealth-public-booking.spec.ts::gotoAndWaitReady`
  // İLE AYNI ilke).
  await expect(async () => {
    const slotsAfter = await getPublicDoctorSlotsRaw(doctorFixture.slug, from, to);
    const releasedSlot = (slotsAfter.data ?? []).find((s) => s.startsAt === heldSlot);
    expect(releasedSlot?.available).toBe(true);
  }).toPass({ timeout: 15_000, intervals: [500, 1_000, 2_000] });
});
