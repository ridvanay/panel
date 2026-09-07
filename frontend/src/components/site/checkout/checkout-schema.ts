import { z } from "zod";
import type { CheckoutAddressInput, CheckoutBillingInput, CreateCartCheckoutSessionRequest } from "@/lib/api/types";

/**
 * `.claude/architect-scope-checkout-redesign.md` §5.2 — backend `checkout.schemas.ts` alan
 * kurallarının BİREBİR aynası. Iraksama olursa `docs/architecture/openapi.yaml` hakemdir (§6.2).
 */
const PHONE_REGEX = /^[0-9+()\-\s]{7,20}$/;
const TR_POSTAL_CODE_REGEX = /^\d{5}$/;
const VKN_REGEX = /^\d{10}$/;
const TCKN_REGEX = /^[1-9]\d{10}$/;

/**
 * TCKN resmi checksum algoritması — backend `lib/tr-identity.ts::isValidTcKimlikNo` ile AYNI
 * kural seti (§5.4). Yalnızca UX amaçlı ERKEN geri bildirim içindir; backend TEK otoritedir,
 * bu fonksiyonun sonucu server doğrulamasının YERİNİ TUTMAZ.
 */
export function isValidTcKimlikNo(value: string): boolean {
  if (!TCKN_REGEX.test(value)) return false;
  const d = value.split("").map(Number);
  const oddSum = d[0] + d[2] + d[4] + d[6] + d[8];
  const evenSum = d[1] + d[3] + d[5] + d[7];
  const check10 = (((oddSum * 7 - evenSum) % 10) + 10) % 10;
  if (check10 !== d[9]) return false;
  const sum10 = d.slice(0, 10).reduce((sum, digit) => sum + digit, 0);
  return sum10 % 10 === d[10];
}

/** Teslimat adresi — backend `CheckoutAddressInput` ile BİREBİR (§5.2 tablosu). `neighborhood`
 *  openapi'de `required` LİSTESİNDE DEĞİL — mevcut `/hesabim/adreslerim` adres formu şemasıyla
 *  AYNI (yalnızca `city`/`district` zorunlu). */
const addressFieldSchema = z.object({
  fullName: z.string().trim().min(1, "Ad soyad zorunludur.").max(120),
  phone: z.string().trim().regex(PHONE_REGEX, "Geçerli bir telefon numarası giriniz."),
  city: z.string().trim().min(1, "Bu alan zorunludur.").max(100),
  district: z.string().trim().min(1, "Bu alan zorunludur.").max(100),
  neighborhood: z.string().trim().max(100).optional(),
  addressLine1: z.string().trim().min(1, "Adres zorunludur.").max(200),
  addressLine2: z.string().trim().max(200).optional(),
  postalCode: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || TR_POSTAL_CODE_REGEX.test(value), "Posta kodu 5 haneli olmalıdır."),
});

export type AddressFieldValues = z.infer<typeof addressFieldSchema>;

const EMPTY_ADDRESS: AddressFieldValues = {
  fullName: "",
  phone: "",
  city: "",
  district: "",
  neighborhood: "",
  addressLine1: "",
  addressLine2: "",
  postalCode: "",
};

/**
 * `billing.address` — yalnızca `sameAsShipping: false` iken doludur; zod düzeyinde HEPSİ
 * opsiyonel tutulur (aksi halde `sameAsShipping: true` iken boş varsayılan değerler submit'i
 * bloklardı), gerçek zorunluluk aşağıdaki `superRefine`'da uygulanır (§4 madde).
 */
const looseAddressFieldSchema = z.object({
  fullName: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  city: z.string().trim().optional(),
  district: z.string().trim().optional(),
  neighborhood: z.string().trim().optional(),
  addressLine1: z.string().trim().optional(),
  addressLine2: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
});

