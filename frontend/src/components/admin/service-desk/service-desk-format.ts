import type { ServiceConsultationStatus, ServiceDeskHour } from "@/lib/api/service-desk-admin";

/** Hizmet masası saat dilimi (varsayılan); admin ekranları İstanbul saatiyle gösterir. */
export const DESK_TIME_ZONE = "Europe/Istanbul";

/** Koordinatörün "Görüşmeye katıl" penceresi: başlangıçtan 15 dk önce açılır, bitişte kapanır (sunucu kuralıyla aynı). */
export const JOIN_LEAD_MS = 15 * 60_000;

export const STATUS_LABELS: Record<ServiceConsultationStatus, string> = {
  PENDING_PAYMENT: "Ödeme bekliyor",
  SCHEDULED: "Planlandı",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal edildi",
  NO_SHOW: "Gelmedi",
};

export const STATUS_TONES: Record<ServiceConsultationStatus, "neutral" | "primary" | "success" | "warning" | "danger"> = {
  PENDING_PAYMENT: "warning",
  SCHEDULED: "primary",
  COMPLETED: "success",
  CANCELLED: "danger",
  NO_SHOW: "warning",
};

/** Dil kodu -> Türkçe ad (koordinatör ve görüşme satırlarında). Bilinmeyen kod olduğu gibi gösterilir. */
export const LANGUAGE_NAMES_TR: Record<string, string> = {
  en: "İngilizce",
  de: "Almanca",
  ar: "Arapça",
  ru: "Rusça",
  fr: "Fransızca",
  es: "İspanyolca",
  ro: "Romence",
  "sr-latn": "Sırpça",
  tr: "Türkçe",
};

export function languageName(code: string | null | undefined): string {
  if (!code) return "-";
  return LANGUAGE_NAMES_TR[code.toLowerCase()] ?? code;
}

export const CHANNEL_LABELS: Record<string, string> = {
  email: "E-posta",
  whatsapp: "WhatsApp",
  phone: "Telefon",
};

export const DAY_NAMES_TR = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];

/** "12 Kas 2026 14:30" biçiminde, verilen IANA diliminde. Geçersiz tarih -> "-". */
export function formatDateTimeIn(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  try {
    return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone }).format(d);
  } catch {
    return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(d);
  }
}

export function formatTimeIn(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  try {
    return new Intl.DateTimeFormat("tr-TR", { timeStyle: "short", timeZone }).format(d);
  } catch {
    return new Intl.DateTimeFormat("tr-TR", { timeStyle: "short" }).format(d);
  }
}

/** `YYYY-MM-DD` tarihini "12 Kas 2026, Perşembe" gibi gösterir (saat dilimi kaymasını önlemek için UTC). */
export function formatDateOnly(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "full", timeZone: "UTC" }).format(d);
}

export function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Aynı gün içinde çakışan (veya iç içe geçen) pencereleri bulur. Bitişik pencereler (biri tam diğerinin
 * bittiği dakikada başlıyor) çakışma sayılmaz. Her çakışma `{ dayOfWeek }` ile bildirilir (gün başına en çok bir kez).
 */
export function findHourOverlaps(hours: readonly Pick<ServiceDeskHour, "dayOfWeek" | "startMinute" | "endMinute">[]): number[] {
  const days = new Set<number>();
  for (let i = 0; i < hours.length; i++) {
    for (let j = i + 1; j < hours.length; j++) {
      const a = hours[i]!;
      const b = hours[j]!;
      if (a.dayOfWeek !== b.dayOfWeek) continue;
      if (a.startMinute < b.endMinute && b.startMinute < a.endMinute) days.add(a.dayOfWeek);
    }
  }
  return [...days].sort((x, y) => x - y);
}

/** Katılım penceresi: başlangıç-15 dk ... bitiş (bitiş dahil değil). */
export function isJoinWindowOpen(startsAt: string, endsAt: string, nowMs: number): boolean {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return nowMs >= start - JOIN_LEAD_MS && nowMs < end;
}

/** Pencere açılana kadar kalan tam dakika (yukarı yuvarlanır); açıksa 0. */
export function minutesUntilJoinOpens(startsAt: string, nowMs: number): number {
  const start = new Date(startsAt).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.ceil((start - JOIN_LEAD_MS - nowMs) / 60_000));
}

/** "2 sa 5 dk" / "35 dk" okunur süre. */
export function formatMinutesTr(total: number): string {
  if (total < 60) return `${total} dk`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} sa` : `${h} sa ${m} dk`;
}
