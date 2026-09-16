import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `.claude/architect-scope-support-desk-and-reminders.md` §4.2 madde 10 (bağlayıcı) — sweeper
 * bant sınırları (35/65 ve 5/35 kenarları), claim-first'ün ikinci turda hiç e-posta üretmemesi,
 * çoklu-slot bastırması (90 dk), ödenmemiş booking'in hatırlatma ALMAMASI kapsamı.
 * `tests/unit/contact-retention.test.ts` İLE AYNI mock-prisma deseni.
 */
const triggerAppointmentReminderEmailMock = vi.fn();
vi.mock("../../src/modules/telehealth/lib/notifications", () => ({
  triggerAppointmentReminderEmail: (...args: unknown[]) => triggerAppointmentReminderEmailMock(...args),
}));

import { runAppointmentReminderSweep } from "../../src/lib/appointment-reminders";

function makeAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: "apt-1",
    bookingId: null,
    status: "SCHEDULED",
    startsAt: new Date(),
    doctor: { timeZone: "Europe/Istanbul", title: "Dr.", fullName: "Test Doktor", userId: null },
    booking: null,
    ...overrides,
  };
}

function fakeApp(overrides: {
  findMany?: ReturnType<typeof vi.fn>;
  updateMany?: ReturnType<typeof vi.fn>;
}) {
  return {
    log: { error: vi.fn(), info: vi.fn() },
    prisma: {
      appointment: {
        findMany: overrides.findMany ?? vi.fn().mockResolvedValue([]),
        updateMany: overrides.updateMany ?? vi.fn().mockResolvedValue({ count: 0 }),
      },
    },
  } as unknown as import("fastify").FastifyInstance;
}

