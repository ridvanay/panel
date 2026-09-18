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
const buildEmailRenderContextMock = vi.fn();
vi.mock("../../src/modules/email-templates/email-templates.service", () => ({
  sendTemplateEmail: (...args: unknown[]) => sendTemplateEmailMock(...args),
  buildEmailRenderContext: (...args: unknown[]) => buildEmailRenderContextMock(...args),
}));

const getLocaleSetMock = vi.fn();
vi.mock("../../src/lib/localization", () => ({
  getLocaleSet: (...args: unknown[]) => getLocaleSetMock(...args),
}));

// 2026-09-19 — `NotFoundError` (DB'de aktif APPOINTMENT_CONFIRMATION şablonu YOK) dalında
// `triggerAppointmentConfirmationEmail`'in koda gömülü yedeğe düşüp `sendMail`'i DOĞRUDAN
// çağırdığını doğrulamak için ayrıca mock'lanır (mail.test.ts İLE AYNI desen).
const sendMailMock = vi.fn();
vi.mock("../../src/lib/mail", () => ({
  sendMail: (...args: unknown[]) => sendMailMock(...args),
}));

import { NotFoundError } from "../../src/lib/errors";
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

const KNOWN_RAW_TOKEN = "known-raw-token-xyz";

const BOOKING = {
  id: "11111111-1111-1111-1111-111111111111",
  doctorId: "22222222-2222-2222-2222-222222222222",
  bookingNumber: "BKG-ABC123-XYZ9",
  patientName: "Ayşe Yılmaz",
  patientEmail: "ayse@example.com",
  totalCents: 75000,
  currency: "TRY",
  paymentStatus: "PAID",
  accessTokenHash: hashToken(KNOWN_RAW_TOKEN),
};

