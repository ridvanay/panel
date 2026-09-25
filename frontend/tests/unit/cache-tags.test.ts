import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CACHE_TAG_PATTERN, CACHE_TAGS, sliderCacheTag } from "@/lib/cache-tags";

/**
 * Backend admin kayıtlarından sonra `{ tags }` gönderir (`backend/src/lib/revalidate.ts::CACHE_TAGS`);
 * frontend fetch'leri aynı etiketlerle işaretlenir. İki liste kayarsa yenileme sessizce çalışmaz —
 * backend dosyası metin olarak okunur (derleme bağımlılığı eklenmez, `about-page-migration.test.ts` deseni).
 */
const backendSource = readFileSync(resolve(__dirname, "../../../backend/src/lib/revalidate.ts"), "utf8");

function backendTags(): Record<string, string> {
  const block = backendSource.match(/export const CACHE_TAGS = \{([\s\S]*?)\} as const;/);
  if (!block) throw new Error("backend CACHE_TAGS bulunamadı");
  return Object.fromEntries([...block[1]!.matchAll(/(\w+): "([^"]+)"/g)].map((m) => [m[1]!, m[2]!]));
}

describe("önbellek etiketleri", () => {
  it("backend ile frontend CACHE_TAGS birebir aynı", () => {
    expect(backendTags()).toEqual({ ...CACHE_TAGS });
  });

  it("slider etiketi iki tarafta aynı biçimde ve /api/revalidate doğrulamasından geçer", () => {
    expect(backendSource).toContain("return `slider:${sliderId}`;");
    const tag = sliderCacheTag("3f2c9a1e-0b4d-4c55-9d7e-1a2b3c4d5e6f");
    expect(tag).toBe("slider:3f2c9a1e-0b4d-4c55-9d7e-1a2b3c4d5e6f");
    expect(CACHE_TAG_PATTERN.test(tag)).toBe(true);
    for (const value of Object.values(CACHE_TAGS)) expect(CACHE_TAG_PATTERN.test(value)).toBe(true);
  });
});
