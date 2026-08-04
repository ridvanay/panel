// Edge runtime'da (middleware, edge route handler'lar) çalışır — bu projede henüz bir
// middleware.ts yok, ama Next.js `instrumentation.ts::register()`'ı her iki runtime için de
// çağırır; edge dalı boş bırakılırsa gelecekte eklenecek bir middleware sessizce izlenmez kalır.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE) : 0,
  sendDefaultPii: false,
});
