/**
 * §10.17 Sayfa içerik bloklarında Grid/Kolon düzeni — bkz. ARCHITECTURE.md §10.17.3/§10.17.4.
 *
 * `Page.blocks` artık iç içe bir `columns` konteyner bloğu içerebilir (derinlik en fazla 1 —
 * bir sütunun İÇİNE `columns`/`hero` KONULAMAZ, bkz. `modules/pages/pages.schemas.ts::ColumnsBlockSchema`).
 * Bu dosya, "sütun içindeki blokları da üst seviyedeki bloklar gibi işle" ihtiyacını duyan TÜM
 * tüketiciler (sanitize, SEO skoru, ileride başka bir tarayıcı/analiz) için TEK, paylaşılan bir
 * düzleştirme yardımcısı sağlar — her tüketicinin kendi (muhtemelen unutulmuş/eksik) özyinelemesini
 * yazmasını önler.
 */

interface RawColumnsData {
  columns?: unknown;
}

/**
 * `blocks` dizisini, `columns` bloklarının `data.columns[].blocks`'unu DOKÜMAN SIRASINDA
 * (sütun 0 → sütun 1 → …) düzleştirerek döner. Konteynerin KENDİSİ de sonuçta yer alır — yalnızca
 * çocukları AYRICA eklenir, konteyner çıkarılmaz (tüketicinin `type === "columns"` bloğunu da
 * görmesi gerekebilir, ör. gelecekte bir "kaç sütun bloğu var" istatistiği).
 *
 * Şema derinliği en fazla 1 ile sınırlı olduğundan (bkz. `ColumnsBlockSchema` — bir sütunun içine
 * `columns` KONULAMAZ) bu fonksiyonun özyinelemeli çağrısı pratikte tek seviye iner; yine de
 * savunma amaçlı genel/özyinelemeli yazılmıştır (bozuk/elle üretilmiş veri karşısında bile sonsuz
 * döngüye girmez — her çağrı yalnızca `data.columns[].blocks` içine iner, kendi girdisini asla
 * tekrar geçirmez).
 */
export function flattenPageBlocks(blocks: unknown[]): unknown[] {
  const result: unknown[] = [];

  for (const block of blocks) {
    result.push(block);

    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type !== "columns") continue;
    if (!b.data || typeof b.data !== "object") continue;

    const { columns } = b.data as RawColumnsData;
    if (!Array.isArray(columns)) continue;

    for (const column of columns) {
      if (!column || typeof column !== "object") continue;
      const columnBlocks = (column as Record<string, unknown>).blocks;
      if (Array.isArray(columnBlocks)) {
        result.push(...flattenPageBlocks(columnBlocks));
      }
    }
  }

  return result;
}
