import { z } from "zod";
import { isValidTcKimlikNo } from "../../lib/tr-identity";

// GÜVENLİK: bu uç PUBLIC + kimliksiz (bkz. checkout.routes.ts) — global bodyLimit ~5MB olduğundan
// üst sınırsız string alanlar (ör. e-posta/isim/adres) DB'ye/Stripe'a/e-posta şablonuna aşırı
// büyük payload sızdırabilir (depolama/işlem israfı, kaba bir DoS vektörü). RFC 5321 e-posta üst
// sınırı 254 karakterdir; diğer üst sınırlar `.claude/architect-scope-checkout-redesign.md` §5.2
// tablosuyla (bağlayıcı) BİREBİR aynıdır.

// Telefon/adres alan kuralları `users.schemas.ts::CreateAddressRequestSchema` (adres defteri)
// İLE BİREBİR AYNI tutulur (§5.2, bağlayıcı) — iki kural setinin AYRIŞMAMASI şarttır. Buradaki
// `postalCode` KURALI FARKLIDIR (ülkeye göre koşullu, adres defterinde YOK) — bu, checkout'a ÖZGÜ
// bir ek kısıttır, adres defteriyle çelişmez (adres defteri postalCode'da yalnızca uzunluk sınırı
// uygular).
const CHECKOUT_PHONE_REGEX = /^[0-9+()\-\s]{7,20}$/;
const CHECKOUT_TR_POSTAL_CODE_REGEX = /^\d{5}$/;
const CHECKOUT_TAX_NUMBER_REGEX = /^\d{10}$/;
const CHECKOUT_NATIONAL_ID_REGEX = /^[1-9]\d{10}$/;

const REQUIRED_FIELD_MESSAGE = "Bu alan zorunludur.";

/**
 * `CheckoutAddressInput` (openapi.yaml) — teslimat VE fatura adresi ortak şekli. `postalCode`
 * ülke koşullu: `country === "TR"` iken tam 5 rakam ZORUNLU (gönderilmişse), diğer ülkelerde
 * yalnızca uzunluk sınırı uygulanır (§5.2).
 */
export const CheckoutAddressInputSchema = z
  .object({
    fullName: z.string().min(1, "Ad soyad zorunludur.").max(120, "Ad soyad zorunludur."),
    phone: z.string().regex(CHECKOUT_PHONE_REGEX, "Geçerli bir telefon numarası giriniz."),
    country: z
      .string()
      .length(2, "İki harfli ülke kodu olmalıdır (ör. TR).")
      .toUpperCase()
      .default("TR"),
    city: z.string().min(1, REQUIRED_FIELD_MESSAGE).max(100, REQUIRED_FIELD_MESSAGE),
    district: z.string().min(1, REQUIRED_FIELD_MESSAGE).max(100, REQUIRED_FIELD_MESSAGE),
    neighborhood: z.string().min(1, REQUIRED_FIELD_MESSAGE).max(100).optional(),
    addressLine1: z.string().min(1, "Adres zorunludur.").max(200, "Adres zorunludur."),
    addressLine2: z.string().min(1, "Adres zorunludur.").max(200).optional(),
    postalCode: z.string().min(1).max(20).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.postalCode === undefined) return;
    if (data.country === "TR" && !CHECKOUT_TR_POSTAL_CODE_REGEX.test(data.postalCode)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["postalCode"], message: "Posta kodu 5 haneli olmalıdır." });
    }
  });
export type CheckoutAddressInput = z.infer<typeof CheckoutAddressInputSchema>;

export const BillingTypeSchema = z.enum(["INDIVIDUAL", "CORPORATE"]);

/**
 * `CheckoutBillingInput` (openapi.yaml) — koşullu zorunluluk kuralları (1-3, superRefine ile,
 * hepsi 422). `sameAsShipping`/`address` çapraz kuralı (4-5) `CartCheckoutSessionRequestSchema`
 * seviyesinde uygulanır (§5.2 madde 4-5) çünkü `address` kararı `shippingAddress`'e değil
 * `sameAsShipping`'e bağlıdır — bu obje kendi içinde tutarlıdır (`sameAsShipping` + `address`
 * burada bir arada), bu yüzden 4-5 kuralları da BURADA uygulanır.
 */
