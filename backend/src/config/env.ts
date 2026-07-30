import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  // Yüklenen medya URL'lerini mutlaklaştırmak için kullanılır (bkz. modules/media).
  PUBLIC_URL: z.string().url().default("http://localhost:4000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL zorunlu."),

  JWT_PRIVATE_KEY_BASE64: z.string().optional(),
  JWT_PUBLIC_KEY_BASE64: z.string().optional(),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),

  // Medya depolama — "local" (varsayılan, diske yazar) veya "s3" (S3/MinIO/R2 uyumlu nesne depolama).
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  // MinIO/Cloudflare R2 gibi S3-uyumlu servisler için özel uç nokta.
  S3_ENDPOINT: z.string().optional(),
  // CDN/CloudFront base URL — tanımlıysa medya URL'leri bundan üretilir, aksi halde S3 sağlayıcı URL'i kullanılır.
  S3_PUBLIC_URL: z.string().optional(),

  // Tanımlıysa GET /admin/health "doluluk yüzdesi" hesaplayabilir; tanımsızsa frontend
  // sadece mutlak boyutu gösterir (bkz. modules/system).
  DB_STORAGE_QUOTA_MB: z.coerce.number().int().positive().optional(),
  MEDIA_STORAGE_QUOTA_MB: z.coerce.number().int().positive().optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Ortam değişkenleri geçersiz:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
