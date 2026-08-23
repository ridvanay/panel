export interface RouteTableEntry {
  method: string;
  path: string;
  preHandlerNames: string[];
}

/**
 * `.claude/architect-scope-rbac-5-tier.md` §4.4 — Fastify route tablosunu YAPISAL olarak
 * denetlemek için kullanılır (bkz. `tests/integration/admin-panel-guard-route-table.test.ts`).
 *
 * `app.printRoutes({ commonPrefix: false, includeHooks: true })` çıktısını (kutu-çizim
 * karakterli bir ağaç) parse eder. Bu API, `onRoute` hook'unun AKSİNE (route-seviyesi
 * `preHandler`'ı gösterir, plugin-seviyesinde `addHook("preHandler", ...)` ile eklenenleri
 * GÖSTERMEZ — doğrulandı) hem route-seviyesi hem plugin-scope (`addHook`) preHandler'larını
 * BİRLEŞTİRİLMİŞ olarak gösterir. Bu yüzden `requirePanelAccess()`'in `app.addHook("preHandler",
 * ...)` ile eklenmiş olması bu parser için sorun DEĞİL — printRoutes zaten merge edilmiş
 * zinciri basar.
 *
 * Ağaç biçimi: her girinti seviyesi 4 karakterdir (`"├── "`, `"└── "`, `"│   "`, `"    "`).
 * Bir başlık satırı (route path + `(METHOD, ...)`) `"• "` ile BAŞLAMAZ; onu izleyen
 * `"• (preHandler) [...]"` satırı o başlığın preHandler zincirini taşır — HİÇ preHandler
 * satırı YOKSA (route'un preHandler'sız olduğu anlamına gelir) boş dizi kaydedilir (bu,
 * "guard tamamen unutulmuş" senaryosunu YAKALAMAK için kasıtlıdır).
 */
export function parseRouteTable(text: string): RouteTableEntry[] {
  const lines = text.split("\n");
  const pathStack: string[] = [];
  const flat: RouteTableEntry[] = [];

  let current: { methods: string[]; path: string; preHandlerNames: string[] } | null = null;

  const headerRe = /^(.*) \(([A-Z, ]+)\)$/;
  const preHandlerRe = /^•\s*\(preHandler\)\s*(\[.*\])$/;

  function flush() {
    if (!current) return;
    for (const method of current.methods) {
      flat.push({ method, path: current.path, preHandlerNames: current.preHandlerNames });
    }
  }

  for (const rawLine of lines) {
    const m = rawLine.match(/^([│├└─\s]*)(.*)$/);
    if (!m) continue;
    const indent = m[1];
    const content = m[2];
    if (!content) continue;

    if (content.startsWith("•")) {
      const ph = content.match(preHandlerRe);
      if (ph && current) {
        // Fastify her hook adının sonuna görüntüleme amaçlı "()" ekler (örn. "siteRbacGuard()")
        // — testlerin fonksiyon adıyla (`.name`) birebir eşleşebilmesi için burada temizlenir.
        const rawNames: string[] = JSON.parse(ph[1]);
        current.preHandlerNames = rawNames.map((n) => n.replace(/\(\)$/, ""));
      }
      continue;
    }

    const hm = content.match(headerRe);
    if (!hm) continue; // gürültü satırı (test raporlayıcı banner'ı vb.)

    flush();

    const segment = hm[1];
    const methods = hm[2].split(",").map((s) => s.trim());

    // İlk gerçek başlık satırı 4 karakter girintiyle başlar (görünmez kök düğüm nedeniyle) —
    // bu yüzden depthIndex 0-tabanlı olacak şekilde 1 çıkarılır.
    const depthIndex = Math.max(0, indent.length / 4 - 1);
    const prefix = depthIndex === 0 ? "" : (pathStack[depthIndex - 1] ?? "");
    const fullPath = prefix + segment;
    pathStack[depthIndex] = fullPath;

    current = { methods, path: fullPath, preHandlerNames: [] };
  }
  flush();

  return flat;
}
