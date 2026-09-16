import { describe, expect, it, vi } from "vitest";
import { runSupportRetentionSweep } from "../../src/lib/support-retention";

/**
 * `.claude/compliance-notes-support-desk.md` §3 (bağlayıcı) — üç bağımsız, idempotent kural:
 * 30 gün IP/UA redaksiyonu, 180 gün `CLOSED` kalıcı silme (`closedAt` bazlı), 365 gün asılı kalan
 * oturum güvenlik ağı (`COALESCE(lastMessageAt, createdAt)` bazlı, status'tan bağımsız).
 * `tests/unit/contact-retention.test.ts` İLE AYNI mock-prisma deseni.
 */
function fakeApp(overrides: {
  updateMany?: ReturnType<typeof vi.fn>;
  deleteMany?: ReturnType<typeof vi.fn>;
}) {
  return {
    log: { error: vi.fn() },
    prisma: {
      supportChatSession: {
        updateMany: overrides.updateMany ?? vi.fn().mockResolvedValue({ count: 0 }),
        deleteMany: overrides.deleteMany ?? vi.fn().mockResolvedValue({ count: 0 }),
      },
    },
  } as unknown as import("fastify").FastifyInstance;
}

describe("runSupportRetentionSweep", () => {
  it("30 günden eski oturumlarda ipAddress/userAgent redakte eder", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 4 });
    const app = fakeApp({ updateMany });

    const result = await runSupportRetentionSweep(app);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { ipAddress: null, userAgent: null, piiRedactedAt: expect.any(Date) },
      })
    );
    expect(result.redactedSessions).toBe(4);
  });

  it("CLOSED oturumları closedAt bazlı 180 gün sonra KALICI siler", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const app = fakeApp({ deleteMany });

    const result = await runSupportRetentionSweep(app);

    const closedCall = deleteMany.mock.calls[0]![0];
    expect(closedCall.where.status).toBe("CLOSED");
    expect(closedCall.where.closedAt.lt).toBeInstanceOf(Date);
    expect(result.deletedClosedSessions).toBe(2);
  });

  it("365 günden eski, HİÇ kapatılmamış (PENDING/ANSWERED) oturumları status'tan BAĞIMSIZ siler", async () => {
    const deleteMany = vi.fn().mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 3 });
    const app = fakeApp({ deleteMany });

    const result = await runSupportRetentionSweep(app);

    const hangingCall = deleteMany.mock.calls[1]![0];
    expect(hangingCall.where.status).toEqual({ in: ["PENDING", "ANSWERED"] });
    expect(result.deletedHangingSessions).toBe(3);
  });

  it("üç işlem de bağımsızdır — biri sıfır etkiliyken diğerleri normal çalışır", async () => {
    const app = fakeApp({});
    const result = await runSupportRetentionSweep(app);
    expect(result).toEqual({ redactedSessions: 0, deletedClosedSessions: 0, deletedHangingSessions: 0 });
  });
});