describe("runAppointmentReminderSweep", () => {
  beforeEach(() => {
    triggerAppointmentReminderEmailMock.mockReset().mockResolvedValue(true);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("60dk bandı için doğru alt/üst sınırı sorgular ((now+35dk, now+65dk])", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = fakeApp({ findMany });

    await runAppointmentReminderSweep(app);

    const sixtyCall = findMany.mock.calls[0]![0];
    expect(sixtyCall.where.startsAt.gt).toEqual(new Date("2026-01-01T00:35:00.000Z"));
    expect(sixtyCall.where.startsAt.lte).toEqual(new Date("2026-01-01T01:05:00.000Z"));
    expect(sixtyCall.where.reminded60mAt).toBeNull();
  });

  it("30dk bandı için doğru alt/üst sınırı sorgular ((now+5dk, now+35dk])", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = fakeApp({ findMany });

    await runAppointmentReminderSweep(app);

    const thirtyCall = findMany.mock.calls[1]![0];
    expect(thirtyCall.where.startsAt.gt).toEqual(new Date("2026-01-01T00:05:00.000Z"));
    expect(thirtyCall.where.startsAt.lte).toEqual(new Date("2026-01-01T00:35:00.000Z"));
    expect(thirtyCall.where.reminded30mAt).toBeNull();
  });

  it("claim BAŞARILIYSA (count===1) e-posta gönderir ve reminded60m sayacını artırır", async () => {
    const appointment = makeAppointment({ startsAt: new Date("2026-01-01T00:50:00.000Z") });
    const findMany = vi.fn().mockResolvedValueOnce([appointment]).mockResolvedValueOnce([]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const app = fakeApp({ findMany, updateMany });

    const result = await runAppointmentReminderSweep(app);

    expect(result.reminded60m).toBe(1);
    expect(result.failed).toBe(0);
    expect(triggerAppointmentReminderEmailMock).toHaveBeenCalledTimes(1);
    expect(triggerAppointmentReminderEmailMock.mock.calls[0]![1]).toMatchObject({ kind: "60m" });
  });

  it("claim-first — ikinci turda (count===0, zaten damgalanmış) HİÇ e-posta üretilmez", async () => {
    const appointment = makeAppointment({ startsAt: new Date("2026-01-01T00:50:00.000Z") });
    const findMany = vi.fn().mockResolvedValueOnce([appointment]).mockResolvedValueOnce([]);
    // İkinci sweep turunu simüle eder: claim `updateMany` 0 satır etkiler (başka bir turda/instance'ta zaten damgalanmış).
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const app = fakeApp({ findMany, updateMany });

    const result = await runAppointmentReminderSweep(app);

    expect(result.reminded60m).toBe(0);
    expect(triggerAppointmentReminderEmailMock).not.toHaveBeenCalled();
  });

  it("ödenmemiş (PENDING) booking'e bağlı randevu HİÇ hatırlatma almaz", async () => {
    const appointment = makeAppointment({
      startsAt: new Date("2026-01-01T00:50:00.000Z"),
      bookingId: "booking-1",
      booking: { paymentStatus: "PENDING" },
    });
    const findMany = vi.fn().mockResolvedValueOnce([appointment]).mockResolvedValueOnce([]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const app = fakeApp({ findMany, updateMany });

    const result = await runAppointmentReminderSweep(app);

    expect(result.reminded60m).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
    expect(triggerAppointmentReminderEmailMock).not.toHaveBeenCalled();
  });

  it("PAID booking'e bağlı randevu hatırlatma ALIR", async () => {
    const appointment = makeAppointment({
      startsAt: new Date("2026-01-01T00:50:00.000Z"),
      bookingId: "booking-1",
      booking: { paymentStatus: "PAID" },
    });
    // Sıra: 60dk candidates → [appointment], sibling sorgusu (bookingId dolu) → [], 30dk candidates → [].
    const findMany = vi.fn().mockResolvedValue([]).mockResolvedValueOnce([appointment]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const app = fakeApp({ findMany, updateMany });

    const result = await runAppointmentReminderSweep(app);

    expect(result.reminded60m).toBe(1);
    expect(triggerAppointmentReminderEmailMock).toHaveBeenCalledTimes(1);
  });

  it("çoklu slot bastırması — aynı booking'in 90 dk içindeki sonraki slotu damgalanır ama e-posta ALMAZ", async () => {
    const claimedAppointment = makeAppointment({
      id: "apt-1",
      startsAt: new Date("2026-01-01T00:50:00.000Z"),
      bookingId: "booking-1",
      booking: { paymentStatus: "PAID" },
    });
    const sibling = { id: "apt-2" };

    // Sıra: 1) 60dk candidates → [claimedAppointment], 2) sibling sorgusu → [sibling], 3) 30dk candidates → [].
    const findMany = vi.fn().mockResolvedValueOnce([claimedAppointment]).mockResolvedValueOnce([sibling]).mockResolvedValueOnce([]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const app = fakeApp({ findMany, updateMany });

    const result = await runAppointmentReminderSweep(app);

    expect(result.reminded60m).toBe(1);
    // claim (apt-1) + sibling toplu damgalama (apt-2) = 2 `updateMany` çağrısı; yalnızca 1 e-posta.
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(triggerAppointmentReminderEmailMock).toHaveBeenCalledTimes(1);

    const siblingUpdateCall = updateMany.mock.calls[1]![0];
    expect(siblingUpdateCall.where.id).toEqual({ in: ["apt-2"] });
  });

  it("SMTP hatasında `failed` sayacı artar, tur DURMAZ", async () => {
    const appointment = makeAppointment({ startsAt: new Date("2026-01-01T00:50:00.000Z") });
    const findMany = vi.fn().mockResolvedValueOnce([appointment]).mockResolvedValueOnce([]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const app = fakeApp({ findMany, updateMany });
    triggerAppointmentReminderEmailMock.mockResolvedValue(false);

    const result = await runAppointmentReminderSweep(app);

    expect(result.reminded60m).toBe(0);
    expect(result.failed).toBe(1);
  });
});
