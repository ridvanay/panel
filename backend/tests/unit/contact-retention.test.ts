import { describe, expect, it, vi } from "vitest";
import { runContactRetentionSweep } from "../../src/lib/contact-retention";

function fakeApp(overrides: {
  updateMany?: ReturnType<typeof vi.fn>;
  findUnique?: ReturnType<typeof vi.fn>;
  deleteMany?: ReturnType<typeof vi.fn>;
}) {
  return {
    log: { error: vi.fn() },
    prisma: {
      contactSubmission: {
        updateMany: overrides.updateMany ?? vi.fn().mockResolvedValue({ count: 0 }),
        deleteMany: overrides.deleteMany ?? vi.fn().mockResolvedValue({ count: 0 }),
      },
      contactForm: {
        findUnique: overrides.findUnique ?? vi.fn().mockResolvedValue({ retentionDays: 180 }),
      },
    },
  } as unknown as import("fastify").FastifyInstance;
}

describe("runContactRetentionSweep", () => {
  it("redacts PII (ipAddress/userAgent) on submissions older than 30 days", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const app = fakeApp({ updateMany });

    const result = await runContactRetentionSweep(app);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { ipAddress: null, userAgent: null, piiRedactedAt: expect.any(Date) },
      })
    );
    expect(result.redactedSubmissions).toBe(3);
  });

  it("permanently deletes submissions older than ContactForm.retentionDays when retentionDays > 0", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 5 });
    const app = fakeApp({ findUnique: vi.fn().mockResolvedValue({ retentionDays: 30 }), deleteMany });

    const result = await runContactRetentionSweep(app);

    expect(deleteMany).toHaveBeenCalled();
    expect(result.deletedSubmissions).toBe(5);
  });

  it("does NOT delete anything when retentionDays = 0 (indefinite retention, compliance-agent approved exception)", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const app = fakeApp({ findUnique: vi.fn().mockResolvedValue({ retentionDays: 0 }), deleteMany });

    const result = await runContactRetentionSweep(app);

    expect(deleteMany).not.toHaveBeenCalled();
    expect(result.deletedSubmissions).toBe(0);
  });

  it("does not throw when the ContactForm singleton row does not exist yet", async () => {
    const app = fakeApp({ findUnique: vi.fn().mockResolvedValue(null) });
    await expect(runContactRetentionSweep(app)).resolves.toBeDefined();
  });
});
