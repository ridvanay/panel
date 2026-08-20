/**
 * §10.19 (v3) Sayfa içerik bloklarında hiyerarşik `container` mimarisi — bkz.
 * `.claude/design-notes-page-builder-containers.md` §4/§5.1 ve ARCHITECTURE.md §10.19
 * (§10.17'ye supersede eder; §10.17.3/§10.17.4'teki `columns` v1/v2 tarihi hâlâ geçerli
 * bağlam olarak korunur).
 *
 * `Page.blocks` artık KEYFİ DERİNLİKTE iç içe `container` düğümleri içerebilir
 * (`MAX_CONTAINER_DEPTH` ile sınırlı — kök seviye = 1). v1/v2'de üretilmiş ama artık HİÇ
 * ÜRETİLMEYEN `type: "columns"` şekli de okuma/kabul amaçlı desteklenir; normalize
 * SONRASI ağaçta her `columns` bloğu `1 (dış konteyner) + N (sütun sarmalayıcı) + M (sütun
 * içi bloklar)` düğüme karşılık gelir — bu dosyadaki her iki yardımcı da (tarayıcı VE
 * düzleştirici) bu eşdeğerliği yansıtır.
 *
 * Bu dosya, "iç içe geçmiş düğümleri de üst seviyedeki bloklar gibi işle" ihtiyacını duyan
 * TÜM tüketiciler (zod ön-tarama, sanitize, SEO skoru, ileride başka bir tarayıcı/analiz)
 * için TEK, paylaşılan bir yapı-tarama/düzleştirme çifti sağlar — her tüketicinin kendi
 * (muhtemelen unutulmuş/eksik/güvensiz) özyinelemesini yazmasını önler.
 *
 * GÜVENLİK — İKİ FONKSİYON DA İTERATİFTİR (explicit stack), ÖZYİNELEME YOK:
 * `scanPageNodeStructure`, zod'un `z.lazy`/`.transform` ile yazılmış özyinelemeli
 * `PageNodeSchema` parse'ından ÖNCE çağrılmak ZORUNDADIR — derinlik/genişlik/toplam-düğüm
 * sınırını zod'un KENDİ özyinelemeli parse'ının İÇİNDE kontrol etmek çok geçtir: parse'ın
 * kendisi, kontrolü henüz yapmadan `RangeError: Maximum call stack size exceeded` fırlatarak
 * çökebilir (bkz. tasarım notu §4.1, security-agent ön denetimi §13.1). Her iki fonksiyon da
 * ayrıca döngüye mutlak bir tavan (`ABSOLUTE_VISIT_CAP`) taşır — patolojik/elle üretilmiş,
 * olağandışı genişlikte bir payload'a karşı savunma.
 */

/** Kök = 1. Bir konteyner en fazla 4. seviyede olabilir → yaprak bloklar en fazla 5. seviyede. */
export const MAX_CONTAINER_DEPTH = 4;
/** Bir konteynerin doğrudan çocuk sayısı (kanonik `container.children` VEYA normalize-sonrası legacy `columns` sütunu/sütun-içi-blok sayısı — v2'nin 20 ve 24'ünün birleşimi). */
export const MAX_CHILDREN_PER_CONTAINER = 24;
/** Sayfa başına TOPLAM düğüm (konteynerler DAHİL) tavanı — v2'nin 200'ünden yükseltildi. */
export const MAX_TOTAL_PAGE_NODES = 300;
/** Patolojik/elle üretilmiş girdide `while` döngüsünün mutlak tavanı (döngüsel/olağandışı geniş yapıya karşı). */
const ABSOLUTE_VISIT_CAP = 100_000;

export interface PageNodeStructureReport {
  totalNodes: number;
  maxContainerDepth: number;
  maxChildren: number;
  truncated: boolean;
}

interface RawColumnsData {
  columns?: unknown;
}

interface RawColumn {
  blocks?: unknown;
}

/** Yalnızca `type` alanına bakarak bir düğümün (kanonik veya legacy) konteyner olup olmadığını söyler. */
function isContainerLikeNode(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const type = (node as Record<string, unknown>).type;
  return type === "container" || type === "columns";
}

/**
 * Legacy `columns` bloğunun her SÜTUNU, normalize-SONRASI ağaçta ayrı bir konteyner düğümü
 * haline gelir (bkz. `pages.schemas.ts::legacyColumnsToContainer`). Ölçümün/düzleştirmenin
 * normalize SONRASI ağacı doğru yansıtması için burada da aynı iki seviyeli yapı SENTETİK
 * olarak üretilir: sütun başına `{ type: "container", children: column.blocks }`.
 */
function legacyColumnsAsContainerChildren(rawColumns: unknown): { type: "container"; children: unknown[] }[] {
  if (!Array.isArray(rawColumns)) return [];
  return rawColumns.map((column) => {
    const col = column && typeof column === "object" ? (column as RawColumn) : {};
    return { type: "container" as const, children: Array.isArray(col.blocks) ? (col.blocks as unknown[]) : [] };
  });
}

/**
 * Bir düğümün ÇOCUKLARINI döner — hem kanonik (`container.children`) hem legacy (`columns` →
 * `data.columns[].blocks`, sentetik sütun-konteyner sarmalayıcısı ÜZERİNDEN) şekli tanır.
 */
function childrenOfRawNode(node: unknown): unknown[] {
  if (!node || typeof node !== "object") return [];
  const n = node as Record<string, unknown>;

  if (n.type === "container") {
    return Array.isArray(n.children) ? (n.children as unknown[]) : [];
  }

  if (n.type === "columns") {
    if (!n.data || typeof n.data !== "object") return [];
    return legacyColumnsAsContainerChildren((n.data as RawColumnsData).columns);
  }

  return [];
}

