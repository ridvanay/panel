// Node.js runtime'da (Server Components, Route Handler'lar, Server Action'lar) çalışır.
// `src/instrumentation.ts::register()` içinden `NEXT_RUNTIME === "nodejs"` iken import edilir.
import * as Sentry from "@sentry/nextjs";

// `SENTRY_DSN` (server-side, `NEXT_PUBLIC_` PREFIX'İ YOK — istemciye asla gönderilmemeli)
// tanımsız/boşsa Sentry SDK'sı sessizce no-op kalır; hiçbir ortam değişkeni ZORUNLU değildir.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE) : 0,
  // security-agent'ın PII kuralına uymak için: IP adresi/cookie/header gibi veriler otomatik
  // eklenmez — backend/src/lib/sentry.ts ile aynı kasıtlı karar (bkz. o dosyadaki yorum).
  sendDefaultPii: false,
});
