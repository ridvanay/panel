import { test, expect } from "@playwright/test";
import { getFixtureUserToken } from "./support/api";
import { createAuthenticatedPageAs } from "./support/admin-session";
import { getPublicDoctorsRaw, getPublicDoctorSlotsRaw, defaultSlotRangeISODates, createBookingRaw } from "./support/telehealth-fixtures";

/**
 * qa-agent — "Tele-Sağlık Vitrini + Ödeme Ekranı Köprüsü" görev talimatı madde 1-2.
 *
 * **BİLİNÇLİ OLARAK farklı ortam** (`telehealth-demo-payment-doctor-counters.spec.ts`/
 * `doctor-panel-session-lifecycle.spec.ts` İLE AYNI felsefe): bu dosya, standart e2e paketinin
 * (`saas_e2e` + backend `localhost:4001` + frontend `localhost:3100`, `playwright.config.ts`'in
 * kendi `webServer`'ı) KULLANDIĞI ortama karşı ÇALIŞMAZ — çünkü madde 1 (vitrin), `telehealth-clinic`
 * demo şablonunun GERÇEKTEN import edilmiş olduğu koordinatörün geliştirme Docker Compose yığınını
 * (`saas_dev`, frontend `localhost:3000`/`siteadi.localhost:3000`, backend `localhost:4000`)
 * gerektirir — boş başlayan `saas_e2e` bu içeriği İÇERMEZ. Madde 2 (Ödemeyi Tamamla köprüsü) aynı
 * ortamı kullanır ki GERÇEKTEN import edilmiş bir demo doktoruna karşı booking oluşturulabilsin
 * (yeni bir fixture doktor İCAT ETMEYE gerek yok — şablon zaten 4 doktor sağlıyor).
 *
 * ÇALIŞTIRMA (host adları `*.siteadi.localhost` tarayıcı tarafından otomatik 127.0.0.1'e çözülür,
 * hosts dosyası GEREKMEZ — `doctor-subdomain-isolation.spec.ts` İLE AYNI gözlem):
 *   cd frontend
 *   E2E_SKIP_WEBSERVER=1 E2E_FRONTEND_URL=http://siteadi.localhost:3000 \
 *   E2E_API_URL=http://localhost:4000/api/v1 \
 *   npx playwright test tests/e2e/telehealth-showcase-and-resume-payment.spec.ts --project=chromium --no-deps
 *
 * `--no-deps` — `auth.setup.ts` `saas_e2e`'ye karşı bir ADMIN fixture login'i dener, bu dosyanın
 * İHTİYACI DEĞİLDİR (yalnızca herkese açık uçlar + kendi ürettiği hasta fixture'ı kullanılır) ve
 * atlanmazsa ayakta olmayan `localhost:4001`'e istek atıp suite'i baştan düşürür.
 *
 * Madde 1'in ADMIN token/fixture GEREKTİRMEMESİ bilinçlidir — vitrin PUBLIC bir sayfadır, kurulum
 * gerektirmeyen salt-okunur bir doğrulamadır. Madde 2, kendi ürettiği taze bir hasta hesabıyla
 * (`POST /auth/register`, gerçek/production hesaplara HİÇ dokunulmaz) `saas_dev`'e GERÇEKTEN yeni
 * bir booking satırı ekler — teardown'da SİLİNMEZ (booking `Appointment.doctor onDelete: Restrict`
 * kısıtına takılabilir VE zaten demo doktoru silme YETKİSİ/isteği bu dosyanın kapsamı DIŞI; taze,
 * benzersiz `RUN_SUFFIX` e-postası sonraki koşumları bozmaz — `telehealth-demo-payment-doctor-
 * counters.spec.ts` başlığındaki AYNI "paylaşımlı DB'de kalıcı biriken fixture satırı" ilkesi).
 */
test.describe.configure({ mode: "serial" });

const RUN_SUFFIX = Date.now().toString(36);
const PATIENT_EMAIL = `qa-e2e-resume-pay-${RUN_SUFFIX}@example.com`;
const PATIENT_PASSWORD = "QaE2eResumePay12345!";
const PATIENT_NAME = `QA Resume Pay Hasta ${RUN_SUFFIX}`;

