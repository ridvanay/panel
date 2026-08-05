import { parse as parseCsvSync } from "csv-parse/sync";
import { ValidationError } from "../../../lib/errors";
import type { ImportJobType, ImportSourceFormat } from "../../../schemas/entities";
import { IMPORT_TYPE_TO_FORMATS } from "../import.constants";
import { looksLikeXml } from "./xml-guard";

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"
// Boş bir ZIP (0 içerik) "PK\x05\x06" (End Of Central Directory) ile başlayabilir.
const ZIP_EMPTY_MAGIC = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

function isZip(buffer: Buffer): boolean {
  return buffer.subarray(0, 4).equals(ZIP_MAGIC) || buffer.subarray(0, 4).equals(ZIP_EMPTY_MAGIC);
}

function isValidJson(buffer: Buffer): boolean {
  try {
    const parsed = JSON.parse(buffer.toString("utf8"));
    return Array.isArray(parsed) || (typeof parsed === "object" && parsed !== null);
  } catch {
    return false;
  }
}

function isValidCsv(buffer: Buffer): boolean {
  try {
    const rows = parseCsvSync(buffer, { bom: true, columns: true, relax_column_count: true, skip_empty_lines: true, to: 1 });
    return Array.isArray(rows);
  } catch {
    return false;
  }
}

/**
 * `format` İSTEMCİDEN ALINMAZ (openapi.yaml `POST /admin/import/jobs` açıklaması) — sunucu
 * dosyanın gerçek içeriğinden (yapısal ayrıştırma denemesi) türetir. Geçerlilik matrisi
 * `IMPORT_TYPE_TO_FORMATS`'ta — ihlal (ör. `type: USERS` + JSON dosya) 422 ile reddedilir.
 */
export function detectImportFormat(buffer: Buffer, type: ImportJobType): ImportSourceFormat {
  const allowed = new Set(IMPORT_TYPE_TO_FORMATS[type]);

  if (allowed.has("ZIP")) {
    if (!isZip(buffer)) {
      throw new ValidationError("Bu içe aktarma türü yalnızca ZIP dosyası kabul eder.", { file: ["Geçerli bir ZIP arşivi değil."] });
    }
    return "ZIP";
  }

  if (allowed.has("XML")) {
    if (!looksLikeXml(buffer)) {
      throw new ValidationError("Bu içe aktarma türü yalnızca XML (WXR) dosyası kabul eder.", { file: ["Geçerli bir XML dosyası değil."] });
    }
    return "XML";
  }

  // PAGES/BLOG (CSV|JSON) ve USERS (yalnızca CSV) — önce JSON dene (CSV parser'ı JSON metnini
  // de "tek sütunlu" olarak yanlış kabul edebileceği için JSON önceliklidir).
  if (allowed.has("JSON") && isValidJson(buffer)) {
    return "JSON";
  }
  if (allowed.has("CSV") && isValidCsv(buffer)) {
    return "CSV";
  }

  throw new ValidationError("Dosya biçimi tanınamadı veya bozuk.", {
    file: [`Beklenen biçim(ler): ${IMPORT_TYPE_TO_FORMATS[type].join(", ")}.`],
  });
}
