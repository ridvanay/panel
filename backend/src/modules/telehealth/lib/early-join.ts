/**
 * `.claude/architect-scope-support-desk-and-reminders.md` §1.2/§1.3 (bağlayıcı) — erken katılım
 * UYARISI tamamen frontend'dedir (`JoinMeetingButton`); backend hiçbir şekilde katılımı REDDETMEZ.
 * Bu dosya YALNIZCA `telehealth.meeting_token.issued` audit kaydına yazılan `earlyJoin`/
 * `minutesBeforeStart` metadata'sının SUNUCU tarafı hesabını taşır (istemciden ASLA gelmez).
 *
 * `telehealth.livekit.routes.ts` (integration-agent'ın TEK SAHASI) DEĞİŞTİRİLMEZ — bu sabit/
 * yardımcı BİLİNÇLİ OLARAK o dosyanın YANINA (ayrı bir dosyaya) konur (§1.3: "backend'de audit
 * hesabı için backend/src/modules/telehealth/lib/livekit.ts yanında"), route dosyası bu modülü
 * yalnızca İTHAL eder.
 *
 * Frontend'deki eşik (`frontend/src/lib/telehealth-format.ts` veya yanına eklenen sabit) İLE
 * AYNI değeri (10) taşır — kopyalanmış sihirli sayı YASAK, ama iki ayrı çalışma zamanı (backend/
 * frontend) arasında GERÇEK bir paylaşım mekanizması YOKTUR, bu yüzden değer burada da sabit
 * olarak tanımlanır.
 */
export const EARLY_JOIN_WARNING_THRESHOLD_MINUTES = 10;

export interface EarlyJoinAuditMetadata {
  /** `startsAt - now > EARLY_JOIN_WARNING_THRESHOLD_MINUTES dakika` ise `true`. */
  earlyJoin: boolean;
  /** `startsAt - now`, DAKİKA, SUNUCU saatinden hesaplanır. Negatif = randevu saatinden SONRA. */
  minutesBeforeStart: number;
}

/** Saf yardımcı — testlerle sabitlenir. `now` opsiyoneldir (varsayılan: gerçek sunucu saati). */
export function computeEarlyJoinAuditMetadata(startsAt: Date, now: Date = new Date()): EarlyJoinAuditMetadata {
  const minutesBeforeStart = Math.round((startsAt.getTime() - now.getTime()) / (60 * 1000));
  return {
    earlyJoin: minutesBeforeStart > EARLY_JOIN_WARNING_THRESHOLD_MINUTES,
    minutesBeforeStart,
  };
}
