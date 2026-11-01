import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/** Paket AF — kayıt bileşenlerinin metinleri `consultation` sözlüğünde (yalnızca metin; davranış aynı). */
let localeCode = "tr";
vi.mock("@/context/locale-alternates-context", () => ({ useActiveLocaleCode: () => localeCode }));
vi.mock("@/lib/api/telehealth", () => ({ submitRecordingConsent: vi.fn(), startRecording: vi.fn(), stopRecording: vi.fn() }));

import { RecordingIndicator } from "@/components/site/telehealth/recording-indicator";
import { RecordingConsentDialog } from "@/components/site/telehealth/recording-consent-dialog";
import { RecordingControls } from "@/components/site/telehealth/recording-controls";

/** Compliance kararıyla bağlı TR rıza metni — AYNEN korunmalı. */
const TR_CONSENT =
  "Doktorunuz bu görüşmeyi kaydetmek istiyor. Kayıt sunucuda AES-256 ile şifrelenerek saklanır, 30 gün sonra otomatik silinir ve yalnızca siz, doktorunuz ve sistem yöneticisi erişebilir. Reddetme hakkınız vardır; reddetmeniz görüşmeyi etkilemez.";

afterEach(() => {
  cleanup();
  localeCode = "tr";
});

const inFuture = () => new Date(Date.now() + 30_000).toISOString();

describe("kayıt bileşenleri metinleri", () => {
  it("TR: mevcut Türkçe metinler birebir aynı (rıza metni dahil)", () => {
    render(<RecordingIndicator status="RECORDING" />);
    expect(screen.getByText("Bu görüşme kaydediliyor")).toBeInTheDocument();
    cleanup();
    render(<RecordingConsentDialog open appointmentId="a1" consentExpiresAt={inFuture()} onResolved={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText("Görüşme Kaydı İzni")).toBeInTheDocument();
    expect(screen.getByText(TR_CONSENT)).toBeInTheDocument();
    expect(screen.getByText(/^\d+sn içinde otomatik olarak kapanacak$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reddediyorum" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kabul Ediyorum" })).toBeInTheDocument();
    cleanup();
    render(<RecordingControls appointmentId="a1" recording={null} onUpdate={() => {}} />);
    expect(screen.getByRole("button", { name: /Kaydı Başlat/ })).toBeInTheDocument();
  });

  it("AR: izleyicinin dilinde; Türkçe metin kalmaz", () => {
    localeCode = "ar";
    render(<RecordingIndicator status="RECORDING" />);
    expect(screen.getByText("يتم تسجيل هذه الاستشارة")).toBeInTheDocument();
    cleanup();
    render(<RecordingConsentDialog open appointmentId="a1" consentExpiresAt={inFuture()} onResolved={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText("الموافقة على تسجيل الاستشارة")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "أوافق" })).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/[çğışü]/);
    cleanup();
    render(
      <RecordingControls
        appointmentId="a1"
        recording={{ status: "PENDING_CONSENT" } as unknown as Parameters<typeof RecordingControls>[0]["recording"]}
        onUpdate={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: /بانتظار موافقة المريض/ })).toBeInTheDocument();
  });

  it("kayıt yokken gösterge çizilmez (davranış aynı)", () => {
    const { container } = render(<RecordingIndicator status={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
