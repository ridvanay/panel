import { z } from "zod";
import { CursorQuerySchema } from "../../schemas/common";
import { ImportDuplicateStrategySchema, ImportFieldMappingSchema, ImportJobStatusSchema, ImportJobTypeSchema } from "../../schemas/entities";

export const ImportJobIdParamSchema = z.object({
  jobId: z.string().uuid(),
});

/** `GET /admin/import/jobs` — openapi.yaml parameters. */
export const ListImportJobsQuerySchema = CursorQuerySchema.extend({
  type: ImportJobTypeSchema.optional(),
  status: ImportJobStatusSchema.optional(),
});

/** `POST /admin/import/jobs` — `multipart/form-data`; `file` `request.file()` ile ayrıca okunur. */
export const CreateImportJobRequestSchema = z.object({
  type: ImportJobTypeSchema,
});

/** `POST /admin/import/jobs/{jobId}/start` — gövde HİÇ gönderilmezse tüm varsayılanlar uygulanır. */
export const StartImportJobRequestSchema = z.object({
  fieldMapping: ImportFieldMappingSchema.optional(),
  duplicateStrategy: ImportDuplicateStrategySchema.optional(),
  defaultStatus: z.enum(["DRAFT", "PUBLISHED"]).optional(),
  defaultAuthorId: z.string().uuid().nullable().optional(),
  defaultCategoryId: z.string().uuid().nullable().optional(),
});
export type StartImportJobRequest = z.infer<typeof StartImportJobRequestSchema>;
