import { z } from "zod";

/**
 * `.claude/architect-scope-support-desk-and-reminders.md` §3.5 — Zod istek/param/query şemaları.
 * Yanıt DTO'ları (`SupportChatSession`, `SupportChatMessage`, ...) `schemas/entities.ts`'te
 * yaşar (`telehealth.schemas.ts`/`schemas/entities.ts` ayrımıyla AYNI desen).
 */

export const SessionIdParamSchema = z.object({
  sessionId: z.string().uuid(),
});

export const TemplateIdParamSchema = z.object({
  templateId: z.string().uuid(),
});

/**
 * Ziyaretçi oturum erişim token'ı — `telehealth.schemas.ts::AccessTokenQuerySchema` İLE AYNI
 * şekil (opak, ham). Karşılaştırma route/service katmanında SABİT ZAMANLI yapılır.
 */
export const SupportAccessTokenQuerySchema = z.object({
  t: z.string().min(1).max(512).optional(),
});

export const SupportAfterSeqQuerySchema = z.object({
  afterSeq: z.coerce.number().int().min(0).optional(),
});

export const CreateSupportSessionRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  visitorName: z.string().trim().max(120).nullable().optional(),
  // Ön görüşme (pre-chat) formu — `.claude/architect-scope-support-desk-and-reminders.md` §7.
  // Ziyaretçi BEYANI; format doğrulaması BİLİNÇLİ OLARAK YOK (yalnızca maxLength).
  visitorPhone: z.string().trim().max(40).nullable().optional(),
  visitorEmail: z.string().trim().toLowerCase().email().max(200).nullable().optional(),
  pageUrl: z.string().trim().max(500).nullable().optional(),
  locale: z.string().trim().max(10).nullable().optional(),
});
export type CreateSupportSessionRequest = z.infer<typeof CreateSupportSessionRequestSchema>;

export const SendSupportMessageRequestSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});
export type SendSupportMessageRequest = z.infer<typeof SendSupportMessageRequestSchema>;

export const SendSupportAgentMessageRequestSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  templateId: z.string().uuid().nullable().optional(),
});
export type SendSupportAgentMessageRequest = z.infer<typeof SendSupportAgentMessageRequestSchema>;

/** `ANSWERED` KABUL EDİLMEZ — türev durumdur (§3.5, bağlayıcı, zod seviyesinde zorlanır). */
export const UpdateSupportSessionRequestSchema = z.object({
  status: z.enum(["PENDING", "CLOSED"]),
});
export type UpdateSupportSessionRequest = z.infer<typeof UpdateSupportSessionRequestSchema>;

export const AssignSupportSessionRequestSchema = z.object({
  agentId: z.string().uuid().nullable(),
});
export type AssignSupportSessionRequest = z.infer<typeof AssignSupportSessionRequestSchema>;

export const ListAdminSupportSessionsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(["PENDING", "ANSWERED", "CLOSED"]).optional(),
  // `me` | `unassigned` | uuid — serbest string olarak alınır, çözümleme route/service katmanında.
  assignedAgentId: z.string().optional(),
  q: z.string().trim().max(100).optional(),
});
export type ListAdminSupportSessionsQuery = z.infer<typeof ListAdminSupportSessionsQuerySchema>;

export const ListSupportTemplatesQuerySchema = z.object({
  includeInactive: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});
export type ListSupportTemplatesQuery = z.infer<typeof ListSupportTemplatesQuerySchema>;

export const CreateSupportReplyTemplateRequestSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
  sortOrder: z.number().int().nullable().optional(),
  isActive: z.boolean().default(true),
});
export type CreateSupportReplyTemplateRequest = z.infer<typeof CreateSupportReplyTemplateRequestSchema>;

/** Kısmi güncelleme — en az bir alan ZORUNLU (`media.schemas.ts::UpdateMediaFolderRequestSchema` İLE AYNI desen). */
export const UpdateSupportReplyTemplateRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(2000).optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => data.title !== undefined || data.body !== undefined || data.sortOrder !== undefined || data.isActive !== undefined, {
    message: "En az bir alan gönderilmelidir.",
  });
export type UpdateSupportReplyTemplateRequest = z.infer<typeof UpdateSupportReplyTemplateRequestSchema>;
