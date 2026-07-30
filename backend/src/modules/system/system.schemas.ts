import { z } from "zod";

export const SystemHealthSchema = z.object({
  dbPingMs: z.number(),
  dbSizeBytes: z.number(),
  // Yalnızca DB_STORAGE_QUOTA_MB ortam değişkeni tanımlıysa dolu, aksi halde null
  // (frontend bu durumda "doluluk yüzdesi" değil, yalnızca mutlak boyutu gösterir).
  dbQuotaBytes: z.number().nullable(),
  mediaStorageBytes: z.number(),
  mediaStorageQuotaBytes: z.number().nullable(),
  memoryUsedBytes: z.number(),
  memoryTotalBytes: z.number(),
  processMemoryBytes: z.number(),
  loadAverage: z.tuple([z.number(), z.number(), z.number()]),
  platform: z.string(),
  uptimeSeconds: z.number(),
  checkedAt: z.string(),
});
