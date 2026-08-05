import type { ImportFieldMapping, ImportPreviewFieldDto } from "../../../schemas/entities";
import { IMPORT_REQUIRED_TARGET_FIELDS, IMPORT_TARGET_FIELDS } from "../import.constants";

// bkz. lib/slug.ts::COMBINING_MARKS — NFKD sonrası ayrışan aksan işaretlerini (Unicode
// combining diacritical marks bloğu, U+0300–U+036F) söker. Kaynak dosyada literal
// non-ASCII karakter bulundurmamak için charCode ile inşa edilir.
const COMBINING_MARKS = new RegExp(String.fromCharCode(0x5b, 0x5c, 0x75, 0x30, 0x33, 0x30, 0x30, 0x2d, 0x5c, 0x75, 0x30, 0x33, 0x36, 0x66, 0x5d), "g");

/** Karşılaştırma için: küçük harfe çevirir, aksanları söker, alfasayısal olmayanı atar. */
function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Hedef şema alanı → kabul edilen kaynak sütun adı eş anlamlıları (TR/EN karışık, CSV/JSON
 * başlıkları serbest metin olabildiği için). Karşılaştırma `normalize()` sonrası yapılır,
 * bu yüzden burada boşluk/kasa/alt çizgi farkı ÖNEMLİ DEĞİL.
 */
const SYNONYMS: Record<string, string[]> = {
  title: ["title", "baslik", "başlık", "name"],
  slug: ["slug", "url"],
  excerpt: ["excerpt", "ozet", "özet", "summary"],
  contentHtml: ["contenthtml", "content", "icerik", "içerik", "body", "gövde", "govde"],
  coverImageUrl: ["coverimageurl", "coverimage", "kapakgorseli", "kapak_gorseli", "kapakresmi"],
  status: ["status", "durum"],
  categoryName: ["categoryname", "category", "kategori"],
  seoTitle: ["seotitle", "seo_title", "seobaslik"],
  seoDescription: ["seodescription", "seo_description", "seoaciklama"],
  ogTitle: ["ogtitle", "og_title"],
  ogImageUrl: ["ogimageurl", "og_image", "ogimage"],
  canonicalUrl: ["canonicalurl", "canonical"],
  noIndex: ["noindex", "no_index"],
  publishedAt: ["publishedat", "published_at", "yayintarihi", "yayintarih", "date"],
  authorEmail: ["authoremail", "author_email", "yazar", "yazareposta", "yazar_eposta"],
  name: ["name", "ad", "isim", "adsoyad"],
  email: ["email", "eposta", "e-posta", "e_posta"],
  role: ["role", "rol"],
};

/**
 * Kaynak sütun adlarını (`sourceFields`, dosyadaki sırayla) `targetType` için tanımlı hedef
 * alanlara otomatik eşler. Birebir normalize edilmiş isim eşleşmesi ya da `SYNONYMS` tablosu
 * kullanılır; eşleşmeyen sütun `unmatched` (yok sayılır, hata değildir) olarak işaretlenir.
 */
export function suggestFieldMapping(
  sourceFields: string[],
  targetType: "PAGES" | "BLOG" | "USERS"
): { fields: ImportPreviewFieldDto[]; suggestedMapping: ImportFieldMapping; canStart: boolean } {
  const targetFields = IMPORT_TARGET_FIELDS[targetType];
  const requiredFields = IMPORT_REQUIRED_TARGET_FIELDS[targetType];

  const targetByNormalized = new Map<string, string>();
  for (const target of targetFields) {
    targetByNormalized.set(normalize(target), target);
    for (const [synTarget, aliases] of Object.entries(SYNONYMS)) {
      if (synTarget !== target) continue;
      for (const alias of aliases) targetByNormalized.set(normalize(alias), target);
    }
  }

  const fields: ImportPreviewFieldDto[] = [];
  const suggestedMapping: ImportFieldMapping = {};
  const matchedTargets = new Set<string>();

  for (const sourceField of sourceFields) {
    const target = targetByNormalized.get(normalize(sourceField)) ?? null;
    fields.push({ sourceField, targetField: target, status: target ? "matched" : "unmatched" });
    suggestedMapping[sourceField] = target;
    if (target) matchedTargets.add(target);
  }

  for (const required of requiredFields) {
    if (!matchedTargets.has(required)) {
      fields.push({ sourceField: required, targetField: required, status: "missingRequired" });
    }
  }

  const canStart = requiredFields.every((f) => matchedTargets.has(f));

  return { fields, suggestedMapping, canStart };
}

/** `fieldMapping`'i bir kaynak satıra uygular → `{ hedefAlan: değer }`. Eşleşmeyen/`null` sütunlar YOK SAYILIR. */
export function applyFieldMapping(record: Record<string, unknown>, mapping: ImportFieldMapping): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [sourceField, targetField] of Object.entries(mapping)) {
    if (!targetField) continue;
    if (record[sourceField] !== undefined) result[targetField] = record[sourceField];
  }
  return result;
}
