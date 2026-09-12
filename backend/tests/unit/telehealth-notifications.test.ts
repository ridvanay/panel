import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { hashToken } from "../../src/lib/tokens";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7.8/§9.7.10 — notification-agent'ın
 * bildirim tetikleyicisi + `resend-link` iş mantığı. `sendTemplateEmail` gerçek SMTP/DB'ye
 * DOKUNMAMASI için mock'lanır (mail.test.ts/webhook-order.test.ts İLE AYNI desen); `getLocaleSet`
 * de mock'lanır (Locale tablosuna sorgu atmadan varsayılan dili sabitlemek için).
 */
const sendTemplateEmailMock = vi.fn();
vi.mock("../../src/modules/email-templates/email-templates.service", () => ({
  sendTemplateEmail: (...args: unknown[]) => sendTemplateEmailMock(...args),
}));

const getLocaleSetMock = vi.fn();
vi.mock("../../src/lib/localization", () => ({
  getLocaleSet: (...args: unknown[]) => getLocaleSetMock(...args),
}));

import { resendBookingAccessLink, triggerAppointmentConfirmationEmail } from "../../src/modules/telehealth/lib/notifications";

function fakeApp(overrides: {
  doctorTimeZone?: string;
  booking?: unknown;
  appointments?: unknown[];
} = {}) {
  const findUniqueDoctor = vi.fn().mockResolvedValue({ timeZone: overrides.doctorTimeZone ?? "Europe/Istanbul" });
  const findUniqueBooking = vi.fn().mockResolvedValue(overrides.booking ?? null);
  const updateBooking = vi.fn().mockImplementation(({ data }: { data: { accessTokenHash: string } }) => ({
    ...(overrides.booking as Record<string, unknown>),
    accessTokenHash: data.accessTokenHash,
  }));
  const findManyAppointments = vi.fn().mockResolvedValue(overrides.appointments ?? []);

  const app = {
    prisma: {
      doctorProfile: { findUnique: findUniqueDoctor },
      appointmentBooking: { findUnique: findUniqueBooking, update: updateBooking },
      appointment: { findMany: findManyAppointments },
    },
    log: { error: vi.fn() },
  } as unknown as FastifyInstance;

  return { app, findUniqueDoctor, findUniqueBooking, updateBooking, findManyAppointments };
}

const BOOKING = {
  id: "11111111-1111-1111-1111-111111111111",
  doctorId: "22222222-2222-2222-2222-222222222222",
  bookingNumber: "BKG-ABC123-XYZ9",
  patientName: "Ayşe Yılmaz",
  patientEmail: "ayse@example.com",
  totalCents: 75000,
  currency: "TRY",
  paymentStatus: "PAID",
};

