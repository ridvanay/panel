import { formatPatientRange, mergeSlotRanges, TURKEY_TIME_ZONE, type SlotRange } from "../../../lib/dual-time";

/**
 * Paket AG (Is 2) - admin randevu bildirim e-postasinin icerigi (SAF: DB/IO yok; EN, kurumsal kabuga
 * `audience: "staff"` ile verilir).
 *
 * GIZLILIK (Paket AC kurali): hasta adi, e-postasi, telefonu, sikayeti, uzmanlik/saglik bilgisi ve belge adi
 * BU E-POSTADA YOKTUR - girdi tipi bunlari zaten tasimaz. Ayrintilar yalnizca baglantidan, oturum acmis adminle gorulur.
 */
export type BookingNotificationKind = "confirmed" | "cancelled" | "rescheduled";

export interface BookingNotificationEmailData {
  kind: BookingNotificationKind;
  bookingId: string;
  bookingNumber: string;
  /** `doctorEmailName` ile uretilmis unvan + gorunen ad. */
  doctorName: string;
  /** confirmed: tum slotlar; cancelled: iptal edilen slot(lar); rescheduled: YENI slot. */
  slots: SlotRange[];
  patientTimeZone: string | null;
  /** Yalniz rescheduled: eski slot. */
  previous?: SlotRange | null;
  /** Yalniz confirmed. */
  interpreterLanguage?: string | null;
  siteLocale?: string | null;
  paymentLabel?: string;
  frontendUrl: string;
}

export interface BookingNotificationEmail {
  subject: string;
  preheader: string;
  title: string;
  bodyHtml: string;
  cta: { label: string; url: string };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** `2026-11-12 13:30` - Europe/Istanbul duvar saati. */
export function formatIstanbulStamp(instant: Date): string {
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-CA", {
    timeZone: TURKEY_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** Odeme etiketi - `paidBy` + `paymentStatus` (hasta/kart verisi YOK). */
export function paymentLabel(paymentStatus: string, paidBy: string | null | undefined): string {
  if (paymentStatus !== "PAID") return paymentStatus.charAt(0) + paymentStatus.slice(1).toLowerCase();
  switch (paidBy) {
    case "stripe":
      return "Paid (card)";
    case "manual":
      return "Paid (manual)";
    case "free":
      return "Free session";
    case "demo":
      return "Paid (demo)";
    default:
      return "Paid";
  }
}

function languageName(code: string): string {
  try {
    const tag = code === "sr-latn" ? "sr-Latn" : code;
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(tag);
    return name && name !== tag ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

function row(label: string, value: string): string {
  return `<p style="margin:0 0 8px;"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`;
}

function minutesOf(slots: readonly SlotRange[]): number {
  return slots.reduce((sum, s) => sum + (s.endsAt ? Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60_000) : 0), 0);
}

export function buildBookingNotificationEmail(data: BookingNotificationEmailData): BookingNotificationEmail {
  const no = data.bookingNumber;
  const base = data.frontendUrl.replace(/\/$/, "");
  const cta = { label: "Open appointment", url: `${base}/admin/telehealth/bookings/${data.bookingId}` };
  const slotLines = mergeSlotRanges(data.slots).map((range) => formatPatientRange(range, data.patientTimeZone));
  const first = [...data.slots].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];

  if (data.kind === "confirmed") {
    const subject = `New appointment #${no} — ${data.doctorName} — ${first ? formatIstanbulStamp(first.startsAt) : "-"} (Europe/Istanbul)`;
    const duration = minutesOf(data.slots);
    const interpreter = data.interpreterLanguage ? `yes (${languageName(data.interpreterLanguage)})` : "no";
    const rows = [
      row("Appointment", `#${no}`),
      row("Physician", data.doctorName),
      ...slotLines.map((line, i) => row(i === 0 ? "Date and time" : "Date and time (additional)", line)),
      row("Duration", `${duration} min`),
      row("Interpreter", interpreter),
      ...(data.interpreterLanguage || !data.siteLocale ? [] : [row("Patient's site language", languageName(data.siteLocale))]),
      ...(data.paymentLabel ? [row("Payment", data.paymentLabel)] : []),
    ];
    return {
      subject,
      preheader: subject,
      title: "New appointment",
      bodyHtml: `<p>A new appointment has been confirmed.</p>${rows.join("")}<p style="margin:12px 0 0;">Patient details are only visible in the admin panel after signing in.</p>`,
      cta,
    };
  }

  if (data.kind === "cancelled") {
    const subject = `Appointment #${no} cancelled`;
    const rows = [
      row("Appointment", `#${no}`),
      row("Physician", data.doctorName),
      ...slotLines.map((line) => row("Date and time", line)),
      row("Status", "Cancelled"),
    ];
    return { subject, preheader: subject, title: "Appointment cancelled", bodyHtml: `<p>An appointment has been cancelled.</p>${rows.join("")}`, cta };
  }

  const subject = `Appointment #${no} rescheduled`;
  const previous = data.previous ? formatPatientRange(data.previous, data.patientTimeZone) : null;
  const rows = [
    row("Appointment", `#${no}`),
    row("Physician", data.doctorName),
    ...(previous ? [row("Previous date and time", previous)] : []),
    ...slotLines.map((line) => row("New date and time", line)),
    row("Status", "Rescheduled"),
  ];
  return { subject, preheader: subject, title: "Appointment rescheduled", bodyHtml: `<p>An appointment has been rescheduled.</p>${rows.join("")}`, cta };
}
