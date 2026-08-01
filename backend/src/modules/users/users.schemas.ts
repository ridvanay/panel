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
