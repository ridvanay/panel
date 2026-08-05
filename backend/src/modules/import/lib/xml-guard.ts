import { ValidationError } from "../../../lib/errors";
import { WXR_PROLOG_SCAN_BYTES } from "../import.constants";

/**
 * §10.8.6 Güvenlik — XXE / billion-laughs, savunma katmanı 2/3 (katman 1: `saxes`'in
 * yapısal olarak dış varlık çözümlemesi yapmaması — bkz. wxr.parser.ts).
 *
 * Dosyanın yalnızca İLK 64 KB'ı (prolog + DOCTYPE, XML spesifikasyonuna göre yalnızca orada
 * bulunabilir) taranır; `<!DOCTYPE` veya `<!ENTITY` görülürse dosya REDDEDİLİR. Bilerek TÜM
 * dosya değil ilk parça taranır — büyük bir WXR'ı (50 MB'a kadar) baştan sona `indexOf` ile
 * taramak gereksiz CPU/gecikme demektir; DTD'ler prolog dışında yasa dışıdır zaten.
 */
export function assertNoDoctypeOrEntity(buffer: Buffer): void {
  const prolog = buffer.subarray(0, WXR_PROLOG_SCAN_BYTES).toString("utf8");
  if (/<!DOCTYPE/i.test(prolog) || /<!ENTITY/i.test(prolog)) {
    throw new ValidationError("XML DTD/varlık tanımı içeren dosyalar güvenlik nedeniyle kabul edilmez.", {
      file: ["DOCTYPE veya ENTITY tanımı tespit edildi."],
    });
  }
}

const BOM = String.fromCharCode(0xfeff);

/** İçerik `<` ile (BOM/boşluk sonrası) başlıyorsa büyük olasılıkla XML — biçim tespiti için kullanılır. */
export function looksLikeXml(buffer: Buffer): boolean {
  const text = buffer.subarray(0, 512).toString("utf8");
  const trimmed = (text.startsWith(BOM) ? text.slice(1) : text).trimStart();
  return trimmed.startsWith("<");
}
