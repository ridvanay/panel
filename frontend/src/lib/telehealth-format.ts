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

/**
 * `"11 Eylül Cuma"` — §2.2.5/§2.3.6/§2.4.4 onay şeritlerinde/özet panelinde BİREBİR aynı çıktı.
 * Görev (2026-09-16) — `locale` opsiyoneldir ve varsayılanı `"tr-TR"`dir (`formatPriceFromCents`
 * İLE AYNI geriye-dönük-uyumlu desen); çağıran taraf aktif site diline göre `contentLocaleToIntl`
 * ile üretilen BCP-47 etiketini AÇIKÇA geçmelidir (bkz. çağıranların `useActiveLocaleCode` kullanımı).
 */
export function formatDayLabel(iso: string, timeZone: string, locale = "tr-TR"): string {
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
}

/**
 * `"14 Eylül 2026, Pazartesi"` — doktor konsolu hasta kartı (`doctor-console-patient-card.tsx`)
 * TAM tarih biçimi (Grid görevi, 2026-09-14, Görev 2 madde 1). `formatDayLabel`'den FARKLI olarak
 * yıl İÇERİR ve hafta günü sona taşınır — kurumsal EHR kartlarında yılın da görünür olması
 * beklenir (`formatDayLabel`'in kısa "gün ay haftaGünü" biçimi bu bağlam için yetersizdi). AYNI
 * `Intl.DateTimeFormat("tr-TR", { timeZone, ... })` deseni İKİ AYRI çağrıyla (tarih + hafta günü)
 * birleştirilir; ikinci bir tarih kütüphanesi İCAT EDİLMEZ.
 */
export function formatFullDayLabel(iso: string, timeZone: string, locale = "tr-TR"): string {
  const date = new Date(iso);
  const datePart = new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "long", year: "numeric" }).format(date);
  const weekdayPart = new Intl.DateTimeFormat(locale, { timeZone, weekday: "long" }).format(date);
  return `${datePart}, ${weekdayPart}`;
}

/**
 * `"HH:mm"` saat slotu etiketi, onay şeridi, özet paneli AYNI kaynak.
 * Görev (2026-09-16, düzeltme) — saat formatı (12h/24h) locale'e göre biçimlendirilmelidir:
 * İngilizce (`en`, `en-US`, `en-GB` vb. — `.claude/architect-scope-i18n.md` §6.1'deki hreflang
 * override'lar da bu köke bağlıdır) için `hourCycle: "h12"` (AM/PM), diğer tüm locale'ler
 * (varsayılan `tr-TR` dahil) için `hourCycle: "h23"`. Bölgesel `en-*` varyantları arasında AYRIM
 * YAPILMAZ — görev açıkça "İngilizceye göre" dedi, bölge bazlı ayrım istemedi; bu yüzden
 * `Intl`'in kendi varsayılanına (`en-GB` → 24h) bırakmak yerine `locale.startsWith("en")` ile
 * AÇIKÇA kontrol edilir. `formatDayLabel` İLE AYNI varsayılan/geriye-uyum deseni korunur.
 */
export function formatTime(iso: string, timeZone: string, locale = "tr-TR"): string {
  const hourCycle = locale.toLowerCase().startsWith("en") ? "h12" : "h23";
  return new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle }).format(new Date(iso));
}

/**
 * Bug-fix turu (2026-09-15) — doktor konsolu hasta kartı (`doctor-console-patient-card.tsx`)
 * doktorun `timeZone`'u `Europe/Istanbul`DEN farklıysa saat dilimi kısaltmasını ("EDT", "GMT+3"
 * vb.) ikinci bir açıklama olarak gösterebilsin diye eklendi. `"Europe/Istanbul"` için Intl'in
 * ürettiği kısaltma ICU sürümüne göre değişebilir (`GMT+3` vb.) — bunun yerine platformda yaygın
 * bilinen SABİT `"TSİ"` (Türkiye Saati) kısaltması döndürülür.
 */
export function formatTimeZoneAbbreviation(iso: string, timeZone: string): string {
  if (timeZone === "Europe/Istanbul") return "TSİ";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(new Date(iso));
  return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
}

/**
 * Bug-fix turu (2026-09-15, frontend-agent) — çoklu slot booking'lerde (`AppointmentBooking.appointments`,
 * `startsAt asc` sıralı ama SIRALAMAYA GÜVENİLMEZ) blok saat aralığını/toplam dakikayı hesaplar.
 * `doctor-console-patient-card.tsx` (blok saat gösterimi) VE `patient-payments-panel.tsx`
 * (Süre/Slot Sayısı sütunu) AYNI mantığı kullanır — İKİ AYRI kopya İCAT EDİLMEZ.
 */
export interface AppointmentTimeSpan {
  startsAt: string;
  endsAt: string;
}

export function computeAppointmentBlock(appointments: AppointmentTimeSpan[]): {
  startMs: number;
  endMs: number;
  totalMinutes: number;
} {
  const startMs = Math.min(...appointments.map((a) => new Date(a.startsAt).getTime()));
  const endMs = Math.max(...appointments.map((a) => new Date(a.endsAt).getTime()));
  return { startMs, endMs, totalMinutes: Math.round((endMs - startMs) / 60_000) };
}

/**
 * `.claude/architect-scope-support-desk-and-reminders.md` §1.2 — erken katılım uyarı modalının
 * eşiği. Backend audit tarafında (`telehealth.livekit.routes.ts` `metadata.minutesBeforeStart`)
 * AYNI sayı KULLANILIR — sihirli sayı iki tarafta ayrı ayrı KOPYALANMAZ, bu tek kaynak
 * frontend'deki tek gerçek kaynaktır (backend kendi sabitini `lib/livekit.ts` yanında tutar).
 */
export const EARLY_JOIN_WARNING_THRESHOLD_MINUTES = 10;
