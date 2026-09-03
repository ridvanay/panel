import type { ProductVariant, ProductVariantOption } from "@/lib/api/types";

/**
 * PDP varyasyon seçici — saf yardımcı fonksiyonlar. `variantKey`/`label`/fiyat/stok her zaman
 * SUNUCUDAN gelir (bkz. `.claude/architect-scope-ecommerce-pro-template.md` §1.5); burada
 * yalnızca "kullanıcının seçtiği eksen değerleri hangi mevcut `ProductVariant` satırına
 * karşılık geliyor" ve "bu değer şu an satılabilir mi" soruları saf veri üzerinden cevaplanır —
 * para/stok HESAPLANMAZ.
 */

/** Tüm eksenler seçiliyse eşleşen `ProductVariant`'ı döner; eksik seçim veya eşleşme yoksa `null`. */
export function findMatchingVariant(
  variants: ProductVariant[],
  axes: ProductVariantOption[],
  selected: Record<string, string>
): ProductVariant | null {
  if (axes.length === 0) return null;
  if (axes.some((axis) => !selected[axis.name])) return null;
  return variants.find((variant) => axes.every((axis) => variant.optionValues[axis.name] === selected[axis.name])) ?? null;
}

/**
 * Bir eksen değerinin, DİĞER seçili eksenlerle birlikte satılabilir (aktif + stoklu) bir
 * varyasyon oluşturup oluşturmadığını döner — henüz seçilmemiş diğer eksenler kısıt uygulamaz.
 */
export function isOptionValueAvailable(
  variants: ProductVariant[],
  axes: ProductVariantOption[],
  selected: Record<string, string>,
  axisName: string,
  value: string
): boolean {
  return variants.some((variant) => {
    if (variant.optionValues[axisName] !== value) return false;
    if (!variant.isActive || variant.stockQuantity <= 0) return false;
    return axes.every((axis) => {
      if (axis.name === axisName) return true;
      const selectedValue = selected[axis.name];
      if (!selectedValue) return true;
      return variant.optionValues[axis.name] === selectedValue;
    });
  });
}

/** Henüz seçim yapılmamış İLK ekseni döner — "Devam etmek için {eksen adı} seçin." ipucu için. */
export function firstMissingAxis(
  axes: ProductVariantOption[],
  selected: Record<string, string>
): ProductVariantOption | null {
  return axes.find((axis) => !selected[axis.name]) ?? null;
}
