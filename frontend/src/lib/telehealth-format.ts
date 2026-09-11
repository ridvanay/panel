/**
 * `.claude/design-notes-telehealth.md` §2.2/§2.3/§2.4 — randevu tarih-saat biçimlendiricileri.
 * Hem `availability-calendar.tsx` (takvim ızgarası + saat slotları + onay şeridi) hem de
 * `doctor-service-summary.tsx` ("Seçilen Randevu" satırı, §2.4.4) AYNI biçimlendiriciyi
 * kullanmalıdır — iki bağımsız kopya İCAT EDİLMEZ (ikisi de `formatDayLabel`/`formatTime` ile
 * BİREBİR aynı `"{gün} · {HH:mm}"` çıktısını üretir, §2.4.4'ün "ikinci bir ayraç biçimi İCAT
 * ETMEK tutarsızlık yaratırdı" ilkesi).
 */

/** `en-CA` → `YYYY-MM-DD` — gün gruplama anahtarı, biçimlendirme AMAÇLI DEĞİL. */
export function formatDayKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** `"11 Eylül Cuma"` — §2.2.5/§2.3.6/§2.4.4 onay şeritlerinde/özet panelinde BİREBİR aynı çıktı. */
export function formatDayLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("tr-TR", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
}

/** `"HH:mm"` (`hourCycle: "h23"`) — saat slotu etiketi, onay şeridi, özet paneli AYNI kaynak. */
export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("tr-TR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}
