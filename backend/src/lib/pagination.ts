export function parseCursor(cursor?: string): number | undefined {
  if (!cursor) return undefined;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const n = Number(decoded);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

export function encodeCursor(seq: number): string {
  return Buffer.from(String(seq)).toString("base64url");
}

export function buildPageMeta<T extends { seq: number }>(items: T[], limit: number) {
  const nextCursor = items.length === limit ? encodeCursor(items[items.length - 1]!.seq) : null;
  return { nextCursor };
}

/**
 * §10.7 İçerik Yönetim Listesi — `buildPageMeta` sonucuna sekme sayaçlarını (`counts`)
 * merge eder. `counts` çağıran tarafta AYRI/tek bir sorguyla (istek filtrelerinden
 * etkilenmeden, tüm tabloya bakarak) hesaplanmış olmalıdır — bkz. `lib/content-counts.ts`.
 */
export function buildPageMetaWithCounts<T extends { seq: number }, C extends Record<string, unknown>>(
  items: T[],
  limit: number,
  counts: C
) {
  return { ...buildPageMeta(items, limit), counts };
}
