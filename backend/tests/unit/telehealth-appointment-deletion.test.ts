import { describe, expect, it } from "vitest";
import { getAppointmentDeletionBlockers, type AppointmentDeletionInput } from "../../src/modules/telehealth/lib/appointment-deletion";

/**
 * Paket A1 (2026-10-18) — test randevusu kalıcı silme uygunluğu. Kural bilinçli olarak dardır:
 * ödeme, not, kayıt, sağlık formu/belge veya gerçekleşmiş görüşme varsa silinmez.
 */
function input(overrides: Partial<AppointmentDeletionInput> = {}): AppointmentDeletionInput {
  return { status: "CANCELLED", startedAt: null, consultationNoteCiphertext: null, recording: null, booking: null, ...overrides };
}

function booking(overrides: Partial<NonNullable<AppointmentDeletionInput["booking"]>> = {}): NonNullable<AppointmentDeletionInput["booking"]> {
  return { paymentStatus: "EXPIRED", paidAt: null, paidBy: null, stripePaymentIntentId: null, intake: null, documentCount: 0, ...overrides };
}

const codes = (value: AppointmentDeletionInput) => getAppointmentDeletionBlockers(value).map((b) => b.code);

describe("getAppointmentDeletionBlockers", () => {
  it("ödemesiz, notsuz, kayıtsız iptal edilmiş randevu silinebilir", () => {
    expect(codes(input())).toEqual([]);
    expect(codes(input({ booking: booking() }))).toEqual([]);
  });

  it("başlamamış tamamlanmış randevu silinebilir", () => {
    expect(codes(input({ status: "COMPLETED" }))).toEqual([]);
  });

  it.each(["SCHEDULED", "IN_PROGRESS", "PENDING_PAYMENT", "NO_SHOW"] as const)("%s durumu silinemez", (status) => {
    expect(codes(input({ status }))).toContain("STATUS_NOT_FINAL");
  });

  it.each([
    ["Stripe ödemesi", booking({ paymentStatus: "PAID", paidBy: "stripe", paidAt: new Date() })],
    ["manuel ödeme", booking({ paymentStatus: "PAID", paidBy: "manual", paidAt: new Date() })],
    ["ücretsiz seans (PAID/free)", booking({ paymentStatus: "PAID", paidBy: "free", paidAt: new Date() })],
    ["iade", booking({ paymentStatus: "REFUNDED" })],
    ["başarısız ödeme denemesi", booking({ paymentStatus: "FAILED" })],
    ["PaymentIntent izi", booking({ stripePaymentIntentId: "pi_123" })],
  ])("%s → HAS_PAYMENT", (_label, b) => {
    expect(codes(input({ booking: b }))).toContain("HAS_PAYMENT");
  });

  it("demo ödeme (geliştirme simülatörü) ödeme kaydı sayılmaz", () => {
    expect(codes(input({ booking: booking({ paymentStatus: "PAID", paidBy: "demo", paidAt: new Date() }) }))).toEqual([]);
  });

  it("konsültasyon notu, kayıt, sağlık formu ve belgeler ayrı ayrı engeller", () => {
    expect(codes(input({ consultationNoteCiphertext: "iv:tag:ct" }))).toEqual(["HAS_CONSULTATION_NOTE"]);
    expect(codes(input({ recording: { id: "r1" } }))).toEqual(["HAS_RECORDING"]);
    expect(codes(input({ booking: booking({ intake: { id: "i1" } }) }))).toEqual(["HAS_HEALTH_INTAKE"]);
    expect(codes(input({ booking: booking({ documentCount: 2 }) }))).toEqual(["HAS_DOCUMENTS"]);
  });

  it("gerçekten başlamış tamamlanmış görüşme (demo dışı) tıbbi kayıttır", () => {
    expect(codes(input({ status: "COMPLETED", startedAt: new Date() }))).toEqual(["CONSULTATION_HELD"]);
    expect(codes(input({ status: "COMPLETED", startedAt: new Date(), booking: booking({ paymentStatus: "PAID", paidBy: "demo" }) }))).toEqual([]);
  });

  it("her engelin kullanıcıya gösterilecek Türkçe bir mesajı vardır", () => {
    const blockers = getAppointmentDeletionBlockers(
      input({ status: "SCHEDULED", consultationNoteCiphertext: "x", recording: { id: "r" }, booking: booking({ paymentStatus: "PAID", intake: { id: "i" }, documentCount: 1 }) })
    );
    expect(blockers.length).toBe(6);
    for (const blocker of blockers) expect(blocker.message.length).toBeGreaterThan(10);
  });
});
