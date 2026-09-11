/**
 * Kuruş/cent cinsinden depolanan bir fiyatı yerelleştirilmiş TL (veya `currency`) gösterimine
 * çevirir — bkz. backend `ProductSchema.priceCents` notu: para HER ZAMAN Int kuruş/cent, float
 * KESİNLİKLE YOK. Gösterim amaçlı `/100` bölmesi YALNIZCA burada, tek noktada yapılır.
 *
 * `locale` opsiyoneldir ve varsayılanı `"tr-TR"`dir — projedeki TÜM diğer çağıranlar (admin,
 * checkout, sepet vb.) bu varsayılanla DEĞİŞMEDEN çalışmaya devam eder (geriye dönük uyumluluk).
 * Çok dilli/çok para birimli yüzeylerde (ör. `/doctors/[slug]`, doktora özel `currency` +
 * ziyaretçinin site diline göre biçimlendirme) çağıran taraf `contentLocaleToIntl` ile üretilen
 * bir BCP-47 etiketi geçebilir.
 */
export function formatPriceFromCents(cents: number, currency: string, locale = "tr-TR"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}
