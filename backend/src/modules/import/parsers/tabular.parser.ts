import { parse as parseCsvSync } from "csv-parse/sync";
import { ValidationError } from "../../../lib/errors";
import type { ImportSourceFormat } from "../../../schemas/entities";

export interface TabularParseResult {
  /** Dosyadaki sütun/özellik adları, İLK karşılaşılan sırayla (eşleştirme dropdown'ını besler). */
  sourceFields: string[];
  /** Ham kayıtlar — CSV'de başlık satırı HARİÇ 1-tabanlı `rowNumber` ile hizalı (bkz. çağıran taraf). */
  records: Record<string, unknown>[];
}

/**
 * CSV: BOM'lu UTF-8, tırnaklı alan, gömülü `,`/`\n`/`\r\n`, düzensiz sütun sayısı tolere edilir
 * (bkz. ARCHITECTURE.md §10.8.3 — `csv-parse` seçim gerekçesi).
 * JSON: bir kayıt DİZİSİ ya da `{ items: [...] }` olabilir (bkz. §10.8.7).
 */
export function parseTabular(buffer: Buffer, format: ImportSourceFormat): TabularParseResult {
  if (format === "CSV") {
    let rows: Record<string, unknown>[];
    try {
      rows = parseCsvSync(buffer, {
        bom: true,
        columns: true,
        relax_column_count: true,
        skip_empty_lines: true,
        trim: true,
      }) as Record<string, unknown>[];
    } catch (err) {
      throw new ValidationError("CSV dosyası ayrıştırılamadı.", { file: [(err as Error).message] });
    }

    const sourceFields = rows.length > 0 ? Object.keys(rows[0]!) : [];
    return { sourceFields, records: rows };
  }

  if (format === "JSON") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(buffer.toString("utf8"));
    } catch (err) {
      throw new ValidationError("JSON dosyası ayrıştırılamadı.", { file: [(err as Error).message] });
    }

    const items = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { items?: unknown }).items)
        ? ((parsed as { items: unknown[] }).items as unknown[])
        : null;

    if (!items) {
      throw new ValidationError("JSON dosyası bir kayıt dizisi ya da `{ items: [...] }` olmalı.", {
        file: ["Beklenen şekil: dizi veya { items: [...] }."],
      });
    }

    const records = items.map((item, index) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        throw new ValidationError(`JSON kaydı #${index + 1} bir nesne olmalı.`, { [`items.${index}`]: ["Nesne bekleniyor."] });
      }
      return item as Record<string, unknown>;
    });

    const sourceFields = records.length > 0 ? Object.keys(records[0]!) : [];
    return { sourceFields, records };
  }

  throw new ValidationError("Desteklenmeyen tablo biçimi.");
}
