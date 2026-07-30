import { z } from "zod";

export const MediaIdParamSchema = z.object({
  mediaId: z.string().uuid(),
});