// =============================================================================
// Madde 1 — Vitrin: ana sayfa (`/`) GERÇEK tele-sağlık içeriği render ediyor, jenerik "SaaS
// Platform" taslağı DEĞİL. Basit DOM/metin doğrulaması (görsel regresyon İCAT EDİLMEDİ).
// =============================================================================
test("madde 1 [vitrin]: ana sayfa (/) hekim/branş CTA'sı ile gerçek tele-sağlık içeriği render eder", async ({ page }) => {
  await page.goto("/");

  // Sayfa başlığı jenerik değil, telehealth-clinic şablonunun GERÇEK marka adını taşır.
  await expect(page).toHaveTitle(/TeleHealth/i, { timeout: 15_000 });

  // "Doktorları Keşfet" CTA'sı /doctors'a giden gerçek bir link — jenerik taslak metni DEĞİL.
  const discoverCta = page.getByRole("link", { name: "Doktorları Keşfet" }).first();
  await expect(discoverCta).toBeVisible({ timeout: 15_000 });
  await expect(discoverCta).toHaveAttribute("href", "/doctors");

  // Branş içeriği (Kardiyoloji vb. `telehealth-clinic.ts::SPECIALTIES`'ten en az biri) sayfada var.
  await expect(page.getByText(/Kardiyoloji|Dermatoloji|Nöroloji|Psikiyatri|Aile Hekimliği|Çocuk Sağlığı/).first()).toBeVisible();
});

// =============================================================================
// Madde 2 — "Ödemeyi Tamamla" köprüsü: gerçek PENDING booking → hasta oturumu → kartta buton →
// tıkla → `/patient/bookings/{id}`'e yönlen → `BookingPaymentStep` GERÇEKTEN render edilir.
// =============================================================================
test("madde 2 [ödemeyi tamamla köprüsü]: PENDING booking hasta portalında görünür, tıklanınca ödeme adımına gider", async ({ browser }) => {
  test.setTimeout(60_000);

  const patientToken = await getFixtureUserToken(PATIENT_EMAIL, PATIENT_PASSWORD, PATIENT_NAME);

  const doctorsRes = await getPublicDoctorsRaw();
  const doctor = (doctorsRes.data ?? [])[0];
  if (!doctor) throw new Error("qa-agent: docker saas_dev üzerinde public /doctors boş döndü — telehealth-clinic import edilmemiş olabilir.");

  const { from, to } = defaultSlotRangeISODates(21);
  const slotsRes = await getPublicDoctorSlotsRaw(doctor.slug, from, to);
  const slot = (slotsRes.data ?? []).find((s) => s.available);
  if (!slot) throw new Error(`qa-agent: ${doctor.slug} için 21 günlük pencerede müsait slot bulunamadı.`);

  const created = await createBookingRaw(
    { doctorSlug: doctor.slug, slots: [slot.startsAt], patientName: PATIENT_NAME, patientEmail: PATIENT_EMAIL },
    patientToken
  );
  expect(created.status, `qa-agent: booking oluşturulamadı: ${JSON.stringify(created.error)}`).toBe(201);
  expect(created.data!.paymentStatus).toBe("PENDING");
  const bookingId = created.data!.bookingId;
  const bookingNumber = created.data!.bookingNumber;

  const { page, close } = await createAuthenticatedPageAs(browser, PATIENT_EMAIL, PATIENT_PASSWORD);
  try {
    await page.goto("/patient/appointments");

    // Kartta "Ödemeyi Tamamla" butonu — `booking-list-view.tsx::BookingActions` aria-label'ı
    // (`${bookingNumber} numaralı rezervasyon için ödemeyi tamamla`) ile bu SPESİFİK booking'i hedefler.
    const payButton = page.getByRole("button", { name: new RegExp(`${bookingNumber} numaralı rezervasyon için ödemeyi tamamla`) });
    await expect(payButton).toBeVisible({ timeout: 20_000 });
    await payButton.click();

    // `/patient/bookings/{id}`'e yönlendi (sekme kapatılıp geri dönme eşdeğeri — farklı bir
    // navigasyondan aynı booking'e erişim).
    await page.waitForURL(new RegExp(`/patient/bookings/${bookingId}$`), { timeout: 15_000 });

    // `BookingPaymentStep` GERÇEKTEN render edildi: "Ödenecek Tutar" + "Ödemeye Geç" butonu (bu
    // docker dev yığınında Stripe yapılandırılmamış olabilir — ama `handlePay()` yalnızca TIKLANINCA
    // `notConfigured`'a düşer; İLK render HER ZAMAN tutar/buton gösterir, backend-agent'ın tasarımı).
    await expect(page.getByText("Ödenecek Tutar")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Ödemeye Geç" })).toBeVisible();
  } finally {
    await close();
  }
});
