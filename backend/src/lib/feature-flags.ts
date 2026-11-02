/**
 * Paket AI (İş 3, hızlı sürüm) — derleme zamanı özellik bayrakları.
 *
 * EXTERNAL_MEETINGS_ENABLED: AG genel harici toplantı özelliği (ev sahibi uçları `/meetings`, ADMIN gözetimi
 * `/admin/meetings`, `PATCH /admin/users/:id/meeting-host`). Bu sürümde KAPALI: uçlar KAYDEDİLMEZ (404).
 * Misafir uçları (`/meet/guest/*`) ve `meeting-sweeper` bayraktan bağımsız KAYITLIDIR: hizmet görüşmesinde hasta
 * katılımı ve oda kapanışı bunlara dayanır. AG İş 3'ün kalanı bu sabiti açacaktır.
 */
export const EXTERNAL_MEETINGS_ENABLED = false;

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
