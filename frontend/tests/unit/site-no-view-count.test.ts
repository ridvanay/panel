import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Görüntülenme sayısı ziyaretçiye hiçbir sayfada gösterilmez (sayım `ViewTracker` ile sürer; sayı
 * yalnızca admin panelinde görünür). Site tarafındaki kaynaklar `viewCount` alanını okumamalı.
 */
const srcRoot = resolve(__dirname, "../../src");
const SITE_DIRS = ["app/[lang]", "components/site"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("site tarafında görüntülenme sayacı yok", () => {
  it("site rotaları ve bileşenleri viewCount göstermez", () => {
    const offenders = SITE_DIRS.flatMap((dir) => sourceFiles(join(srcRoot, dir)))
      .filter((file) => /\bviewCount\b/.test(readFileSync(file, "utf8")))
      .map((file) => relative(srcRoot, file));
    expect(offenders).toEqual([]);
  });
});