export const CheckoutBillingInputSchema = z
  .object({
    billingType: BillingTypeSchema,
    sameAsShipping: z.boolean().default(true),
    companyName: z.string().min(1, "Kurumsal fatura için firma unvanı zorunludur.").max(200, "Kurumsal fatura için firma unvanı zorunludur.").optional(),
    taxOffice: z.string().min(1, REQUIRED_FIELD_MESSAGE).max(100, REQUIRED_FIELD_MESSAGE).optional(),
    taxNumber: z.string().regex(CHECKOUT_TAX_NUMBER_REGEX, "Vergi numarası 10 haneli olmalıdır.").optional(),
    nationalId: z.string().regex(CHECKOUT_NATIONAL_ID_REGEX, "Geçerli bir T.C. kimlik numarası giriniz.").optional(),
    address: CheckoutAddressInputSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.billingType === "CORPORATE") {
      // Kural 1 — CORPORATE: companyName + taxNumber ZORUNLU.
      if (!data.companyName) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["companyName"], message: "Kurumsal fatura için firma unvanı zorunludur." });
      }
      if (!data.taxNumber) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["taxNumber"], message: "Vergi numarası 10 haneli olmalıdır." });
      }
      // Kural 2 — CORPORATE: nationalId gönderilirse REDDEDİLİR (KVKK veri minimizasyonu).
      if (data.nationalId !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nationalId"], message: "Kurumsal faturada T.C. kimlik numarası gönderilemez." });
      }
    } else {
      // Kural 3 — INDIVIDUAL: companyName/taxOffice/taxNumber gönderilirse REDDEDİLİR.
      if (data.companyName !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["companyName"], message: "Bireysel faturada firma unvanı gönderilemez." });
      }
      if (data.taxOffice !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["taxOffice"], message: "Bireysel faturada vergi dairesi gönderilemez." });
      }
      if (data.taxNumber !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["taxNumber"], message: "Bireysel faturada vergi numarası gönderilemez." });
      }
      // `nationalId` INDIVIDUAL'da OPSİYONEL — gönderildiyse resmi checksum algoritmasından geçmeli.
      if (data.nationalId !== undefined && !isValidTcKimlikNo(data.nationalId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nationalId"], message: "Geçerli bir T.C. kimlik numarası giriniz." });
      }
    }

    // Kural 4 — sameAsShipping !== false (true veya default) → address gönderilirse REDDEDİLİR.
    if (data.sameAsShipping !== false) {
      if (data.address !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["address"], message: "Teslimat adresiyle aynıyken ayrı bir fatura adresi gönderilemez." });
      }
    } else if (data.address === undefined) {
      // Kural 5 — sameAsShipping === false → address ZORUNLU.
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["address"], message: "Fatura adresi teslimat adresinden farklıysa fatura adresi zorunludur." });
    }
  });
export type CheckoutBillingInput = z.infer<typeof CheckoutBillingInputSchema>;

export const CreateCheckoutSessionRequestSchema = z.object({
  customerEmail: z.string().email().max(254),
  customerName: z.string().min(1).max(200).optional(),
  shippingAddress: CheckoutAddressInputSchema,
  billing: CheckoutBillingInputSchema,
  // `z.literal(true)` — `true` DIŞINDA bir değer (`false`, eksik) 422 ile reddedilir. Onay anı
  // route handler'da `new Date()` olarak SAKLANIR; istekten gelen bir zaman damgası KABUL EDİLMEZ.
  // NOT: `{ message: "..." }` kısayolu ZodLiteral'de yalnızca alan HİÇ gönderilmediğinde (undefined)
  // uygulanır — `false` gibi tip-uyumlu ama değeri YANLIŞ bir girdide varsayılan İngilizce
  // "Invalid literal value" mesajına düşer (zod v3 bilinen davranışı). `errorMap` HER durumda
  // (eksik/false/başka tip) TUTARLI Türkçe mesaj garanti eder.
  distanceSalesApproved: z.literal(true, { errorMap: () => ({ message: "Mesafeli Satış Sözleşmesi'ni onaylamanız gerekir." }) }),
  preliminaryInfoApproved: z.literal(true, { errorMap: () => ({ message: "Ön Bilgilendirme Formu'nu onaylamanız gerekir." }) }),
});
export type CreateCheckoutSessionRequest = z.infer<typeof CreateCheckoutSessionRequestSchema>;

export const CheckoutSessionResponseSchema = z.object({
  checkoutUrl: z.string(),
});