/**
 * İTERATİF (explicit stack) — ÖZYİNELEME YOK. Bu fonksiyon, zod'un özyinelemeli
 * `PageNodeSchema` parse'ından ÖNCE çağrılmak ZORUNDADIR: derinlik sınırını zod içinde
 * kontrol etmek, kontrolü yapan parse'ın kendisi stack'i taşırdığı için ÇOK GEÇTİR (bkz.
 * tasarım notu §4.1).
 *
 * (b) Mimari netleştirme — KÖK dizi (`raw`) bir "konteyner" DEĞİLDİR ve kendi uzunluğu
 * `maxChildren` ölçümüne/sınırına DAHİL EDİLMEZ (v1/v2'de kökte ayrı bir "max children"
 * sınırı YOKTU, yalnızca toplam düğüm tavanı vardı — bu davranış KORUNUR, geriye dönük
 * daralma yaratılmaz). Yalnızca gerçek `container.children` (veya normalize-sonrası
 * eşdeğeri) dizileri `MAX_CHILDREN_PER_CONTAINER` sınırına tabidir; bu, aşağıdaki döngüde
 * `childrenOfRawNode` yalnızca ZATEN BİR KONTEYNER OLAN düğümler için boş olmayan bir dizi
 * döndürdüğü için doğal olarak sağlanır (kök öğeleri kendileri `childrenOfRawNode`'a HİÇ
 * verilmez, yalnızca birer `{node, depth:1}` girdisi olarak stack'e konur).
 */
export function scanPageNodeStructure(raw: unknown[]): PageNodeStructureReport {
  let totalNodes = 0;
  let maxContainerDepth = 0;
  let maxChildren = 0;
  let visits = 0;

  const stack: { node: unknown; depth: number }[] = raw.map((node) => ({ node, depth: 1 }));

  while (stack.length > 0) {
    if (++visits > ABSOLUTE_VISIT_CAP) return { totalNodes, maxContainerDepth, maxChildren, truncated: true };

    const { node, depth } = stack.pop()!;
    totalNodes += 1;

    if (isContainerLikeNode(node) && depth > maxContainerDepth) maxContainerDepth = depth;
    // Sınırı AŞTIYSA daha derine İNMEYİZ: ihlal zaten raporlanacak, gereksiz iş yapmayız.
    if (depth > MAX_CONTAINER_DEPTH) continue;

    const children = childrenOfRawNode(node);
    if (children.length > maxChildren) maxChildren = children.length;
    for (const child of children) stack.push({ node: child, depth: depth + 1 });
  }

  return { totalNodes, maxContainerDepth, maxChildren, truncated: false };
}

interface FlattenFrame {
  items: unknown[];
  index: number;
}

/**
 * `blocks` dizisini, konteyner düğümlerinin (kanonik `container.children` VEYA legacy
 * `columns.data.columns[].blocks`) içeriğini DOKÜMAN SIRASINDA (soldan sağa / yukarıdan
 * aşağıya, sütun 0 → sütun 1 → …) düzleştirerek döner. Konteynerin KENDİSİ de sonuçta yer
 * alır — yalnızca çocukları AYRICA eklenir, konteyner çıkarılmaz.
 *
 * İMZASI DEĞİŞMEZ (seo-score.ts tüketicisi korunur). GÖVDESİ İTERATİFTİR (explicit stack,
 * ÖZYİNELEME YOK) — bu fonksiyon hem zaten şemadan geçmiş veri (SEO skoru DB'den doğrudan
 * okur, `blocks` Prisma `Json` kolonu tip güvenli değildir) hem de tarihsel/legacy kayıtlar
 * üzerinde çalışır; derinlik veya döngüsel/olağandışı genişlik ne olursa olsun JS çağrı
 * yığınını TAŞIRMAZ (bkz. tasarım notu §4.2 — mutlak tavan `ABSOLUTE_VISIT_CAP`).
 */
export function flattenPageBlocks(blocks: unknown[]): unknown[] {
  const result: unknown[] = [];
  const stack: FlattenFrame[] = [{ items: blocks, index: 0 }];
  let visits = 0;

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.index >= frame.items.length) {
      stack.pop();
      continue;
    }
    if (++visits > ABSOLUTE_VISIT_CAP) break;

    const node = frame.items[frame.index];
    frame.index += 1;
    result.push(node);

    if (!node || typeof node !== "object") continue;
    const n = node as Record<string, unknown>;

    if (n.type === "container") {
      const children = Array.isArray(n.children) ? (n.children as unknown[]) : [];
      if (children.length > 0) stack.push({ items: children, index: 0 });
      continue;
    }

    if (n.type === "columns") {
      if (!n.data || typeof n.data !== "object") continue;
      const { columns } = n.data as RawColumnsData;
      if (!Array.isArray(columns)) continue;

      // Sütunları doküman sırasında (0 → 1 → …) düzleştirmek için TEK bir birleşik dizi
      // olarak push ederiz (legacy şekilde sütunun kendisi ayrı bir düğüm olarak GÖRÜNMEZ,
      // yalnızca içindeki gerçek bloklar — bkz. `page-blocks-flatten.test.ts` mevcut davranış).
      const allColumnBlocks: unknown[] = [];
      for (const column of columns) {
        if (!column || typeof column !== "object") continue;
        const columnBlocks = (column as Record<string, unknown>).blocks;
        if (Array.isArray(columnBlocks)) allColumnBlocks.push(...columnBlocks);
      }
      if (allColumnBlocks.length > 0) stack.push({ items: allColumnBlocks, index: 0 });
    }
  }

  return result;
}
