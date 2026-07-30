import { z } from "zod";

export const UpdateUserRequestSchema = z.object({
  name: z.string().min(1).optional(),
  avatarUrl: z.string().url().optional(),
});
