import { z } from "zod";

/**
 * §10.4 Güvenlik & 2FA + Aktif Oturumlar — bkz. ARCHITECTURE.md §10.4 ve
 * docs/architecture/shared-types.ts (TwoFactorSetupResponse, EnableTwoFactorRequest/Response,
 * DisableTwoFactorRequest, RegenerateBackupCodesRequest/Response, Session).
 */

export const SetupTwoFactorResponseSchema = z.object({
  otpauthUrl: z.string(),
  qrCodeDataUrl: z.string(),
  setupToken: z.string(),
});
export type SetupTwoFactorResponseDto = z.infer<typeof SetupTwoFactorResponseSchema>;

export const EnableTwoFactorRequestSchema = z.object({
  setupToken: z.string().min(1),
  code: z.string().min(4),
});

export const EnableTwoFactorResponseSchema = z.object({
  backupCodes: z.array(z.string()),
});
export type EnableTwoFactorResponseDto = z.infer<typeof EnableTwoFactorResponseSchema>;

export const DisableTwoFactorRequestSchema = z.object({
  password: z.string().min(1),
});

export const RegenerateBackupCodesRequestSchema = z.object({
  password: z.string().min(1),
});

export const RegenerateBackupCodesResponseSchema = z.object({
  backupCodes: z.array(z.string()),
});
export type RegenerateBackupCodesResponseDto = z.infer<typeof RegenerateBackupCodesResponseSchema>;

export const SessionIdParamSchema = z.object({
  id: z.string().uuid(),
});
