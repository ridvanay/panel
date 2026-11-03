/**
 * Basit bellek içi kayan pencere sayacı (tek süreç; çok örnekte örnek başına sayılır — kasıtlı yaklaşık sınır).
 * Anahtarlar çağıran tarafından türetilir (ham IP saklanmaz: çağıran `sha256` özetini verir). Süresi dolan
 * kayıtlar erişimde ve periyodik temizlikte atılır; harita boyutu `MAX_KEYS` ile sınırlıdır.
 */
const MAX_KEYS = 20_000;

export class MemoryRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number
  ) {}

  /** Sayaca ekler; sınır aşılmışsa `false` döner (ekleme yapılmaz). */
  tryConsume(key: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > MAX_KEYS) this.prune(cutoff);
    return true;
  }

  /** Test yardımcısı. */
  reset(): void {
    this.hits.clear();
  }

  private prune(cutoff: number): void {
    for (const [key, list] of this.hits) {
      if (list.every((t) => t <= cutoff)) this.hits.delete(key);
    }
    // Hâlâ doluysa en eski anahtarları at (bellek tavanı).
    while (this.hits.size > MAX_KEYS) {
      const first = this.hits.keys().next().value;
      if (first === undefined) break;
      this.hits.delete(first);
    }
  }
}
