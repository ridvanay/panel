import { z } from "zod";
import { CursorQuerySchema } from "../../schemas/common";
import { AuditStatusSchema } from "../../schemas/entities";

export const LogsQuerySchema = CursorQuerySchema.extend({
  status: AuditStatusSchema.optional(),
  action: z.string().optional(),
});
