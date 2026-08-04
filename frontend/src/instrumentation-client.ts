// Next.js 16 client instrumentation konvansiyonu (bkz. node_modules/next/dist/docs/01-app/
// 03-api-reference/03-file-conventions/instrumentation-client.md) — HTML yüklendikten SONRA,
// React hydration'dan ÖNCE, kullanıcı etkileşimi mümkün olmadan ÖNCE çalışır. Tarayıcıda
// (React render hataları, network hataları, unhandled promise rejection vb.) oluşan hataları
// yakalamak için en erken/doğru yer burasıdır.
import * as Sentry from "@sentry/nextjs";

// `NEXT_PUBLIC_SENTRY_DSN` tanımsız/boşsa Sentry SDK'sı sessizce no-op kalır — DSN olmadan
// hiçbir event ağa gönderilmez (varsayılan KAPALI, bkz. proje kökü CLAUDE.md).
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
    ? Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE)
    : 0,
  // security-agent'ın PII kuralına uymak için: IP adresi/cookie gibi veriler otomatik
  // eklenmez. Kullanıcı context'i (SADECE id, email/isim YOK) `context/auth-context.tsx`
  // tarafından `Sentry.setUser` ile ayrıca set edilir (bkz. o dosyadaki entegrasyon).
  sendDefaultPii: false,
});

export function onRouterTransitionStart(url: string): void {
  Sentry.addBreadcrumb({ category: "navigation", message: `Navigasyon: ${url}`, level: "info" });
}
