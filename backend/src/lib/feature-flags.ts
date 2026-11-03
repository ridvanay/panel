/**
 * Derleme zamanı özellik bayrakları.
 *
 * EXTERNAL_MEETINGS_ENABLED: AG genel harici toplantı özelliği (ev sahibi uçları `/meetings`, ADMIN gözetimi
 * `/admin/meetings`, `PATCH /admin/users/:id/meeting-host`). AG İş 3 tamamlandığında AÇILDI (true). `false`
 * yapılırsa bu uçlar KAYDEDİLMEZ (404). Misafir uçları (`/meet/guest/*`) ve `meeting-sweeper` bayraktan
 * bağımsız HER ZAMAN kayıtlıdır: hizmet görüşmesinde hasta katılımı ve oda kapanışı bunlara dayanır.
 */
export const EXTERNAL_MEETINGS_ENABLED = true;

let testOverride: boolean | null = null;

/** Çalışma zamanı okuyucusu. Test ortamında `setExternalMeetingsEnabledForTests` ile geçersiz kılınabilir. */
export function externalMeetingsEnabled(): boolean {
  if (process.env.NODE_ENV === "test" && testOverride !== null) return testOverride;
  return EXTERNAL_MEETINGS_ENABLED;
}

/** YALNIZCA testler: AG genel uçlarını açar/kapatır (uygulama kurulmadan ÖNCE çağrılmalı). `null` = sabite dön. */
export function setExternalMeetingsEnabledForTests(value: boolean | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("setExternalMeetingsEnabledForTests yalnızca test ortamında kullanılabilir.");
  testOverride = value;
}
