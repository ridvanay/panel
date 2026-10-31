import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Paket U (C1) — doktor adının kısaltılmış gösterimi: kural örnekleri (görev dosyası), `publicName`
 * elle düzeltmesi, DTO'larda ziyaretçi/admin ayrımı ve hastaya giden hatırlatma e-postası.
 */
const sendTemplateEmailMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../src/modules/email-templates/email-templates.service", () => ({
  sendTemplateEmail: sendTemplateEmailMock,
  buildEmailRenderContext: vi.fn(),
}));

import { abbreviateDoctorName, doctorDisplayName } from "../../src/lib/doctor-display-name";
import { toAppointmentDto, toDoctorSummaryDto } from "../../src/mappers";
import { triggerAppointmentReminderEmail } from "../../src/modules/telehealth/lib/notifications";

describe("doctorDisplayName", () => {
  it.each([
    ["Hakan SOFU", "H. Sofu"],
    ["Doğukan YILDIRIM", "D. Yıldırım"],
    ["Kamil ÖZDİL", "K. Özdil"],
    ["Ayşe Zehra ÖZDEMİR KAYA", "A. Z. Özdemir Kaya"],
    ["Hasan Tuna Türkmen", "H. T. Türkmen"],
    ["Ali FIRAT", "A. Fırat"],
    ["Kadir KOLCUOĞLU", "K. Kolcuoğlu"],
    ["Ana-Maria POPESCU-IONESCU", "A. Popescu-Ionescu"],
    ["  Hakan   SOFU ", "H. Sofu"],
  ])("%s → %s", (fullName, expected) => {
    expect(doctorDisplayName({ fullName, isFounder: false })).toBe(expected);
  });

  it("kurucu tam adla (mevcut davranış); publicName doluysa otomatik kısaltmanın yerine geçer", () => {
    expect(doctorDisplayName({ fullName: "Vahit MUTLU", isFounder: true })).toBe("Vahit MUTLU");
    expect(doctorDisplayName({ fullName: "Hakan SOFU", publicName: "Hakan Sofu" })).toBe("Hakan Sofu");
    expect(doctorDisplayName({ fullName: "Vahit MUTLU", isFounder: true, publicName: "V. Mutlu" })).toBe("V. Mutlu");
    expect(doctorDisplayName({ fullName: "Hakan SOFU", publicName: "   " })).toBe("H. Sofu");
    expect(abbreviateDoctorName("Sofu")).toBe("Sofu");
  });
});

describe("DTO ayrımı", () => {
  const doctor = { id: "d1", title: "Prof. Dr.", fullName: "Hakan SOFU", slug: "hakan-sofu", isFounder: false, publicName: null };

  it("özet: ziyaretçi/hasta (varsayılan) kısaltılmış; admin/doktor portalı (internal) tam ad; alanlar seçilmemişse yine kısaltılır", () => {
    expect(toDoctorSummaryDto(doctor)).toMatchObject({ fullName: "H. Sofu", displayName: "H. Sofu" });
    expect(toDoctorSummaryDto(doctor, "internal")).toMatchObject({ fullName: "Hakan SOFU", displayName: "H. Sofu" });
    expect(toDoctorSummaryDto({ id: "d1", title: "Dr.", fullName: "Kamil ÖZDİL", slug: "k" }).fullName).toBe("K. Özdil");
    expect(toDoctorSummaryDto({ ...doctor, fullName: "Vahit MUTLU", isFounder: true }).fullName).toBe("Vahit MUTLU");
  });

  it("randevu DTO'su ad kitlesini özetine geçirir", () => {
    const appointment = {
      id: "a1",
      doctorId: "d1",
      doctor,
      patientUserId: null,
      patientName: "P",
      patientEmail: "p@example.com",
      startsAt: new Date("2026-11-02T10:00:00Z"),
      endsAt: new Date("2026-11-02T10:30:00Z"),
      status: "SCHEDULED",
      createdAt: new Date("2026-10-28T10:00:00Z"),
      updatedAt: new Date("2026-10-28T10:00:00Z"),
      cancelledAt: null,
      startedAt: null,
      endedAt: null,
      booking: null,
    } as unknown as Parameters<typeof toAppointmentDto>[0];
    expect(toAppointmentDto(appointment).doctor.fullName).toBe("H. Sofu");
    expect(toAppointmentDto(appointment, "internal").doctor.fullName).toBe("Hakan SOFU");
  });
});

describe("hatırlatma e-postası", () => {
  beforeEach(() => sendTemplateEmailMock.mockClear());

  it("hastaya giden e-postada görünen ad; doktorun kendi e-postasında tam ad", async () => {
    const app = {
      prisma: { user: { findUnique: vi.fn(async () => ({ email: "doctor@example.com" })) }, appointmentBooking: { findUnique: vi.fn() } },
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    } as never;
    const ok = await triggerAppointmentReminderEmail(app, {
      appointment: { id: "a1", bookingId: null, patientName: "Jane", patientEmail: "jane@example.com", startsAt: new Date("2026-11-02T10:00:00Z"), endsAt: new Date("2026-11-02T10:30:00Z") } as never,
      doctorTimeZone: "Europe/Istanbul",
      doctorTitle: "Prof. Dr.",
      doctorFullName: "Hakan SOFU",
      doctorDisplayName: "H. Sofu",
      doctorUserId: "u1",
      kind: "60m",
    });
    expect(ok).toBe(true);
    const calls = sendTemplateEmailMock.mock.calls as unknown as [unknown, string, string, Record<string, string>][];
    const patientCall = calls.find((c) => c[2] === "jane@example.com")!;
    const doctorCall = calls.find((c) => c[2] === "doctor@example.com")!;
    expect(patientCall[3].doctor_name).toBe("Prof. Dr. H. Sofu");
    expect(JSON.stringify(patientCall[3])).not.toContain("Hakan");
    expect(doctorCall[3].doctor_name).toBe("Prof. Dr. Hakan SOFU");
  });
  it("hastaya giden hatırlatmada unvan hastanın dilinde (TR 'Doç. Dr.'); hekime giden kanonik unvanla", async () => {
    const app = {
      prisma: {
        user: { findUnique: vi.fn(async () => ({ email: "doctor@example.com" })) },
        appointmentBooking: { findUnique: vi.fn(async () => ({ bookingNumber: "BKG-1", patientName: "Ayşe", patientEmail: "ayse@example.com", patientTimeZone: null, locale: "tr" })) },
      },
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    } as never;
    const ok = await triggerAppointmentReminderEmail(app, {
      appointment: { id: "a2", bookingId: "b1", patientName: "Ayşe", patientEmail: "ayse@example.com", startsAt: new Date("2026-11-02T10:00:00Z"), endsAt: new Date("2026-11-02T10:30:00Z") } as never,
      doctorTimeZone: "Europe/Istanbul",
      doctorTitle: "Assoc. Prof. Dr.",
      doctorTranslations: { tr: { title: "Doç. Dr." } },
      doctorFullName: "Hakan SOFU",
      doctorDisplayName: "H. Sofu",
      doctorUserId: "u1",
      kind: "60m",
    });
    expect(ok).toBe(true);
    const calls = sendTemplateEmailMock.mock.calls as unknown as [unknown, string, string, Record<string, string>][];
    expect(calls.find((c) => c[2] === "ayse@example.com")![3].doctor_name).toBe("Doç. Dr. H. Sofu");
    expect(calls.find((c) => c[2] === "doctor@example.com")![3].doctor_name).toBe("Assoc. Prof. Dr. Hakan SOFU");
  });
});
