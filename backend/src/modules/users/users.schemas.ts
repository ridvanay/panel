import { z } from "zod";

export const UpdateUserRequestSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  // `null` avatarı kaldırır, boş string ("") geçersizdir (422) — bkz. openapi.yaml UpdateUserRequest.
  avatarUrl: z.string().url().nullable().optional(),
});

/** `POST /users/me/change-password` gövdesi — mesaj `auth.schemas.ts::RegisterRequestSchema` ile AYNI. */
export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Şifre en az 8 karakter olmalı."),
});

// ---------- Müşteri & E-Ticaret Alanı (Customer Portal) — bkz.
// `.claude/architect-scope-customer-portal.md` §2.2/§2.3 (bağlayıcı karar dokümanı).

/** Kullanıcı başına en fazla adres — aşımda `POST /users/me/addresses` 409 döner (route seviyesi iş kuralı, §2.2/§5.1). */
export const MAX_ADDRESSES_PER_USER = 20;
/** Kullanıcı başına en fazla favori — aşımda `POST /users/me/wishlist` 409 döner (§2.3/§5.2). */
export const MAX_WISHLIST_ITEMS_PER_USER = 100;

export const AddressIdParamSchema = z.object({
  addressId: z.string().uuid(),
});

/** Serbest formatlı telefon — ülke kodu/format ülkeye göre değişir, katı bir E.164 zorunluluğu YOK. */
const ADDRESS_PHONE_REGEX = /^[0-9+()\-\s]{7,20}$/;

const addressTitle = z.string().min(1).max(60);
const addressFullName = z.string().min(1).max(120);
const addressPhone = z.string().regex(ADDRESS_PHONE_REGEX, "Geçerli bir telefon numarası giriniz.");
const addressCountry = z
  .string()
  .length(2, "İki harfli ülke kodu olmalıdır (ör. TR).")
  .toUpperCase();
const addressCity = z.string().min(1).max(100);
const addressDistrict = z.string().min(1).max(100);
const addressNeighborhood = z.string().min(1).max(100).nullable();
const addressLine1 = z.string().min(1).max(200);
const addressLine2 = z.string().min(1).max(200).nullable();
const addressPostalCode = z.string().min(1).max(20).nullable();

export const CreateAddressRequestSchema = z.object({
  title: addressTitle,
  fullName: addressFullName,
  phone: addressPhone,
  country: addressCountry.default("TR"),
  city: addressCity,
  district: addressDistrict,
  neighborhood: addressNeighborhood.optional(),
  addressLine1,
  addressLine2: addressLine2.optional(),
  postalCode: addressPostalCode.optional(),
  // İlk adres route handler'da OTOMATİK varsayılan yapılır (bkz. users.routes.ts) — burada
  // gönderilmese de olur; `true` gönderilirse diğer adresler tek transaction'da `false`'a çekilir.
  isDefault: z.boolean().optional().default(false),
});
export type CreateAddressRequestDto = z.infer<typeof CreateAddressRequestSchema>;

/** `PATCH /users/me/addresses/{addressId}` — TÜM alanlar opsiyonel (kısmi güncelleme). */
export const UpdateAddressRequestSchema = z.object({
  title: addressTitle.optional(),
  fullName: addressFullName.optional(),
  phone: addressPhone.optional(),
  country: addressCountry.optional(),
  city: addressCity.optional(),
  district: addressDistrict.optional(),
  neighborhood: addressNeighborhood.optional(),
  addressLine1: addressLine1.optional(),
  addressLine2: addressLine2.optional(),
  postalCode: addressPostalCode.optional(),
  isDefault: z.boolean().optional(),
});
export type UpdateAddressRequestDto = z.infer<typeof UpdateAddressRequestSchema>;

export const ProductIdParamSchema = z.object({
  productId: z.string().uuid(),
});

/** `POST /users/me/wishlist` gövdesi. */
export const AddWishlistItemRequestSchema = z.object({
  productId: z.string().uuid(),
});
