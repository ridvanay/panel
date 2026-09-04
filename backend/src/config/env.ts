import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  // TARAYICININ eriştiği origin — CORS `origin` kontrolü (plugins/security.ts) VE e-posta/
  // checkout/invitation gibi kullanıcıya gönderilen MUTLAK URL'lerin (reset-password, davet
  // kabul, Stripe checkout success/cancel vb.) tümü bunu kullanır. Docker ağı içindeki servis
  // adı ("frontend") BURAYA ASLA YAZILMAMALI — tarayıcı bu adı çözemez, hem CORS'u (login dahil
  // TÜM istekler ağ hatası gibi görünerek başarısız olur) hem gönderilen e-posta linklerini kırar.
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  // Backend'in SUNUCUDAN SUNUCUYA çağırdığı tek uç: `lib/revalidate.ts`teki on-demand ISR
  // webhook'u (`POST /api/revalidate`). Docker Compose ağında frontend servisine "frontend"
  // adıyla erişilir (`FRONTEND_URL`'den KASITLI OLARAK AYRI — bkz. o alanın yorumu); tanımsızsa
  // `FRONTEND_URL`'e düşer (bare-metal/tek-host geliştirmede ikisi zaten aynı adrestir).
  INTERNAL_FRONTEND_URL: z.string().url().optional(),
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

  // On-demand ISR — backend, frontend'den AYRI bir process olduğu için Next.js'in
  // `revalidatePath`'ini DOĞRUDAN çağıramaz; bunun yerine kaydetme sonrası frontend'deki
  // `POST /api/revalidate` webhook'unu bu paylaşılan sırla imzalayarak tetikler (bkz.
  // lib/revalidate.ts). `STRIPE_SECRET_KEY` ile AYNI desen — boş bırakılırsa özellik
  // sessizce devre dışı kalır (revalidation çağrısı hiç yapılmaz), sayfa kaydetme/yayınlama
  // akışı bundan ETKİLENMEZ (ISR zaten 60sn'lik zaman-tabanlı revalidate ile geri düşer,
  // bu yüzden ZORUNLU tutulmadı — `ENCRYPTION_KEY` gibi eksikliği güvenlik açığına yol
  // açan bir alan DEĞİL, yalnızca bir gecikme/latency optimizasyonu).
  REVALIDATE_SECRET: z.string().default(""),

  // Global (route-özel override edilmemiş) uçlar için istek limiti. 100/dk admin panelinin
  // normal kullanımında (10sn'de bir /admin/health polling'i, sayfa geçişlerinde paralel
  // GET'ler, dashboard grafikleri vb.) yanlışlıkla aşılıyordu — 300/dk bu trafiği rahatça
  // karşılarken kaba kuvvet/scraping'e karşı yine de bir üst sınır koyar. Hassas uçlar
  // (login, 2FA vb.) zaten kendi route-level `config: { rateLimit: {...} }` override'ları
  // ile çok daha sıkı bir limite (5/dk) tabidir — bkz. auth.routes.ts, security.routes.ts.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),

  // `auth.routes.ts::AUTH_RATE_LIMIT` — login/register/2FA/parola sıfırlama gibi hassas uçlara
  // özel, `RATE_LIMIT_MAX`'tan BAĞIMSIZ dakikalık limit. Varsayılan (5) bugünkü sabit değerle
  // BİREBİR AYNI — prod/dev/`.env.example` bu değişkeni HİÇ tanımlamaz, davranış değişmez.
  // Yalnızca `backend/.env.e2e` (security-agent onayı, `.claude/...` — qa-agent bulgusu: 28
  // spec dosyasının `beforeAll`'da yaptığı gerçek UI login'ler 17dk'lık sıralı bir koşuda 5/dk
  // sınırını aşıp `429` ile testleri zincirleme başarısız kılıyordu) bunu 50'ye yükseltir —
  // mekanizmanın kendisi yine gözlemlenebilir kalsın diye "asla tetiklenmeyecek" bir değere
  // DEĞİL, yalnızca gerçekçi test yüküne yetecek kadar yükseltilir. `.max(1000)` — yanlışlıkla
  // aşırı büyük bir değer (`999999` gibi) yazılıp kontrolün fiilen etkisiz kılınmasına karşı üst sınır.
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(1000).default(5),

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

  // Katalog varyasyon (option) facet'inin taradığı EN FAZLA ürün sayısı — bkz.
  // `.claude/architect-scope-products-catalog.md` §3.4. Aşılırsa
  // `meta.facets.truncated: true` döner; kategori/fiyat/stok facet'leri SQL toplama
  // olduğu için bundan ETKİLENMEZ, HER ZAMAN tamdır.
  PRODUCT_FACET_SCAN_LIMIT: z.coerce.number().int().positive().default(2000),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Ortam değişkenleri geçersiz:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
