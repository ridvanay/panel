import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOOKING_NOTIFICATION_RECIPIENT,
  effectiveBookingNotificationRecipients,
  parseBookingNotificationRecipients,
} from "../../src/lib/booking-notification-recipients";
import { buildBookingNotificationEmail, formatIstanbulStamp, paymentLabel } from "../../src/modules/telehealth/lib/booking-notification-email";
import { bookingEventKey } from "../../src/modules/telehealth/lib/admin-booking-notifications";

describe("booking-notification-recipients", () => {
  it("null -> varsayilan; '' -> bos; dolu -> normalize", () => {
    expect(effectiveBookingNotificationRecipients(null)).toEqual([DEFAULT_BOOKING_NOTIFICATION_RECIPIENT]);
    expect(effectiveBookingNotificationRecipients(undefined)).toEqual([DEFAULT_BOOKING_NOTIFICATION_RECIPIENT]);
    expect(effectiveBookingNotificationRecipients("")).toEqual([]);
    expect(effectiveBookingNotificationRecipients("A@x.com, a@x.com, b@y.org")).toEqual(["a@x.com", "b@y.org"]);
  });

  it("gecersiz adres ve 10'dan fazla adres reddedilir", () => {
    const bad = parseBookingNotificationRecipients("ok@x.com, nope");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.invalid).toEqual(["nope"]);
    expect(parseBookingNotificationRecipients("a@x.com;b@y.com").ok).toBe(false);
    expect(parseBookingNotificationRecipients(Array.from({ length: 11 }, (_, i) => `u${i}@x.com`).join(",")).ok).toBe(false);
    expect(parseBookingNotificationRecipients(Array.from({ length: 10 }, (_, i) => `u${i}@x.com`).join(",")).ok).toBe(true);
    expect(parseBookingNotificationRecipients("  ,  ")).toEqual({ ok: true, list: [] });
  });
});

describe("booking-notification-email", () => {
  const base = {
    bookingId: "11111111-1111-4111-8111-111111111111",
    bookingNumber: "BKG-7",
    doctorName: "Op. Dr. M. Demir",
    slots: [{ startsAt: new Date("2026-11-12T10:30:00Z"), endsAt: new Date("2026-11-12T11:00:00Z") }],
    patientTimeZone: "Europe/Berlin",
    frontendUrl: "https://example.org/",
  };

  it("Istanbul damgasi ve odeme etiketleri", () => {
    expect(formatIstanbulStamp(new Date("2026-11-12T10:30:00Z"))).toBe("2026-11-12 13:30");
    expect(paymentLabel("PAID", "stripe")).toBe("Paid (card)");
    expect(paymentLabel("PAID", "manual")).toBe("Paid (manual)");
    expect(paymentLabel("PAID", "free")).toBe("Free session");
    expect(paymentLabel("PENDING", null)).toBe("Pending");
  });

  it("confirmed: konu, baglanti ve govde alanlari", () => {
    const mail = buildBookingNotificationEmail({ ...base, kind: "confirmed", interpreterLanguage: null, siteLocale: "de", paymentLabel: "Paid (card)" });
    expect(mail.subject).toBe("New appointment #BKG-7 — Op. Dr. M. Demir — 2026-11-12 13:30 (Europe/Istanbul)");
    expect(mail.cta).toEqual({ label: "Open appointment", url: `https://example.org/admin/telehealth/bookings/${base.bookingId}` });
    expect(mail.bodyHtml).toContain("Interpreter:</strong> no");
    expect(mail.bodyHtml).toContain("German (de)");
    expect(mail.bodyHtml).toContain("Duration:</strong> 30 min");
  });

  it("govdedeki degiskenler kacirilir (HTML enjeksiyonu yok)", () => {
    const mail = buildBookingNotificationEmail({ ...base, kind: "cancelled", doctorName: "<script>x</script>" });
    expect(mail.bodyHtml).not.toContain("<script>");
    expect(mail.subject).toBe("Appointment #BKG-7 cancelled");
  });

  it("rescheduled: eski ve yeni saat", () => {
    const mail = buildBookingNotificationEmail({ ...base, kind: "rescheduled", previous: { startsAt: new Date("2026-11-11T10:30:00Z"), endsAt: new Date("2026-11-11T11:00:00Z") } });
    expect(mail.subject).toBe("Appointment #BKG-7 rescheduled");
    expect(mail.bodyHtml).toContain("Previous date and time");
    expect(mail.bodyHtml).toContain("New date and time");
  });

  it("olay anahtarlari", () => {
    const at = new Date("2026-11-12T10:30:00Z");
    expect([
      bookingEventKey({ kind: "confirmed", bookingId: "b1" }),
      bookingEventKey({ kind: "cancelled", bookingId: "b1", appointmentId: "a1" }),
      bookingEventKey({ kind: "cancelled", bookingId: "b1" }),
      bookingEventKey({ kind: "rescheduled", appointmentId: "a1", oldStartsAt: at, oldEndsAt: at, newStartsAt: at }),
    ]).toEqual(["booking:b1:confirmed", "appointment:a1:cancelled", "booking:b1:cancelled", "appointment:a1:rescheduled:2026-11-12T10:30:00.000Z"]);
  });
});
