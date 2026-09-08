import { z } from "zod";
import { BillingTypeSchema, OrderStatusSchema } from "../../schemas/entities";
import { CursorQuerySchema } from "../../schemas/common";
import { CheckoutAddressInputSchema } from "../checkout/checkout.schemas";
import { isValidTcKimlikNo } from "../../lib/tr-identity";

export const ListOrdersQuerySchema = CursorQuerySchema.extend({
  status: OrderStatusSchema.optional(),
});

export const OrderIdParamSchema = z.object({
  orderId: z.string().uuid(),
});

/**
 * `.claude/architect-scope-order-management-pro.md` §4.1/§5.2 (bağlayıcı) — geçiş tablosu
 * genişledi: `PENDING -> CANCELLED`, `PAID -> ON_HOLD|SHIPPED|FULFILLED`,
 * `ON_HOLD -> PAID|CANCELLED`, `SHIPPED -> FULFILLED`. Diğer TÜM durum kombinasyonları route
 * handler'da (bkz. orders.routes.ts::ALLOWED_TRANSITIONS) 409 ile reddedilir.
 *
 * `status: SHIPPED` iken `trackingNumber` ZORUNLUDUR (§2.4, önceki tur) — eksikse 422.
 * `shippingCarrier` her zaman opsiyoneldir (serbest metin, enum v1'de açılmaz).
 * `status: CANCELLED` iken `cancellationReason` ZORUNLUDUR (§5.2) — eksikse 422.
 * `cancellationReason`/`confirmWithoutRefund` YALNIZCA `status: CANCELLED` iken gönderilebilir;
 * başka bir hedefte gönderilirse 422 (sessizce yutulmaz).
 * `.claude/architect-scope-search-and-order-emails.md` §2.5 (bağlayıcı) — `sendCustomerEmail`
 * artık `CANCELLED` VEYA `SHIPPED` hedeflerinde gönderilebilir; başka bir hedefte 422.
 */
export const UpdateOrderStatusRequestSchema = z
  .object({
    status: z.enum(["PAID", "ON_HOLD", "SHIPPED", "FULFILLED", "CANCELLED"]),
    trackingNumber: z.string().min(1).max(100).optional(),
    shippingCarrier: z.string().min(1).max(100).optional(),
    cancellationReason: z.string().min(1).max(500).optional(),
    // Varsayılan `true` — burada `.default()` UYGULANMAZ (aksi hâlde `status !== "CANCELLED"`
    // dalında "gönderilmiş mi?" ayrımı YAPILAMAZ). Uygulama varsayılanı route handler'da
    // (`sendCustomerEmail ?? true`) uygulanır.
    sendCustomerEmail: z.boolean().optional(),
    confirmWithoutRefund: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === "SHIPPED" && !data.trackingNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trackingNumber"],
        message: "SHIPPED durumuna geçişte kargo takip numarası zorunludur.",
      });
    }

    if (data.status === "CANCELLED") {
      if (!data.cancellationReason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cancellationReason"],
          message: "İptal nedeni zorunludur.",
        });
      }
    } else {
      if (data.cancellationReason !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cancellationReason"],
          message: "cancellationReason yalnızca status=CANCELLED iken gönderilebilir.",
        });
      }
      if (data.confirmWithoutRefund !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["confirmWithoutRefund"],
          message: "confirmWithoutRefund yalnızca status=CANCELLED iken gönderilebilir.",
        });
      }
    }

    // `.claude/architect-scope-search-and-order-emails.md` §2.5 (bağlayıcı) — `sendCustomerEmail`
    // artık `CANCELLED` VEYA `SHIPPED` hedeflerinde gönderilebilir; diğer hedeflerde hâlâ 422.
    if (data.sendCustomerEmail !== undefined && data.status !== "CANCELLED" && data.status !== "SHIPPED") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sendCustomerEmail"],
        message: "sendCustomerEmail yalnızca status=CANCELLED veya status=SHIPPED iken gönderilebilir.",
      });
    }
  });

/** `POST /:orderId/refund` — yalnızca `PAID`/`SHIPPED`/`FULFILLED`/`ON_HOLD` siparişlerde kabul edilir (bkz. orders.routes.ts). */
export const RefundOrderRequestSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

// ---------- `.claude/architect-scope-order-management-pro.md` §5.3 — `PATCH /admin/orders/{orderId}` ----------

