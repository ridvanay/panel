/**
 * SÜREÇ-İÇİ (in-memory), tek-instance varsayan "son 60 saniyede görülen ziyaretçi" kaydı.
 * Sunucu yeniden başlarsa sıfırlanır; çoklu-instance deploymentta her process kendi
 * haritasını tutar (Redis gibi paylaşımlı bir store bu MVP kapsamında yok). Gerçek istek
 * sinyaline dayanır (view endpoint çağrısı), uydurma veri değildir.
 */
const LIVE_WINDOW_MS = 60_000;
const lastSeen = new Map<string, number>();

export function touchVisitor(ip: string, userAgent: string | undefined): void {
  const key = `${ip}::${(userAgent ?? "").slice(0, 40)}`;
  lastSeen.set(key, Date.now());
}

export function countLiveVisitors(): number {
  const cutoff = Date.now() - LIVE_WINDOW_MS;
  let count = 0;
  for (const [key, ts] of lastSeen) {
    if (ts < cutoff) {
      lastSeen.delete(key);
      continue;
    }
    count++;
  }
  return count;
}
