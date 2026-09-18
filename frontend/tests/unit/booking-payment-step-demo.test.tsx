import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * `.claude/architect-scope-demo-payment-doctor-counters.md` İstek 1 §1.5 (bağlayıcı) —
 * "Demo Ödemeyi Tamamla (Test)" butonu:
 *  1. `NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS` tanımsız/"false" iken HİÇ render EDİLMEZ (görünmez
 *     DEĞİL, DOM'da yoktur) — `DEMO_PAYMENTS_ENABLED` modül-seviyesi statik bir sabit olduğu için
 *     her senaryo `vi.resetModules()` + dinamik `import()` ile TAZE bir modül örneği gerektirir
 *     (bkz. `tests/unit/internal-media-url.test.ts` İLE AYNI desen).
 *  2. `paymentsConfigured` (Stripe yapılandırılmış/yapılandırılmamış) durumundan BAĞIMSIZ görünür.
 *  3. Başarılı `demoPayBooking` sonrası — `onDemoPaid` verilmişse ÇAĞRILIR (yönlendirme YOK);
 *     verilmemişse Stripe `success_url`'i İLE AYNI rotaya (`?payment=success`) `router.push` edilir.
 *  4. Hata (404/409) `friendlyErrorMessage` ile gösterilir, çökme olmaz.
 */
const pushMock = vi.hoisted(() => vi.fn());
const createBookingCheckoutSessionMock = vi.hoisted(() => vi.fn());
const demoPayBookingMock = vi.hoisted(() => vi.fn());
const getPublicSettingsMock = vi.hoisted(() => vi.fn());
// 2026-09-19 (GÖREV 2) — bileşen artık Adım 5'te arka planda `getBooking` ile polling YAPAR
// (bkz. `booking-payment-step.tsx` başındaki yorum); mock'lanmazsa gerçek bir modül fonksiyonu
// OLMADIĞI için `undefined(...)` çağrısı fırlatılır (polling'in KENDİ try/catch'i bunu yutar,
// ama testler bunu ÖRTÜK YERİNE AÇIKÇA kontrol eder) — varsayılan olarak HER ZAMAN `PENDING`
// döner, böylece polling hiçbir testte kendiliğinden `router.push` TETİKLEMEZ.
const getBookingMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/api/telehealth", () => ({
  createBookingCheckoutSession: (...args: unknown[]) => createBookingCheckoutSessionMock(...args),
  demoPayBooking: (...args: unknown[]) => demoPayBookingMock(...args),
  getBooking: (...args: unknown[]) => getBookingMock(...args),
}));

// Bileşen, gösterim koşulunu (§Madde 4) doğrulamak için herkese açık `GET /settings`i
// (`getPublicSettings`) ayrı bir `useEffect` içinde çeker — mock'lanmazsa gerçek `fetch` başarısız
// olur, hata sessizce yutulur ve fail-closed varsayılan (`false`) kalıcı olur, buton HİÇ görünmez.
vi.mock("@/lib/api/settings", () => ({
  getPublicSettings: (...args: unknown[]) => getPublicSettingsMock(...args),
}));

async function renderStep(props: Partial<{ accessToken?: string; onDemoPaid?: (booking: unknown) => void }> = {}) {
  const { BookingPaymentStep } = await import("@/components/site/telehealth/booking-payment-step");
  return render(
    <BookingPaymentStep
      bookingId="booking-1"
      accessToken={props.accessToken}
      totalCents={500000}
      currency="TRY"
      lang="tr"
      onDemoPaid={props.onDemoPaid}
    />
  );
}

