import { z } from "zod";

export const CreateOrganizationRequestSchema = z.object({
  name: z.string().min(1),
});

export const UpdateOrganizationRequestSchema = z.object({
  name: z.string().min(1).optional(),
});
