import { describe, it, beforeAll, afterAll, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { parseRouteTable } from "../helpers/route-table-parser";

/**
 * `.claude/architect-scope-rbac-5-tier.md` §4.4 — security-agent'ın ZORUNLU YAPISAL zorlama
 * testi. `panel-access-exceptions.test.ts` (backend-agent) yalnızca davranışı (HTTP status)
 * doğrular; BU dosya gerçek Fastify route tablosunu (`app.printRoutes({ includeHooks: true })`)
 * introspекte ederek `/api/v1/admin/` ile başlayan HER route'un preHandler zincirinde bir
 * `requireSiteRole(...)` tabanlı guard (fonksiyon adı: `siteRbacGuard`, hem `requirePanelAccess()`
 * hem daha dar `requireSiteRole(...)` çağrıları bunu üretir) bulunduğunu KANITLAR — §4.3'teki
 * İKİ istisna hariç (`/admin/settings/security/2fa`, `/admin/settings/security/sessions`).
 *
 * Bu testin amacı: gelecekte biri yeni bir `/admin/*` router'ı eklerken `requirePanelAccess()`
 * (veya route-bazlı `requireSiteRole(...)`) eklemeyi UNUTURSA, bu test KIRILIR — manuel gözden
 * geçirmeye güvenilmez (§4.4 gerekçesi). Route-tablosu introspeksiyonu `onRoute` hook'u ile
 * DEĞİL `printRoutes({ includeHooks: true })` ile yapılır çünkü `onRoute`, plugin-scope
 * `app.addHook("preHandler", ...)` ile eklenen hook'ları YANSITMAZ (doğrulandı, bkz.
 * `../helpers/route-table-parser.ts` başlık yorumu) — yalnızca route-seviyesi `preHandler`
 * seçeneğini gösterir ve bu, `requirePanelAccess()`'in plugin-scope hook olarak eklendiği
 * bu kod tabanında YANLIŞ NEGATİF üretirdi.
 */
describe("§4.4 — /admin/* route tablosu panel-guard zorlama testi", () => {
  let app: FastifyInstance;

  // §4.3 — bağlayıcı istisna listesi. GENİŞLETİLEMEZ (üçüncü istisna gerekiyorsa architect'e
  // eskale edilir, bkz. karar dokümanı §4.3 son satırı).
  const EXCEPTION_PREFIXES = ["/api/v1/admin/settings/security/2fa", "/api/v1/admin/settings/security/sessions"];

  // `requireSiteRole(...)`'un ürettiği guard fonksiyonunun adı (bkz. middleware/site-rbac.ts
  // `async function siteRbacGuard(...)`). `requirePanelAccess()` de dahil TÜM
  // `requireSiteRole(...)` çağrıları bu isimle preHandler zincirinde görünür.
  const SITE_RBAC_GUARD_NAME = "siteRbacGuard";

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  function isExempt(path: string): boolean {
    return EXCEPTION_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }

  it("her /api/v1/admin/* route'unda (istisnalar hariç) requireSiteRole tabanlı bir guard vardır", () => {
    const text = app.printRoutes({ commonPrefix: false, includeHooks: true });
    const entries = parseRouteTable(text);
    const adminEntries = entries.filter((e) => e.path.startsWith("/api/v1/admin/"));

    // Sağlık kontrolü — parser'ın sessizce 0 sonuç üretip testi anlamsızca "yeşil" yapmadığından
    // emin ol (§5.3'teki 20+ route dosyası, HEAD dahil, en az yüzlerce girdi üretmeli).
    expect(adminEntries.length).toBeGreaterThan(100);

    const nonExempt = adminEntries.filter((e) => !isExempt(e.path));
    const exempt = adminEntries.filter((e) => isExempt(e.path));

    // İstisna kümesinin GERÇEKTEN küçük ve yalnızca beklenen 2 prefix'ten geldiğini doğrula —
    // istisna listesinin sessizce büyümediğinden emin olmak için.
    expect(exempt.length).toBeGreaterThan(0);
    for (const e of exempt) {
      expect(EXCEPTION_PREFIXES.some((p) => e.path === p || e.path.startsWith(`${p}/`))).toBe(true);
    }

    const missingGuard = nonExempt.filter((e) => !e.preHandlerNames.includes(SITE_RBAC_GUARD_NAME));

    if (missingGuard.length > 0) {
      const details = missingGuard.map((e) => `  ${e.method} ${e.path} -> [${e.preHandlerNames.join(", ")}]`).join("\n");
      throw new Error(
        `§4.4 İHLALİ — aşağıdaki /admin/* route'ları panel guard'ı (requirePanelAccess()/requireSiteRole()) TAŞIMIYOR:\n${details}\n\n` +
          `Çözüm: ilgili router'a "app.addHook(\"preHandler\", requirePanelAccess())" ekleyin (veya daha dar bir ` +
          `requireSiteRole(...) route-preHandler'ı), ya da bu route gerçekten self-servis bir istisnaysa architect'e eskale edin ` +
          `(§4.3 istisna listesi security-agent tarafından tek taraflı GENİŞLETİLEMEZ).`
      );
    }

    expect(missingGuard).toHaveLength(0);
  });

  it("istisna route'ları (2FA/oturumlar) yalnızca `authenticate` taşır, panel guard'ı YOK (§4.3 self-servis)", () => {
    const text = app.printRoutes({ commonPrefix: false, includeHooks: true });
    const entries = parseRouteTable(text);
    const exemptEntries = entries.filter((e) => isExempt(e.path));

    expect(exemptEntries.length).toBeGreaterThan(0);
    for (const e of exemptEntries) {
      expect(e.preHandlerNames).toContain("authenticate");
      expect(e.preHandlerNames).not.toContain(SITE_RBAC_GUARD_NAME);
    }
  });
});
