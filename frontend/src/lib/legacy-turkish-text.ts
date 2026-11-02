/**
 * Paket AH — Türkçe kaldırıldı. Panelden (DB) gelen eski footer/etiket verisi Türkçe kalmış olabilir
 * ("Branşlar", "Yasal", "Tüm hakları saklıdır"); ziyaretçiye Türkçe metin gösterilmemesi için bu kayıtlar
 * render anında sözlükteki İngilizce+çeviri karşılığıyla değiştirilir. Veri değiştirilmez.
 *
 * Tespit bilinçli olarak dar tutulur: yalnızca Türkçeye özgü harfler (ğ, ı, İ) ve yaygın Türkçe
 * sözcükler. `ş`/`ç`/`ö`/`ü` Romence, Sırpça, Almanca, Fransızca metinlerde meşrudur; tek başlarına tespit sayılmaz.
 */
const TURKISH_ONLY_LETTERS = /[ğĞıİ]/;
const TURKISH_WORDS = /(?:^|[\s"'`(>])(tüm|hakları|saklıdır|branşlar|yasal|hekim\w*|randevu\w*|hakkımızda|iletişim|gizlilik|için|ve|ile)(?=$|[\s"'`.,:;!?)<])/i;

export function looksTurkish(text: string | null | undefined): boolean {
  if (!text) return false;
  return TURKISH_ONLY_LETTERS.test(text) || TURKISH_WORDS.test(text);
}

/** Metin Türkçe görünüyorsa `fallback`, değilse metnin kendisi. */
export function replaceIfTurkish(text: string | null | undefined, fallback: string): string {
  return text && !looksTurkish(text) ? text : fallback;
}

/** Bilinen eski Türkçe footer sütun başlıkları → sözlük anahtarı. */
export function legacyFooterTitleKey(title: string): "servicesHeading" | "legalHeading" | null {
  const t = title.trim().toLocaleLowerCase("tr");
  if (t === "branşlar" || t === "uzmanlıklar" || t === "hizmetler") return "servicesHeading";
  if (t === "yasal" || t === "yasal bilgiler") return "legalHeading";
  return null;
}