describe("modules/telehealth/lib/notifications", () => {
  beforeEach(() => {
    sendTemplateEmailMock.mockReset().mockResolvedValue(undefined);
    getLocaleSetMock.mockReset().mockResolvedValue({ default: { code: "tr" }, enabled: [{ code: "tr" }] });
  });

  describe("triggerAppointmentConfirmationEmail", () => {
    it("APPOINTMENT_CONFIRMATION amacıyla, doktorun saat diliminde biçimlendirilmiş slotlarla gönderir", async () => {
      const { app } = fakeApp({ doctorTimeZone: "Europe/Istanbul" });
      const appointments = [{ startsAt: new Date("2025-01-06T06:00:00.000Z") }, { startsAt: new Date("2025-01-06T06:30:00.000Z") }];

      await triggerAppointmentConfirmationEmail(app, {
        booking: BOOKING as never,
        appointments,
        rawAccessToken: "raw-token-abc",
      });

      expect(sendTemplateEmailMock).toHaveBeenCalledTimes(1);
      const [, purpose, to, values] = sendTemplateEmailMock.mock.calls[0]!;
      expect(purpose).toBe("APPOINTMENT_CONFIRMATION");
      expect(to).toBe("ayse@example.com");
      // Europe/Istanbul (UTC+3) — 06:00Z/06:30Z → 09:00/09:30 duvar saati.
      expect(values.slots_summary).toBe("06.01.2025 09:00, 06.01.2025 09:30");
      expect(values.booking_number).toBe("BKG-ABC123-XYZ9");
      expect(values.patient_name).toBe("Ayşe Yılmaz");
      expect(values.total_formatted).toBe("750.00 TRY");
      expect(values.magic_link).toBe("http://localhost:3000/tr/patient/bookings/11111111-1111-1111-1111-111111111111?t=raw-token-abc");
    });

    it("bağlayıcı sızma yasağı — gönderilen değişken setinde uzmanlık/şikâyet/belge adı YOKTUR", async () => {
      const { app } = fakeApp();
      await triggerAppointmentConfirmationEmail(app, { booking: BOOKING as never, appointments: [], rawAccessToken: "t" });

      const values = sendTemplateEmailMock.mock.calls[0]![3];
      expect(Object.keys(values).sort()).toEqual(
        ["booking_number", "magic_link", "patient_name", "slots_summary", "total_formatted"].sort()
      );
    });

    it("sessiz başarısızlık YOK — sendTemplateEmail reddedilirse hata loglanır, ÇAĞIRAN akış bozulmaz", async () => {
      const { app } = fakeApp();
      sendTemplateEmailMock.mockRejectedValueOnce(new Error("smtp down"));

      await expect(
        triggerAppointmentConfirmationEmail(app, { booking: BOOKING as never, appointments: [], rawAccessToken: "t" })
      ).resolves.toBeUndefined();

      expect(app.log.error).toHaveBeenCalledTimes(1);
      const [logPayload] = (app.log.error as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(logPayload).toMatchObject({ bookingId: BOOKING.id });
    });
  });

  describe("resendBookingAccessLink", () => {
    it("booking bulunamazsa hiçbir şey yapmaz (varlık sızdırılmaz)", async () => {
      const { app, updateBooking } = fakeApp({ booking: null });
      await resendBookingAccessLink(app, "does-not-exist");
      expect(updateBooking).not.toHaveBeenCalled();
      expect(sendTemplateEmailMock).not.toHaveBeenCalled();
    });

    it("booking PAID değilse hiçbir şey yapmaz (ödenmemiş rezervasyon için 'onaylandı' e-postası gönderilmez)", async () => {
      const { app, updateBooking } = fakeApp({ booking: { ...BOOKING, paymentStatus: "PENDING" } });
      await resendBookingAccessLink(app, BOOKING.id);
      expect(updateBooking).not.toHaveBeenCalled();
      expect(sendTemplateEmailMock).not.toHaveBeenCalled();
    });

    it("PAID booking'de YENİ bir token üretir (rotate), hash'ini saklar ve o token ile e-posta gönderir", async () => {
      const { app, updateBooking } = fakeApp({ booking: BOOKING, appointments: [{ startsAt: new Date("2025-01-06T06:00:00.000Z") }] });

      await resendBookingAccessLink(app, BOOKING.id);

      expect(updateBooking).toHaveBeenCalledTimes(1);
      const updateArgs = updateBooking.mock.calls[0]![0] as { where: { id: string }; data: { accessTokenHash: string } };
      expect(updateArgs.where.id).toBe(BOOKING.id);

      expect(sendTemplateEmailMock).toHaveBeenCalledTimes(1);
      const values = sendTemplateEmailMock.mock.calls[0]![3] as { magic_link: string };
      const sentRawToken = new URL(values.magic_link).searchParams.get("t")!;
      // Gönderilen ham token'ın hash'i, DB'ye YAZILAN hash İLE AYNI olmalı (yanlış/eski token
      // gönderilmemeli) — ama ham token'ın KENDİSİ asla response'ta/log'da dönmez (bu test
      // yalnızca iç tutarlılığı doğrular, hiçbir HTTP yanıtı üretmez).
      expect(hashToken(sentRawToken)).toBe(updateArgs.data.accessTokenHash);
    });
  });
});
