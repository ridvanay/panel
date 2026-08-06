import { z } from "zod";
import { CursorQuerySchema } from "../../schemas/common";
import { ExportFileFormatSchema, ExportJobStatusSchema, ExportJobTypeSchema } from "../../schemas/entities";
import { GranularitySchema } from "../stats/stats.schemas";

const isoDateStringSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Geçersiz ISO-8601 tarih.",
});

export const ExportJobIdParamSchema = z.object({
  jobId: z.string().uuid(),
});

/** `GET /admin/reports/exports` — openapi.yaml parameters. */
export const ListExportJobsQuerySchema = CursorQuerySchema.extend({
  type: ExportJobTypeSchema.optional(),
  status: ExportJobStatusSchema.optional(),
});

/**
 * Tipe göre opsiyonel ek filtreler — `USERS` için `role`, `REVENUE` için `subscriptionStatus`.
 * Diğer tiplerde YOK SAYILIR (worker'da kullanılmaz).
 */
export const ExportFiltersSchema = z
  .object({
    role: z.enum(["ADMIN", "EDITOR", "VIEWER"]).optional(),
    subscriptionStatus: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "INCOMPLETE"]).optional(),
  })
  .default({});
export type ExportFilters = z.infer<typeof ExportFiltersSchema>;

/**
 * `POST /admin/reports/exports` gövdesi. `unmaskPii` — kullanıcı tarafından onaylanmış karar:
 * varsayılan `false` (maskeli); `true` verilirse ayrı bir onay akışı YOK (bu zaten ADMIN-only
 * bir uçtur) ama `reports.routes.ts` `reports.export.unmasked_pii` action'ıyla AYRI bir audit
 * kaydı yazar ve worker `ExportJob.containsPii = true` set eder.
 */
export const CreateExportJobRequestSchema = z.object({
  type: ExportJobTypeSchema,
  format: ExportFileFormatSchema,
  from: isoDateStringSchema,
  to: isoDateStringSchema,
  granularity: GranularitySchema.default("day"),
  filters: ExportFiltersSchema,
  unmaskPii: z.boolean().default(false),
});
export type CreateExportJobRequest = z.infer<typeof CreateExportJobRequestSchema>;
