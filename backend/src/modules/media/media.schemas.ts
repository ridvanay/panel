import { z } from "zod";

export const MediaIdParamSchema = z.object({
  mediaId: z.string().uuid(),
});

// §Faz 2 içerik editörü — editör içi görsellerde alt metin zorunluluğu; boş string kabul edilmez
// (bkz. modules/media/media.routes.ts::PATCH /:mediaId).
export const UpdateMediaAltTextRequestSchema = z.object({
  altText: z.string().min(1, "Alt metin gerekli."),
});