/**
 * `checkout.schemas.ts::CheckoutAddressInputSchema` İLE BİREBİR AYNI şema — yeniden yazılmaz,
 * DOĞRUDAN import edilir (§5.3, bağlayıcı; `checkout/**` DOKUNULMAZ, yalnızca IMPORT edilir).
 */
export const OrderAddressInputSchema = CheckoutAddressInputSchema;
export type OrderAddressInput = z.infer<typeof OrderAddressInputSchema>;

const ORDER_TAX_NUMBER_REGEX = /^\d{10}$/;
const REQUIRED_FIELD_MESSAGE = "Bu alan zorunludur.";

/**
 * `checkout.schemas.ts::CheckoutBillingInputSchema`'nın (INDIVIDUAL/CORPORATE koşullu
 * zorunlulukları + TCKN checksum'ı — `lib/tr-identity.ts::isValidTcKimlikNo` ile AYNI fonksiyon
 * reuse edilir) sipariş düzenleme bağlamına uyarlanmış hâli (§5.3, bağlayıcı). `sameAsShipping`
 * bayrağı BİLİNÇLİ OLARAK YOKTUR — istemci düzenleme formunda adresi HER ZAMAN tam gönderir,
 * bu yüzden `address` burada (checkout'un aksine) HER ZAMAN ZORUNLUDUR. Format regex'leri
 * (`taxNumber`) checkout.schemas.ts'te export edilmediği için burada AYNI kalıpla yeniden
 * tanımlanır (kaçınılmaz küçük sapma — çekirdek doğrulama mantığı [TCKN checksum, adres şekli]
 * import edilerek AYNI tutulur).
 */
export const OrderBillingInputSchema = z
  .object({
    billingType: BillingTypeSchema,
    companyName: z.string().min(1, "Kurumsal fatura için firma unvanı zorunludur.").max(200, "Kurumsal fatura için firma unvanı zorunludur.").optional(),
    taxOffice: z.string().min(1, REQUIRED_FIELD_MESSAGE).max(100, REQUIRED_FIELD_MESSAGE).optional(),
    taxNumber: z.string().regex(ORDER_TAX_NUMBER_REGEX, "Vergi numarası 10 haneli olmalıdır.").optional(),
    nationalId: z.string().optional(),
    address: CheckoutAddressInputSchema,
  })
  .superRefine((data, ctx) => {
    if (data.billingType === "CORPORATE") {
      if (!data.companyName) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["companyName"], message: "Kurumsal fatura için firma unvanı zorunludur." });
      }
      if (!data.taxNumber) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["taxNumber"], message: "Vergi numarası 10 haneli olmalıdır." });
      }
      if (data.nationalId !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nationalId"], message: "Kurumsal faturada T.C. kimlik numarası gönderilemez." });
      }
    } else {
      if (data.companyName !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["companyName"], message: "Bireysel faturada firma unvanı gönderilemez." });
      }
      if (data.taxOffice !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["taxOffice"], message: "Bireysel faturada vergi dairesi gönderilemez." });
      }
      if (data.taxNumber !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["taxNumber"], message: "Bireysel faturada vergi numarası gönderilemez." });
      }
      if (data.nationalId !== undefined && !isValidTcKimlikNo(data.nationalId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nationalId"], message: "Geçerli bir T.C. kimlik numarası giriniz." });
      }
    }
  });
export type OrderBillingInput = z.infer<typeof OrderBillingInputSchema>;

/**
 * `PATCH /admin/orders/{orderId}` gövdesi (§5.3, bağlayıcı) — tüm alanlar opsiyonel, ama
 * HİÇBİRİ gönderilmezse 422. `shippingAddress`/`billing` TAM NESNEDİR; kısmi (alan bazlı) yama
 * KABUL EDİLMEZ (adres bir snapshot'tır).
 */
export const UpdateOrderRequestSchema = z
  .object({
    customerEmail: z.string().email().max(254).optional(),
    customerName: z.string().min(1).max(200).nullable().optional(),
    shippingAddress: OrderAddressInputSchema.optional(),
    billing: OrderBillingInputSchema.optional(),
    adminNotes: z.string().min(0).max(5000).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const hasAnyField =
      data.customerEmail !== undefined ||
      data.customerName !== undefined ||
      data.shippingAddress !== undefined ||
      data.billing !== undefined ||
      data.adminNotes !== undefined;
    if (!hasAnyField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "En az bir alan gönderilmelidir.",
      });
    }
  });
export type UpdateOrderRequest = z.infer<typeof UpdateOrderRequestSchema>;
