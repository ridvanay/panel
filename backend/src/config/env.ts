import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  // Yüklenen medya URL'lerini mutlaklaştırmak için kullanılır (bkz. modules/media).
  PUBLIC_URL: z.string().url().default("http://localhost:4000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL zorunlu."),

  // Fastify'ın `trustProxy` ayarı — `X-Forwarded-*` header'larının (özellikle `request.ip`,
  // rate-limit'in IP bazlı sayaçları ve audit log'daki `ipAddress`) hangi koşulda güvenilir
  // sayılacağını belirler. Önünde GERÇEK bir reverse-proxy (nginx/ALB/Cloudflare) yoksa bu
  // AÇIK bırakılmamalı — aksi halde istemci, sahte `X-Forwarded-For` header'ıyla IP'sini
  // (dolayısıyla rate-limit/audit log kayıtlarını) taklit edebilir. Varsayılan güvenli değer:
  // "false" (header'lara hiç güvenme, doğrudan soket IP'sini kullan). Kabul edilen değerler:
  //   - boş / "false" → trustProxy: false
  //   - "true"        → trustProxy: true (TÜM proxy header'larına güvenilir — sadece bilinen,
  //                      güvenilir bir tek-proxy önünde çalışıyorsanız kullanın)
  //   - IP/CIDR veya virgülle ayrılmış liste (örn. "10.0.0.0/8,172.16.0.0/12") → Fastify'a
  //     olduğu gibi iletilir, sadece o adres(ler)den gelen `X-Forwarded-*` güvenilir sayılır.
  TRUST_PROXY: z
    .string()
    .optional()
    .default("false")
    .transform((value): boolean | string => {
      const trimmed = value.trim();
      if (trimmed === "" || trimmed.toLowerCase() === "false") return false;
      if (trimmed.toLowerCase() === "true") return true;
      return trimmed;
    }),

  JWT_PRIVATE_KEY_BASE64: z.string().optional(),
  JWT_PUBLIC_KEY_BASE64: z.string().optional(),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),

  // Global (route-özel override edilmemiş) uçlar için istek limiti. 100/dk admin panelinin
  // normal kullanımında (10sn'de bir /admin/health polling'i, sayfa geçişlerinde paralel
  // GET'ler, dashboard grafikleri vb.) yanlışlıkla aşılıyordu — 300/dk bu trafiği rahatça
  // karşılarken kaba kuvvet/scraping'e karşı yine de bir üst sınır koyar. Hassas uçlar
  // (login, 2FA vb.) zaten kendi route-level `config: { rateLimit: {...} }` override'ları
  // ile çok daha sıkı bir limite (5/dk) tabidir — bkz. auth.routes.ts, security.routes.ts.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
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

  // §10.4 Güvenlik & 2FA — TOTP secret şifrelemesi için AES-256-GCM anahtarı (32 byte, base64).
  // bkz. lib/crypto.ts::encryptSecret/decryptSecret.
  ENCRYPTION_KEY: z.string().min(1, "ENCRYPTION_KEY zorunlu."),

  // E-posta gönderimi (SMTP) — bkz. lib/mail.ts. Sağlayıcı koda gömülmez: Mailtrap/SendGrid
  // SMTP/Resend SMTP/kurumsal SMTP hepsi aynı SMTP_HOST/PORT/USER/PASS arayüzüyle çalışır.
  // SMTP_HOST boş bırakılırsa: NODE_ENV=development'ta lib/mail.ts otomatik bir Ethereal
  // (ethereal.email) test hesabı oluşturur — hiçbir kurulum gerekmez. NODE_ENV=test veya
  // production'da SMTP_HOST eksikse gönderim denendiğinde sendMail() anlamlı bir hata fırlatır
  // (EmailDeliveryError) — zorunlu tutulmaz ki DB migration/health gibi mail'e ihtiyaç duymayan
  // komutlar SMTP kurulmadan da çalışabilsin.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  // "true"/"false" string'i olarak okunur — z.coerce.boolean() boş olmayan HER string'i (örn.
  // "false") true'ya çevirdiği için burada kasıtlı olarak kullanılmadı.
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // Gönderen adı + adresi, örn. "Şirket Adı <no-reply@example.com>".
  SMTP_FROM: z.string().default("No-Reply <no-reply@example.com>"),

  // Hata takibi (Sentry veya uyumlu bir self-hosted alternatif — GlitchTip vb. aynı DSN
  // formatını kullanır). Tanımsız/boş bırakılırsa Sentry HİÇ init edilmez (varsayılan KAPALI,
  // no-op) — bkz. lib/sentry.ts. Sadece error-handler.ts'teki son catch-all (beklenmedik 500)
  // dalı bu SDK'yı kullanır; bilinen/ele alınmış hatalar (ApiError, ZodError, 429 vb.) hiç
  // gönderilmez.
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

  // §10.12.6 Özel CSS/JS kill switch (kontrattaki EN YÜKSEK RİSKLİ yüzey — devops-agent sahiplenir).
  // `false` iken `PUT /admin/appearance/custom-code/{css,js}` 403 döner ve public `GET /appearance`
  // `customJs` HER ZAMAN `null` verir; saklı değer KORUNUR ve yönetim ucunda (`GET
  // /admin/appearance/custom-code`) görünmeye devam eder. Barındırılan/çok kiracılı bir kurulumda
  // keyfi JS'in olay anında tek kaldıraçla kapatılabilmesi için vardır (bkz. ARCHITECTURE.md §10.12.6).
  // `SMTP_SECURE` ile AYNI desen — `z.coerce.boolean()` boş olmayan HER string'i (örn. "false")
  // true'ya çevirdiği için kasıtlı olarak kullanılmadı.
  CUSTOM_CODE_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Ortam değişkenleri geçersiz:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
