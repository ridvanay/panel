import { z } from "zod";

export const ModuleKeyParamSchema = z.object({
  key: z.string(),
});

export const UpdateModuleRequestSchema = z.object({
  enabled: z.boolean(),
});
export type UpdateModuleRequestDto = z.infer<typeof UpdateModuleRequestSchema>;
