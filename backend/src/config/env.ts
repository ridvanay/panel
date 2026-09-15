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
  // `.claude/architect-scope-doctor-subdomain.md` §6.4/§7.2 — hekim portalının (`/doctor/**`)
  // izole edildiği AYRI bir tarayıcı origin'i (dev: `doktor.siteadi.localhost:3000`, prod:
  // `doktor.siteadi.com`). `FRONTEND_URL` İLE AYNI ROLÜ oynar (CORS `origin` allow-list'i,
  // bkz. plugins/security.ts) — TEK fark, bunun host bazlı ikinci bir tarayıcı origin'i olması.
  // OPSİYONEL: subdomain izolasyonu yapılandırılmamış kurulumlarda (`DOCTOR_FRONTEND_URL`
  // tanımsız/boş) hekim portalı `FRONTEND_URL` altında aynı origin'den servis edilir ve CORS
  // allow-list'i tek eleman olarak kalır — geriye dönük uyumluluk bozulmaz. Bu alanın bir
  // allow-list girdisi olmasının nedeni: `credentials: true` ile çalışan bir CORS
  // yapılandırmasında `Access-Control-Allow-Origin` ASLA `*`/wildcard/regex olamaz (security-agent
  // kuralı) — ikinci sabit origin'in tanınabilmesi için allow-list'e AYRICA eklenmesi gerekir.
  DOCTOR_FRONTEND_URL: z.string().url().optional(),
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

  // `.claude/architect-scope-telehealth-template.md` §4.4 (KARAR C) — LiveKit konsültasyon
  // odası, `STRIPE_SECRET_KEY` ile BİREBİR AYNI desen: üçü de boş bırakılırsa
  // `modules/telehealth/lib/livekit.ts::isLiveKitConfigured()` false döner ve
  // `POST /appointments/{id}/meeting-token` `503 LIVEKIT_NOT_CONFIGURED` verir — özellik
  // sessizce devre dışı kalır, hiçbir başka akış bundan ETKİLENMEZ.
  LIVEKIT_URL: z.string().default(""),
  LIVEKIT_API_KEY: z.string().default(""),
  LIVEKIT_API_SECRET: z.string().default(""),
  // Token TTL — kısa tutulur (§8: token süresi randevu penceresine yakın, kaçırılmış bir
  // token'ın uzun süre geçerli kalmaması için). Dakika.
  LIVEKIT_TOKEN_TTL_MIN: z.coerce.number().int().positive().max(60).default(15),

  // `.claude/architect-scope-telehealth-template.md` (TUR 3, bağlayıcı) — LiveKit Egress
  // arşivleme. Egress BACKEND KONTEYNERİNİN DIŞINDA çalışır: `S3_ENDPOINT` docker-içi bir adres
  // (ör. http://minio:9000) ise Egress ona ULAŞAMAYABİLİR — bu yüzden AYRI, dışarıdan erişilebilir
  // bir endpoint tanımlanabilir. Boşsa mevcut `S3_ENDPOINT` kullanılır.
  LIVEKIT_EGRESS_S3_ENDPOINT: z.string().default(""),
  // LiveKit'in `egress_*` olaylarını POST edeceği MUTLAK URL. BOŞSA kayıt özelliği
  // YAPILANDIRILMAMIŞ sayılır (503) — webhook olmadan dosya asla arşivlenemez, S3'te
  // şifrelenmemiş yetim nesne kalırdı ("dürüst yapılandırılmamışlık" — LIVEKIT_NOT_CONFIGURED/
  // PAYMENTS_NOT_CONFIGURED İLE AYNI felsefe).
  LIVEKIT_EGRESS_WEBHOOK_URL: z.string().default(""),

  // `GET /doctor/earnings` (§9.7 TADİLAT) — sabit GLOBAL platform komisyon oranı (yüzde).
  // Doktor bazında override YOKTUR (bu turun kapsamı dışı); tanımsızsa makul bir varsayılana
  // (%15) düşer, `LIVEKIT_TOKEN_TTL_MIN` ile AYNI "opsiyonel, mantıklı varsayılanlı" desen.
  PLATFORM_COMMISSION_RATE_PERCENT: z.coerce.number().min(0).max(100).default(15),

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

  // `.claude/architect-scope-telehealth-template.md` §9.7.5 KARAR J +
  // `.claude/compliance-notes-telehealth.md` "TUR 2" KRİTİK ŞART — sağlık verisi (şikâyet notu
  // eki, reçete/tahlil/radyoloji belgesi, `AppointmentDocument`) için ÖZEL depo. BAĞLAYICI:
  // `plugins/uploads.ts::UPLOAD_DIR`'ın (`/app/uploads`, `@fastify/static` ile kimlik
  // doğrulamasız servis edilir) ALT DİZİNİ OLAMAZ — devops-agent tarafından
  // `/app/storage/private-uploads` (host'ta ayrı bir named volume) olarak hazırlandı, bkz.
  // INFRA.md/docker-compose.yml/backend/.env.example. `lib/telehealth-document-storage.ts`
  // bu değeri TÜKETİR; `@fastify/static`'e ASLA kaydedilmez.
  PRIVATE_UPLOAD_DIR: z.string().default("./storage/private-uploads"),

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

  // `.claude/architect-scope-demo-payment-doctor-counters.md` İstek 1 §1.3 — geliştirme/demo ödeme
  // simülatörü (`POST /appointments/bookings/{bookingId}/demo-pay`) yalnızca `NODE_ENV !== "production"`
  // VE bu bayrak `true` iken var olur. `SMTP_SECURE`/`CUSTOM_CODE_ENABLED` İLE BİREBİR AYNI desen —
  // `z.coerce.boolean()` KASITLI OLARAK KULLANILMADI (boş olmayan HER string'i, örn. "false", `true`
  // yapardı). Prod'da bu bayrağın `true` olması aşağıda (parse SONRASI) GÜRÜLTÜLÜ bir hatayla boot'u
  // DURDURUR — sessiz yok sayma, yanlış `.env` kopyasının fark edilmeden prod'a gitmesi demektir.
  ENABLE_DEMO_PAYMENTS: z
    .enum(["true", "false"])
    .default("false")
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

