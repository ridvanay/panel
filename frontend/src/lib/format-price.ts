/**
 * Kuruş/cent cinsinden depolanan bir fiyatı yerelleştirilmiş TL (veya `currency`) gösterimine
 * çevirir — bkz. backend `ProductSchema.priceCents` notu: para HER ZAMAN Int kuruş/cent, float
 * KESİNLİKLE YOK. Gösterim amaçlı `/100` bölmesi YALNIZCA burada, tek noktada yapılır.
 */
export function formatPriceFromCents(cents: number, currency: string): string {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(cents / 100);
}
