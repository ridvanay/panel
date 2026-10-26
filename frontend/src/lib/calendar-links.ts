/**
 * Paket R — "Takvime ekle": `.ics` dosyası ve Google Takvim bağlantısı. YALNIZCA hastanın kendi
 * tarayıcısında üretilir (sunucuya gitmez). Zamanlar UTC (`...Z`), `TZID` gerekmez. İçerikte
 * randevu erişim bağlantısı dışında kişisel veri yoktur (hasta adı/e-posta EKLENMEZ).
 */
export interface CalendarEventInput {
  /** Benzersiz kimlik (ör. booking id) — takvim uygulaması tekrar eklemede günceller. */
  uid: string;
  title: string;
  startsAt: string;
  endsAt: string;
  /** Randevu erişim bağlantısı (isteğe bağlı). */
  url?: string | null;
  description?: string | null;
}

/** `2026-10-28T14:00:00.000Z` → `20261028T140000Z`. */
export function toIcsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** RFC 5545 metin kaçışı: `\`, `;`, `,` ve satır sonu. */
function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545: satırlar 75 sekizliyi aşmasın (devam satırı boşlukla başlar). */
function foldLine(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

export function buildIcs(events: readonly CalendarEventInput[], now: Date = new Date()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//WM Health//Telehealth//TR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const event of events) {
    const description = [event.description, event.url].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}-${toIcsUtc(event.startsAt)}@wm-health`,
      `DTSTAMP:${toIcsUtc(now.toISOString())}`,
      `DTSTART:${toIcsUtc(event.startsAt)}`,
      `DTEND:${toIcsUtc(event.endsAt)}`,
      foldLine(`SUMMARY:${escapeIcsText(event.title)}`)
    );
    if (description) lines.push(foldLine(`DESCRIPTION:${escapeIcsText(description)}`));
    if (event.url) lines.push(foldLine(`URL:${event.url}`));
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * Google Takvim "etkinlik oluştur" bağlantısı (UTC zamanlarla). İnceleme bulgusu — randevu erişim
 * bağlantısı (gizli `t` token'ı içerir) Google'a GÖNDERİLMEZ; yalnızca başlık, saat ve açıklama.
 * Erişim bağlantısı yalnızca hastanın cihazında kalan `.ics` dosyasına yazılır.
 */
export function googleCalendarUrl(event: CalendarEventInput): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${toIcsUtc(event.startsAt)}/${toIcsUtc(event.endsAt)}`,
  });
  if (event.description) params.set("details", event.description);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
