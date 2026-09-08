import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NAVIGATION_MAX_DEPTH, NAVIGATION_MAX_ITEMS } from "../../src/modules/navigation/navigation.constants";

/**
 * qa-agent — `.claude/architect-scope-navigation-deep-nesting.md` §0/§5: proje bir npm workspace
 * monorepo'su OLMADIĞI için `NAVIGATION_MAX_DEPTH`/`NAVIGATION_MAX_ITEMS` sabitleri TAM iki dosyada
 * (backend + frontend) AYNALANIR, normatif değer `docs/architecture/openapi.yaml`dadır. Bu test
 * ÜÇ kaynağın da (backend sabiti — import edilerek DOĞRUDAN; frontend sabiti — dosya metninden
 * regex ile; openapi.yaml — dosya metninden regex ile) değer eşitliğini doğrular. Frontend dosyası
 * backend'in TypeScript derlemesine dahil olmadığı (ayrı workspace, farklı `tsconfig`/build) için
 * `import` EDİLEMEZ — statik metin okuma/regex ayrıştırma kasıtlı tercih, bkz. görev tanımı madde 6.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const FRONTEND_CONSTANTS_PATH = path.join(REPO_ROOT, "frontend", "src", "lib", "navigation-constants.ts");
const OPENAPI_PATH = path.join(REPO_ROOT, "docs", "architecture", "openapi.yaml");

function extractConstNumber(source: string, constName: string): number {
  const match = source.match(new RegExp(`export const ${constName}\\s*=\\s*(\\d+)\\s*;`));
  if (!match) {
    throw new Error(`'${constName}' sabiti kaynak metinde bulunamadı (regex eşleşmedi).`);
  }
  return Number(match[1]);
}

describe("navigation-constants — backend/frontend/openapi.yaml değer eşitliği", () => {
  const frontendSource = readFileSync(FRONTEND_CONSTANTS_PATH, "utf-8");
  const frontendMaxDepth = extractConstNumber(frontendSource, "NAVIGATION_MAX_DEPTH");
  const frontendMaxItems = extractConstNumber(frontendSource, "NAVIGATION_MAX_ITEMS");

  it("backend NAVIGATION_MAX_DEPTH === frontend NAVIGATION_MAX_DEPTH", () => {
    expect(frontendMaxDepth).toBe(NAVIGATION_MAX_DEPTH);
  });

  it("backend NAVIGATION_MAX_ITEMS === frontend NAVIGATION_MAX_ITEMS", () => {
    expect(frontendMaxItems).toBe(NAVIGATION_MAX_ITEMS);
  });

  it("backend NAVIGATION_MAX_DEPTH === 3 (mimar kararı — bkz. architect-scope §0)", () => {
    // Regresyon tripwire'ı: değer bilinçsizce değiştirilirse (ör. yanlış birleştirme) bu test
    // kırmızı çıkar — .claude/architect-scope-navigation-deep-nesting.md §0'daki bağlayıcı karar.
    expect(NAVIGATION_MAX_DEPTH).toBe(3);
  });

  it("backend NAVIGATION_MAX_ITEMS === 100 (mimar kararı — bkz. architect-scope §0)", () => {
    expect(NAVIGATION_MAX_ITEMS).toBe(100);
  });

  describe("docs/architecture/openapi.yaml — normatif kaynak", () => {
    const openapiSource = readFileSync(OPENAPI_PATH, "utf-8");

    it("openapi.yaml metninde 'NAVIGATION_MAX_DEPTH = <N>' backend değeriyle eşleşir", () => {
      // `NavigationItem` şema açıklamasında serbest metin olarak yazılı (bkz. architect-scope §5
      // görev tanımı: "iki sabit dosyasının ... varsa openapi.yaml'daki normatif değerle" eşitliği).
      const match = openapiSource.match(/NAVIGATION_MAX_DEPTH\s*=\s*(\d+)/);
      expect(match, "openapi.yaml içinde 'NAVIGATION_MAX_DEPTH = <sayı>' metni bulunamadı").not.toBeNull();
      const openapiMaxDepth = Number(match![1]);
      expect(openapiMaxDepth).toBe(NAVIGATION_MAX_DEPTH);
    });

    it("openapi.yaml 'UpdateNavigationConfigRequest.navigationItems.maxItems' backend NAVIGATION_MAX_ITEMS ile eşleşir", () => {
      // `maxItems: 100` metni dosyada BAŞKA (ilgisiz) şemalarda da geçtiği için (ör. sayfalama
      // limitleri), yalnızca `UpdateNavigationConfigRequest` şema bloğu İÇİNDEKİ `navigationItems`
      // dizisinin hemen ardından gelen `maxItems` değeri alınır — genel bir grep YANLIŞ POZİTİF
      // üretebilir.
      const schemaStart = openapiSource.indexOf("UpdateNavigationConfigRequest:");
      expect(schemaStart, "openapi.yaml içinde 'UpdateNavigationConfigRequest:' şeması bulunamadı").toBeGreaterThan(-1);
      // Bir sonraki üst-seviye (6-boşluklu girinti, `components.schemas.<Name>:`) anahtara kadar kes.
      const rest = openapiSource.slice(schemaStart);
      const nextSchemaMatch = rest.slice(1).match(/\n {4}\S[^\n]*:\n/);
      const schemaBlock = nextSchemaMatch ? rest.slice(0, nextSchemaMatch.index! + 1) : rest;

      const navItemsIndex = schemaBlock.indexOf("navigationItems:");
      expect(navItemsIndex, "'UpdateNavigationConfigRequest' bloğunda 'navigationItems:' alanı bulunamadı").toBeGreaterThan(-1);
      const navItemsBlock = schemaBlock.slice(navItemsIndex);
      const maxItemsMatch = navItemsBlock.match(/maxItems:\s*(\d+)/);
      expect(maxItemsMatch, "'navigationItems' alanında 'maxItems: <sayı>' bulunamadı").not.toBeNull();
      const openapiMaxItems = Number(maxItemsMatch![1]);
      expect(openapiMaxItems).toBe(NAVIGATION_MAX_ITEMS);
    });
  });
});
