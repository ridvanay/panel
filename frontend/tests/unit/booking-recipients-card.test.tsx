import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BookingRecipientsCard } from "@/components/admin/settings/booking-recipients-card";
import { validateBookingRecipients } from "@/lib/booking-notification-recipients";

/** Paket AG (İş 2) — Admin → Ayarlar "Randevu bildirimi alıcıları" alanı. */
describe("validateBookingRecipients", () => {
  it("normalize eder: trim, küçük harf, tekrarsız, boşları atar", () => {
    expect(validateBookingRecipients(" A@x.com, a@x.com ,, b@y.org ")).toEqual({ ok: true, list: ["a@x.com", "b@y.org"] });
    expect(validateBookingRecipients("")).toEqual({ ok: true, list: [] });
  });

  it("geçersiz adres ve 10 adetten fazla adres hata verir", () => {
    const bad = validateBookingRecipients("ok@x.com, bozuk");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain("bozuk");
    expect(validateBookingRecipients("a@x.com;b@y.com").ok).toBe(false);
    expect(validateBookingRecipients(Array.from({ length: 11 }, (_, i) => `u${i}@x.com`).join(",")).ok).toBe(false);
    expect(validateBookingRecipients(Array.from({ length: 10 }, (_, i) => `u${i}@x.com`).join(",")).ok).toBe(true);
  });
});

describe("BookingRecipientsCard", () => {
  it("varsayılan kullanılırken ipucu ve placeholder gösterir, 'Varsayılana dön' düğmesi yoktur", () => {
    render(<BookingRecipientsCard useDefault value="" onChange={vi.fn()} onResetToDefault={vi.fn()} />);
    const input = screen.getByLabelText("Alıcı e-posta adresleri");
    expect(input).toHaveAttribute("placeholder", "Varsayılan: admin@wmhealthistanbul.com");
    expect(screen.getByTestId("booking-recipients-default-note")).toHaveTextContent("admin@wmhealthistanbul.com");
    expect(screen.getByText("Virgülle ayırın. Boş bırakılırsa bildirim gönderilmez.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Varsayılana dön" })).not.toBeInTheDocument();
  });

  it("yazınca onChange çağrılır", () => {
    const onChange = vi.fn();
    render(<BookingRecipientsCard useDefault value="" onChange={onChange} onResetToDefault={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Alıcı e-posta adresleri"), { target: { value: "a@x.com" } });
    expect(onChange).toHaveBeenCalledWith("a@x.com");
  });

  it("özel mod + boş alan: 'bildirim gönderilmeyecek' uyarısı; 'Varsayılana dön' çalışır", () => {
    const onReset = vi.fn();
    render(<BookingRecipientsCard useDefault={false} value="" onChange={vi.fn()} onResetToDefault={onReset} />);
    expect(screen.getByTestId("booking-recipients-empty-note")).toHaveTextContent("randevu bildirimi gönderilmeyecek");
    fireEvent.click(screen.getByRole("button", { name: "Varsayılana dön" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("dolu özel değerde boş-alan uyarısı yoktur; hata mesajı alanda gösterilir", () => {
    render(<BookingRecipientsCard useDefault={false} value="a@x.com" error="Geçersiz e-posta adresi: x" onChange={vi.fn()} onResetToDefault={vi.fn()} />);
    expect(screen.queryByTestId("booking-recipients-empty-note")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Geçersiz e-posta adresi: x");
  });
});