export const checkoutFormSchema = z
  .object({
    customerEmail: z.string().trim().min(1, "E-posta gerekli.").max(254).email("Geçerli bir e-posta adresi girin."),
    customerName: z.string().trim().max(200).optional(),
    shippingAddress: addressFieldSchema,
    billing: z.object({
      billingType: z.enum(["INDIVIDUAL", "CORPORATE"]),
      sameAsShipping: z.boolean(),
      companyName: z.string().trim().max(200).optional(),
      taxOffice: z.string().trim().max(100).optional(),
      taxNumber: z.string().trim().optional(),
      nationalId: z.string().trim().optional(),
      address: looseAddressFieldSchema,
    }),
    // `z.literal(true)` DEĞİL — checkbox'lar `false` ile başlar, `boolean` tip tutulup runtime'da
    // `true` zorunluluğu `refine` ile uygulanır (aksi halde `defaultValues` tip hatası verirdi).
    distanceSalesApproved: z.boolean().refine((value) => value === true, {
      message: "Mesafeli Satış Sözleşmesi'ni onaylamanız gerekir.",
    }),
    preliminaryInfoApproved: z.boolean().refine((value) => value === true, {
      message: "Ön Bilgilendirme Formu'nu onaylamanız gerekir.",
    }),
  })
  .superRefine((value, ctx) => {
    const { billing } = value;

    // Kural 1 + 2 (§5.2 superRefine).
    if (billing.billingType === "CORPORATE") {
      if (!billing.companyName) {
        ctx.addIssue({ code: "custom", path: ["billing", "companyName"], message: "Kurumsal fatura için firma unvanı zorunludur." });
      }
      if (!billing.taxNumber || !VKN_REGEX.test(billing.taxNumber)) {
        ctx.addIssue({ code: "custom", path: ["billing", "taxNumber"], message: "Vergi numarası 10 haneli olmalıdır." });
      }
      if (billing.nationalId) {
        ctx.addIssue({ code: "custom", path: ["billing", "nationalId"], message: "Kurumsal faturada T.C. kimlik numarası gönderilemez." });
      }
    } else {
      // Kural 3.
      if (billing.companyName || billing.taxOffice || billing.taxNumber) {
        ctx.addIssue({ code: "custom", path: ["billing", "companyName"], message: "Bireysel faturada firma bilgisi gönderilemez." });
      }
      if (billing.nationalId && !isValidTcKimlikNo(billing.nationalId)) {
        ctx.addIssue({ code: "custom", path: ["billing", "nationalId"], message: "Geçerli bir T.C. kimlik numarası giriniz." });
      }
    }

    // Kural 5 — `sameAsShipping === false` iken fatura adresi ZORUNLU (Kural 4, "gönderilirse
    // reddedilir", `buildCheckoutRequest`'in `sameAsShipping` durumuna göre alanı hiç
    // GÖNDERMEMESİYLE zaten karşılanıyor — burada tekrar doğrulanmaz).
    if (billing.sameAsShipping === false) {
      const addr = billing.address;
      if (!addr.fullName) ctx.addIssue({ code: "custom", path: ["billing", "address", "fullName"], message: "Ad soyad zorunludur." });
      if (!addr.phone || !PHONE_REGEX.test(addr.phone)) {
        ctx.addIssue({ code: "custom", path: ["billing", "address", "phone"], message: "Geçerli bir telefon numarası giriniz." });
      }
      if (!addr.city) ctx.addIssue({ code: "custom", path: ["billing", "address", "city"], message: "Bu alan zorunludur." });
      if (!addr.district) ctx.addIssue({ code: "custom", path: ["billing", "address", "district"], message: "Bu alan zorunludur." });
      if (!addr.addressLine1) {
        ctx.addIssue({ code: "custom", path: ["billing", "address", "addressLine1"], message: "Adres zorunludur." });
      }
      if (addr.postalCode && !TR_POSTAL_CODE_REGEX.test(addr.postalCode)) {
        ctx.addIssue({ code: "custom", path: ["billing", "address", "postalCode"], message: "Posta kodu 5 haneli olmalıdır." });
      }
    }
  });

export type CheckoutFormValues = z.infer<typeof checkoutFormSchema>;

export const checkoutFormDefaultValues: CheckoutFormValues = {
  customerEmail: "",
  customerName: "",
  shippingAddress: { ...EMPTY_ADDRESS },
  billing: {
    billingType: "INDIVIDUAL",
    sameAsShipping: true,
    companyName: "",
    taxOffice: "",
    taxNumber: "",
    nationalId: "",
    address: { ...EMPTY_ADDRESS },
  },
  distanceSalesApproved: false,
  preliminaryInfoApproved: false,
};

function toAddressInput(address: AddressFieldValues): CheckoutAddressInput {
  return {
    fullName: address.fullName.trim(),
    phone: address.phone.trim(),
    city: address.city.trim(),
    district: address.district.trim(),
    neighborhood: address.neighborhood?.trim() ? address.neighborhood.trim() : undefined,
    addressLine1: address.addressLine1.trim(),
    addressLine2: address.addressLine2?.trim() ? address.addressLine2.trim() : undefined,
    postalCode: address.postalCode?.trim() ? address.postalCode.trim() : undefined,
  };
}

/**
 * Form state'ini `POST /checkout/session` gövdesine çevirir — para matematiği İÇERMEZ (bkz.
 * §6.2 kuralı), yalnızca alan eşlemesi/omisyonu yapar. `sameAsShipping !== false` iken
 * `billing.address` HİÇ GÖNDERİLMEZ (Kural 4), `billingType` alana göre yasak alanlar
 * (companyName/taxOffice/taxNumber veya nationalId) HİÇ GÖNDERİLMEZ (Kural 2/3).
 */
export function buildCheckoutRequest(values: CheckoutFormValues): CreateCartCheckoutSessionRequest {
  const billing: CheckoutBillingInput = {
    billingType: values.billing.billingType,
    sameAsShipping: values.billing.sameAsShipping,
  };

  if (values.billing.billingType === "CORPORATE") {
    billing.companyName = values.billing.companyName?.trim();
    billing.taxOffice = values.billing.taxOffice?.trim() ? values.billing.taxOffice.trim() : undefined;
    billing.taxNumber = values.billing.taxNumber?.trim();
  } else if (values.billing.nationalId?.trim()) {
    billing.nationalId = values.billing.nationalId.trim();
  }

  if (values.billing.sameAsShipping === false) {
    billing.address = {
      fullName: (values.billing.address.fullName ?? "").trim(),
      phone: (values.billing.address.phone ?? "").trim(),
      city: (values.billing.address.city ?? "").trim(),
      district: (values.billing.address.district ?? "").trim(),
      neighborhood: values.billing.address.neighborhood?.trim() ? values.billing.address.neighborhood.trim() : undefined,
      addressLine1: (values.billing.address.addressLine1 ?? "").trim(),
      addressLine2: values.billing.address.addressLine2?.trim() ? values.billing.address.addressLine2.trim() : undefined,
      postalCode: values.billing.address.postalCode?.trim() ? values.billing.address.postalCode.trim() : undefined,
    };
  }

  return {
    customerEmail: values.customerEmail.trim(),
    customerName: values.customerName?.trim() ? values.customerName.trim() : undefined,
    shippingAddress: toAddressInput(values.shippingAddress),
    billing,
    // Bu noktaya kadar zod `refine` her ikisinin de `true` olduğunu garanti eder.
    distanceSalesApproved: true,
    preliminaryInfoApproved: true,
  };
}
