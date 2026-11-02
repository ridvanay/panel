import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import { TURKEY_TIME_ZONE } from "@/lib/dual-time";

/** Toplantı odası, başlangıçtan bu kadar önce açılır (sunucudaki `MEETING_JOIN_LEAD_MS` ile aynı). */
export const MEETING_JOIN_LEAD_MS = 15 * 60_000;

/** Tarayıcı saat diliminde "2 Kas 2026 14:30". */
export function formatMeetingWhen(iso: string, lang: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(contentLocaleToIntl(lang), { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** Yalnızca saat ("14:30"). */
export function formatMeetingClock(iso: string, lang: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(contentLocaleToIntl(lang), { timeStyle: "short" }).format(date);
}

/** İstanbul saati — kullanıcının saat dilimi farklıysa ikinci satır olarak gösterilir; aynıysa `null`. */
export function formatMeetingIstanbul(iso: string, lang: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (local === TURKEY_TIME_ZONE) return null;
  return new Intl.DateTimeFormat(contentLocaleToIntl(lang), { dateStyle: "medium", timeStyle: "short", timeZone: TURKEY_TIME_ZONE }).format(date);
}

/** "1:05:09" / "05:09" geri sayımı. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Katılım penceresi: `startsAt - 15 dk ≤ şimdi < endsAt`. */
export function isInJoinWindow(startsAt: string, endsAt: string, now: number): boolean {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return now >= start - MEETING_JOIN_LEAD_MS && now < end;
}