describe("BookingPaymentStep — dev-only demo ödeme butonu", () => {
  beforeEach(() => {
    vi.resetModules();
    pushMock.mockReset();
    createBookingCheckoutSessionMock.mockReset();
    demoPayBookingMock.mockReset();
    getPublicSettingsMock.mockReset();
    getPublicSettingsMock.mockResolvedValue({ demoPaymentsEnabled: true });
    getBookingMock.mockReset().mockResolvedValue({ paymentStatus: "PENDING" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS tanımsızken buton HİÇ render EDİLMEZ", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS", "");
    await renderStep();

    expect(screen.getByRole("button", { name: /ödemeye geç/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /demo ödemeyi tamamla/i })).not.toBeInTheDocument();
  });

  it("NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS=\"false\" iken buton HİÇ render EDİLMEZ", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS", "false");
    await renderStep();

    expect(screen.queryByRole("button", { name: /demo ödemeyi tamamla/i })).not.toBeInTheDocument();
  });

  it("NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS=\"true\" iken normal ödeme butonunun YANINDA görünür", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS", "true");
    await renderStep();

    expect(screen.getByRole("button", { name: /ödemeye geç/i })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /demo ödemeyi tamamla/i })).toBeInTheDocument();
    expect(screen.getByText(/yalnızca geliştirme ortamı/i)).toBeInTheDocument();
  });

  it("Stripe yapılandırılmamışken (503) DE demo butonu görünür — paymentsConfigured'a bağlı DEĞİL", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS", "true");
    const { ApiClientError } = await import("@/lib/api/error");
    createBookingCheckoutSessionMock.mockRejectedValue(new ApiClientError(503, { code: "PAYMENTS_NOT_CONFIGURED", message: "Yapılandırılmamış." }));

    await renderStep();
    await userEvent.click(screen.getByRole("button", { name: /ödemeye geç/i }));

    await waitFor(() => expect(screen.getByText(/ödeme altyapısı yapılandırılmamış/i)).toBeInTheDocument());
    expect(await screen.findByRole("button", { name: /demo ödemeyi tamamla/i })).toBeInTheDocument();
  });

  it("demo ödeme başarılı olunca accessToken'ı taşır ve onDemoPaid verilmemişse ?payment=success rotasına yönlendirir", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS", "true");
    demoPayBookingMock.mockResolvedValue({ id: "booking-1", paymentStatus: "PAID" });

    await renderStep({ accessToken: "magic-token-xyz" });
    await userEvent.click(await screen.findByRole("button", { name: /demo ödemeyi tamamla/i }));

    await waitFor(() => expect(demoPayBookingMock).toHaveBeenCalledWith("booking-1", "magic-token-xyz"));
    expect(pushMock).toHaveBeenCalledWith("/tr/patient/bookings/booking-1?payment=success&t=magic-token-xyz");
  });

  it("onDemoPaid verilmişse yönlendirme YAPILMAZ, callback güncel booking ile çağrılır", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS", "true");
    const paidBooking = { id: "booking-1", paymentStatus: "PAID" };
    demoPayBookingMock.mockResolvedValue(paidBooking);
    const onDemoPaid = vi.fn();

    await renderStep({ onDemoPaid });
    await userEvent.click(await screen.findByRole("button", { name: /demo ödemeyi tamamla/i }));

    await waitFor(() => expect(onDemoPaid).toHaveBeenCalledWith(paidBooking));
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("409 (zaten ödenmiş) hatasında friendlyErrorMessage gösterilir, çökme olmaz", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS", "true");
    const { ApiClientError } = await import("@/lib/api/error");
    demoPayBookingMock.mockRejectedValue(new ApiClientError(409, { code: "BOOKING_NOT_PAYABLE", message: "Bu rezervasyon zaten ödenmiş." }));

    await renderStep();
    await userEvent.click(await screen.findByRole("button", { name: /demo ödemeyi tamamla/i }));

    await waitFor(() => expect(screen.getByText(/bu rezervasyon zaten ödenmiş/i)).toBeInTheDocument());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("404 (bayrak backend'de kapalı) hatasında friendlyErrorMessage gösterilir, çökme olmaz", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS", "true");
    const { ApiClientError } = await import("@/lib/api/error");
    demoPayBookingMock.mockRejectedValue(new ApiClientError(404, { code: "NOT_FOUND", message: "Bulunamadı." }));

    await renderStep();
    await userEvent.click(await screen.findByRole("button", { name: /demo ödemeyi tamamla/i }));

    await waitFor(() => expect(screen.getByText(/bulunamadı/i)).toBeInTheDocument());
  });

  describe("Adım 5 arka plan polling'i (GÖREV 2, 2026-09-19)", () => {
    // `use-export-jobs-polling.test.tsx` İLE AYNI BİLİNÇLİ tercih — bu projede
    // `vi.useFakeTimers()` polling koduyla GÜVENİLİR etkileşMEDİĞİ İÇİN GERÇEK zamanlayıcı
    // kullanılır; sabit 4sn'lik polling aralığı testin vitest varsayılan 5sn zaman aşımına
    // (`testTimeout`) ÇOK yakın olduğundan HER üç test'e de AÇIKÇA daha geniş bir zaman aşımı
    // (üçüncü `it(...)` argümanı) verilir — hasta HİÇBİR ŞEY YAPMASA da (ör. admin panelinden
    // "Ödendi İşaretle (Test)" ile ayrı bir sekmede işaretlenirse) bu ekran birkaç saniye içinde
    // KENDİLİĞİNDEN onay/katılım rotasına geçmeli — `handleDemoPay`'in başarı dalıyla BİREBİR
    // AYNI hedef.
    it(
      "polling PAID görürse onDemoPaid verilmemişse ?payment=success rotasına yönlendirir",
      async () => {
        vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS", "false");
        getBookingMock.mockResolvedValue({ id: "booking-1", paymentStatus: "PAID" });

        await renderStep({ accessToken: "magic-token-xyz" });

        await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/tr/patient/bookings/booking-1?payment=success&t=magic-token-xyz"), {
          timeout: 8000,
        });
      },
      10000
    );

    it(
      "polling PAID görürse onDemoPaid verilmişse yönlendirme YAPILMAZ, callback güncel booking ile çağrılır",
      async () => {
        vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS", "false");
        const paidBooking = { id: "booking-1", paymentStatus: "PAID" };
        getBookingMock.mockResolvedValue(paidBooking);
        const onDemoPaid = vi.fn();

        await renderStep({ onDemoPaid });

        await waitFor(() => expect(onDemoPaid).toHaveBeenCalledWith(paidBooking), { timeout: 8000 });
        expect(pushMock).not.toHaveBeenCalled();
      },
      10000
    );

    it(
      "polling PENDING gördüğü sürece hiçbir yönlendirme TETİKLEMEZ",
      async () => {
        vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS", "false");
        getBookingMock.mockResolvedValue({ id: "booking-1", paymentStatus: "PENDING" });

        await renderStep();
        // İlk poll denemesinin (4sn) ne "geç kaldığını" ne de gereksiz yere UZUN sürdüğünü
        // doğrulamak için TAM O anın hemen SONRASINA kadar bekler — bu süre boyunca pushMock
        // ÇAĞRILMAMALIDIR (PENDING durumu yönlendirme tetiklemez).
        await new Promise((resolve) => setTimeout(resolve, 4500));

        expect(pushMock).not.toHaveBeenCalled();
      },
      8000
    );
  });
});
