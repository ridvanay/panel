import { z } from "zod";
import { slugify } from "../../../lib/slug";
import { ValidationError } from "../../../lib/errors";

/**
 * Varyasyon eksen/kombinasyon sınırları — `.claude/architect-scope-ecommerce-pro-template.md`
 * §1.1 (bağlayıcı): en fazla 2 eksen, eksen başına en fazla 12 değer, ürün başına en fazla 60
 * varyasyon (2×12 matrisin tavanı 144'tür; 60 pratik bir güvenlik tavanıdır).
 */
export const MAX_VARIANT_AXES = 2;
export const MAX_VALUES_PER_AXIS = 12;
export const MAX_VARIANTS_PER_PRODUCT = 60;

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export const ProductVariantOptionValueSchema = z.object({
  value: z.string().min(1).max(40),
  swatchHex: z.string().regex(HEX_COLOR_PATTERN, "swatchHex `#RRGGBB` biçiminde olmalıdır.").nullable().optional(),
});

/**
 * Bir varyasyon EKSENİ (ör. "Renk"). `SWATCH` türünde HER değer için `swatchHex` ZORUNLU,
 * `TEXT` türünde `swatchHex` gönderilMEMELİdir (openapi.yaml::ProductVariantOption.values notu).
 */
export const ProductVariantOptionSchema = z
  .object({
    name: z.string().min(1).max(40),
    type: z.enum(["SWATCH", "TEXT"]),
    values: z.array(ProductVariantOptionValueSchema).min(1).max(MAX_VALUES_PER_AXIS),
  })
  .superRefine((axis, ctx) => {
    axis.values.forEach((value, index) => {
      if (axis.type === "SWATCH" && !value.swatchHex) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "`type: SWATCH` olan eksenlerde her değer için `swatchHex` zorunludur.",
          path: ["values", index, "swatchHex"],
        });
      }
      if (axis.type === "TEXT" && value.swatchHex !== undefined && value.swatchHex !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "`type: TEXT` olan eksenlerde `swatchHex` gönderilmemelidir.",
          path: ["values", index, "swatchHex"],
        });
      }
    });

    const seenValues = new Set(axis.values.map((value) => value.value.trim().toLowerCase()));
    if (seenValues.size !== axis.values.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Aynı eksende tekrar eden bir değer olamaz.", path: ["values"] });
    }
  });

export type ProductVariantOption = z.infer<typeof ProductVariantOptionSchema>;

/** `Product.variantOptions` — `CreateProductRequest`/`UpdateProductRequest` ve DB satırının ortak şekli. */
export const ProductVariantOptionsSchema = z
  .array(ProductVariantOptionSchema)
  .max(MAX_VARIANT_AXES)
  .superRefine((axes, ctx) => {
    const seenNames = new Set(axes.map((axis) => axis.name.trim().toLowerCase()));
    if (seenNames.size !== axes.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Eksen adları (`name`) benzersiz olmalıdır." });
    }
  });

/**
 * Deterministik kombinasyon anahtarı: her eksen adı+değeri slugify edilir (`ad:değer`), bu
 * çiftler ALFABETİK sıralanır ve `|` ile birleştirilir (ör. `"beden:l|renk:antrasit"`).
 * `@@unique([productId, variantKey])` ile aynı kombinasyonun iki kez oluşturulmasını DB
 * seviyesinde engeller. Sunucu türetir — istemci ASLA göndermez (bkz. openapi.yaml
 * `ProductVariant.variantKey` notu).
 */
export function deriveVariantKey(optionValues: Record<string, string>): string {
  return Object.entries(optionValues)
    .map(([name, value]) => `${slugify(name)}:${slugify(value)}`)
    .sort()
    .join("|");
}

/**
 * `optionValues`'un ürünün `variantOptions` eksen tanımıyla BİREBİR eşleştiğini doğrular —
 * eksik/fazla eksen ya da o eksende tanımsız bir değer varsa `422 VALIDATION_ERROR` fırlatır
 * (bkz. openapi.yaml `POST .../variants` açıklaması).
 */
export function assertOptionValuesMatchAxes(optionValues: Record<string, string>, axes: ProductVariantOption[]): void {
  const axisNames = new Set(axes.map((axis) => axis.name));
  const providedNames = Object.keys(optionValues);

  const missing = axes.filter((axis) => !(axis.name in optionValues)).map((axis) => axis.name);
  const unknown = providedNames.filter((name) => !axisNames.has(name));

  const issues: string[] = [
    ...missing.map((name) => `"${name}" ekseni için bir değer eksik.`),
    ...unknown.map((name) => `"${name}" tanımlı bir eksen değil.`),
  ];

  if (issues.length === 0) {
    for (const axis of axes) {
      const provided = optionValues[axis.name];
      const allowedValues = new Set(axis.values.map((value) => value.value));
      if (provided !== undefined && !allowedValues.has(provided)) {
        issues.push(`"${axis.name}" ekseni için "${provided}" geçerli bir değer değil.`);
      }
    }
  }

  if (issues.length > 0) {
    throw new ValidationError("`optionValues`, ürünün `variantOptions` eksen tanımıyla eşleşmiyor.", {
      optionValues: issues,
    });
  }
}

/**
 * Sunucu türetir: eksen SIRASINA göre (`Product.variantOptions` dizisindeki sıra, alfabetik
 * DEĞİL) `"değer / değer"` (ör. `"Antrasit / L"`). `OrderItem.variantLabel` snapshot'ı BUNDAN
 * yazılır; `CartItem`/`Product` DTO'larındaki `label`/`variantLabel` de her okumada BUNDAN
 * türetilir (CartItem satırında AYRICA saklanmaz).
 */
export function buildVariantLabel(optionValues: Record<string, string>, axes: ProductVariantOption[]): string {
  return axes
    .map((axis) => optionValues[axis.name])
    .filter((value): value is string => value !== undefined)
    .join(" / ");
}

/** Ürün başına en fazla `MAX_VARIANTS_PER_PRODUCT` varyasyon — §1.1 güvenlik tavanı. */
export function assertVariantCountWithinLimit(currentCount: number): void {
  if (currentCount >= MAX_VARIANTS_PER_PRODUCT) {
    throw new ValidationError(`Bir ürün en fazla ${MAX_VARIANTS_PER_PRODUCT} varyasyona sahip olabilir.`, {
      optionValues: [`Bu ürün zaten ${MAX_VARIANTS_PER_PRODUCT} varyasyona sahip.`],
    });
  }
}