// `.claude/architect-scope-demo-payment-doctor-counters.md` İstek 1 §1.3 — fail-closed boot koruması
// (ZORUNLU). Zod şeması `ENABLE_DEMO_PAYMENTS`'i tek başına geçerli sayar (dev/test/prod hepsinde
// `true`/`false` kabul eder) — prod'da `true` olması AYRICA burada, parse SONRASI, açık ve okunur bir
// hatayla ENGELLENİR. Sessizce yok saymak (ör. `isDemoPaymentsEnabled` hesaplarken `isProd` ile
// AND'lemek) yanlış `.env` kopyasının prod'a fark edilmeden gitmesi demektir; bu proje sessiz düşüşü
// değil gürültülü hatayı seçer.
if (isProd && env.ENABLE_DEMO_PAYMENTS) {
  // eslint-disable-next-line no-console
  console.error(
    "Ortam değişkenleri geçersiz: ENABLE_DEMO_PAYMENTS=true, NODE_ENV=production ile birlikte KULLANILAMAZ " +
      "(geliştirme/demo ödeme simülatörü üretimde asla açılamaz — bkz. .claude/architect-scope-demo-payment-doctor-counters.md)."
  );
  process.exit(1);
}

// İstek 1 §1.3 madde 1 — "VEYA" değil, üç katmanlı gating'in İLK katmanı (VE, iki bayrak birden).
// Yukarıdaki fail-closed koruması sayesinde bu satıra ulaşıldığında `isProd && env.ENABLE_DEMO_PAYMENTS`
// hiçbir zaman `true` olamaz; `env.NODE_ENV !== "production"` kontrolü yine de AÇIKÇA yazılır (tek
// başına `NODE_ENV !== "production"` YETERSİZDİR — staging/CI çoğu zaman development/test ile koşar).
export const isDemoPaymentsEnabled = env.NODE_ENV !== "production" && env.ENABLE_DEMO_PAYMENTS;