describe("modules/telehealth/lib/notifications", () => {
  beforeEach(() => {
    sendTemplateEmailMock.mockReset().mockResolvedValue(undefined);
    getLocaleSetMock.mockReset().mockResolvedValue({ default: { code: "tr" }, enabled: [{ code: "tr" }] });
    buildEmailRenderContextMock.mockReset().mockResolvedValue({
      siteName: "Global TeleHealth",
      siteUrl: "http://localhost:3000",
      logoUrl: null,
      legalPages: [],
    });
    sendMailMock.mockReset().mockResolvedValue({ messageId: "fake" });
  });

  describe("triggerAppointmentConfirmationEmail", () => {
    it("APPOINTMENT_CONFIRMATION amacıyla, doktorun saat diliminde biçimlendirilmiş slotlarla gönderir", async () => {
      const { app } = fakeApp({ doctorTimeZone: "Europe/Istanbul" });
      const appointments = [
        { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", startsAt: new Date("2025-01-06T06:00:00.000Z") },
        { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", startsAt: new Date("2025-01-06T06:30:00.000Z") },
      ];

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
      // 2026-09-18 (kullanıcı talebi) — DOĞRUDAN görüşme odasına giden bağlantı, EN ERKEN
      // randevuya (appointments[0], `firstAppointment`) işaret eder — `JoinMeetingButton` İLE
      // AYNI seçim kuralı.
      expect(values.join_link).toBe("http://localhost:3000/tr/consultation/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa?t=raw-token-abc");
    });

    it("appointments boşsa join_link ATLANIR (literal {{join_link}} basılmaz, anahtar hiç gönderilmez)", async () => {
      const { app } = fakeApp();
      await triggerAppointmentConfirmationEmail(app, { booking: BOOKING as never, appointments: [], rawAccessToken: "t" });

      const values = sendTemplateEmailMock.mock.calls[0]![3];
      expect(values).not.toHaveProperty("join_link");
    });

    it("bağlayıcı sızma yasağı — gönderilen değişken setinde uzmanlık/şikâyet/belge adı YOKTUR", async () => {
      const { app } = fakeApp();
      const appointments = [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", startsAt: new Date("2025-01-06T06:00:00.000Z") }];
      await triggerAppointmentConfirmationEmail(app, { booking: BOOKING as never, appointments, rawAccessToken: "t" });

      const values = sendTemplateEmailMock.mock.calls[0]![3];
      expect(Object.keys(values).sort()).toEqual(
        ["booking_number", "join_link", "magic_link", "patient_name", "slots_summary", "total_formatted"].sort()
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

    // 2026-09-19 (kullanıcı talebi) — DB'de aktif APPOINTMENT_CONFIRMATION şablonu YOKSA (canlı
    // bulgusu: "Aktif e-posta şablonu bulunamadı") ödenmiş bir randevunun onay e-postası + görüşme
    // linki SESSİZCE kaybolmamalı — koda gömülü yedek şablonla `sendMail` DOĞRUDAN çağrılır, AYRICA
    // hata loglanır (asıl DB satırı hâlâ eksik sayılmalı, ops fark etmeli).
    it("APPOINTMENT_CONFIRMATION şablonu bulunamazsa (NotFoundError) koda gömülü yedek şablonla sendMail DOĞRUDAN çağrılır VE hata loglanır", async () => {
      const { app } = fakeApp();
      sendTemplateEmailMock.mockRejectedValueOnce(new NotFoundError("Aktif e-posta şablonu bulunamadı (amaç: APPOINTMENT_CONFIRMATION)."));
      const appointments = [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", startsAt: new Date("2025-01-06T06:00:00.000Z") }];

      await expect(
        triggerAppointmentConfirmationEmail(app, { booking: BOOKING as never, appointments, rawAccessToken: "raw-token-abc" })
      ).resolves.toBeUndefined();

      expect(sendMailMock).toHaveBeenCalledTimes(1);
      const [, mailInput] = sendMailMock.mock.calls[0]! as [unknown, { to: string; subject: string; html: string }];
      expect(mailInput.to).toBe("ayse@example.com");
      expect(mailInput.subject).toBe("Your appointment is confirmed");
      expect(mailInput.html).toContain("BKG-ABC123-XYZ9");
      expect(mailInput.html).toContain("Ayşe Yılmaz");
      expect(mailInput.html).toContain("http://localhost:3000/tr/consultation/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa?t=raw-token-abc");
      // Sağlık verisi/uzmanlık/şikâyet notu YOK — bağlayıcı sızma yasağı yedek şablonda da geçerli.
      expect(mailInput.html).not.toMatch(/specialt|complaint|diagnos/i);

      // Fallback BAŞARILI olsa da DB satırının eksikliği loglanmalı — sessiz DEĞİL.
      expect(app.log.error).toHaveBeenCalledTimes(1);
      const [logPayload] = (app.log.error as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(logPayload).toMatchObject({ bookingId: BOOKING.id });
    });

    it("sendTemplateEmail BAŞKA bir hatayla (NotFoundError DIŞINDA) reddedilirse yedek şablon DENENMEZ — mevcut best-effort davranışı korunur", async () => {
      const { app } = fakeApp();
      sendTemplateEmailMock.mockRejectedValueOnce(new Error("smtp down"));

      await expect(
        triggerAppointmentConfirmationEmail(app, { booking: BOOKING as never, appointments: [], rawAccessToken: "t" })
      ).resolves.toBeUndefined();

      expect(sendMailMock).not.toHaveBeenCalled();
      expect(app.log.error).toHaveBeenCalledTimes(1);
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
      const appointments = [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", startsAt: new Date("2025-01-06T06:00:00.000Z") }];
      const { app, updateBooking } = fakeApp({ booking: BOOKING, appointments });

      await resendBookingAccessLink(app, BOOKING.id);

      expect(updateBooking).toHaveBeenCalledTimes(1);
      const updateArgs = updateBooking.mock.calls[0]![0] as { where: { id: string }; data: { accessTokenHash: string } };
      expect(updateArgs.where.id).toBe(BOOKING.id);

      expect(sendTemplateEmailMock).toHaveBeenCalledTimes(1);
      const [, purpose, , values] = sendTemplateEmailMock.mock.calls[0]! as [unknown, unknown, unknown, { magic_link: string }];
      expect(purpose).toBe("APPOINTMENT_CONFIRMATION");
      const sentRawToken = new URL(values.magic_link).searchParams.get("t")!;
      // Gönderilen ham token'ın hash'i, DB'ye YAZILAN hash İLE AYNI olmalı (yanlış/eski token
      // gönderilmemeli) — ama ham token'ın KENDİSİ asla response'ta/log'da dönmez (bu test
      // yalnızca iç tutarlılığı doğrular, hiçbir HTTP yanıtı üretmez).
      expect(hashToken(sentRawToken)).toBe(updateArgs.data.accessTokenHash);
    });

    // 2026-09-18 KRİTİK DÜZELTME (kullanıcı talebi) — booking `PAID` değilken bu fonksiyon
    // KESİNLİKLE hiçbir e-posta göndermez, hiçbir koşulda (token verilse/geçerli olsa bile) —
    // ödeme tamamlanmadan/randevu kesinleşmeden HİÇBİR bildirim gitmemelidir.
    it("PENDING booking'de hiçbir şey yapmaz — token DOĞRU olsa bile e-posta gönderilmez", async () => {
      const { app, updateBooking } = fakeApp({ booking: { ...BOOKING, paymentStatus: "PENDING" } });
      await resendBookingAccessLink(app, BOOKING.id);
      expect(updateBooking).not.toHaveBeenCalled();
      expect(sendTemplateEmailMock).not.toHaveBeenCalled();
    });
  });
});
