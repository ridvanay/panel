import { z } from "zod";
import { CursorQuerySchema } from "../../schemas/common";
import { NewPasswordSchema } from "../auth/auth.schemas";
import { SiteRoleSchema, SiteUserStatusSchema } from "../../schemas/entities";

export const AdminUserIdParamSchema = z.object({
  userId: z.string().uuid(),
});

/**
 * `GET /admin/users` query — varsayılan olarak `DELETED` kullanıcılar dışarıda bırakılır
 * (bkz. openapi.yaml `includeDeleted`). Fastify querystring string olarak geldiği için
 * `z.coerce.boolean()` DEĞİL, açık "true" karşılaştırması kullanılır — `z.coerce.boolean()`
 * boş olmayan HER string'i (ör. "false") `true` yapardı.
 */
export const ListAdminUsersQuerySchema = CursorQuerySchema.extend({
  includeDeleted: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Ad/e-posta üzerinde sunucu tarafı arama (case-insensitive, `contains`) — 100+ kullanıcılı
   *  listelerde istemci tarafı filtrenin yalnızca ilk sayfayı taradığı sorunu çözer (bkz.
   *  `telehealth.admin.routes.ts::ListAdminDoctorsQuerySchema` İLE AYNI desen). */
  search: z.string().trim().min(1).max(120).optional(),
});

export const CreateAdminUserRequestSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: SiteRoleSchema.optional(),
});

export const UpdateAdminUserRoleRequestSchema = z.object({
  role: SiteRoleSchema,
});

export const UpdateAdminUserStatusRequestSchema = z.object({
  status: SiteUserStatusSchema,
});

/**
 * `PATCH /admin/users/{userId}/password` gövdesi — minimum uzunluk kuralı
 * `users.schemas.ts::ChangePasswordRequestSchema`/`auth.schemas.ts::RegisterRequestSchema` ile
 * AYNI (8 karakter); burada YENİ bir kural İCAT EDİLMEZ. `max(200)` yalnızca savunma-derinliği
 * (argon2 hash'leme maliyetiyle DoS'u önler) — mevcut şifre şemalarında YOK, burada BİLİNÇLİ eklendi.
 */
export const SetAdminUserPasswordRequestSchema = z.object({
  password: NewPasswordSchema,
});

/**
 * 2026-10-18 (Paket B1) — `POST /admin/users/{userId}/2fa/reset` step-up gövdesi: işlemi yapan
 * ADMIN'in KENDİ authenticator uygulamasındaki 6 haneli TOTP kodu. Yedek kod KABUL EDİLMEZ
 * (yedek kod tek kullanımlık bir kurtarma aracıdır, rutin onay için harcanmamalı).
 */
export const ResetUserTwoFactorRequestSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "6 haneli doğrulama kodunu girin."),
});

export const EmailDispatchStatusSchema = z.object({
  emailStatus: z.enum(["sent", "failed"]),
});
