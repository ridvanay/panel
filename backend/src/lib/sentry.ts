import * as Sentry from "@sentry/node";
import { env } from "../config/env";

// `SENTRY_DSN` tanımsız/boşsa Sentry init edilmez — `Sentry.captureException` gibi tüm
// SDK çağrıları DSN olmadan sessizce no-op'tur, bu yüzden çağıran kodun (bkz.
// plugins/error-handler.ts) ayrıca "aktif mi" kontrolü yapmasına gerek yoktur.
export const sentryEnabled = Boolean(env.SENTRY_DSN);

export function initSentry(): void {
  if (!sentryEnabled) return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    // Varsayılanı AÇIKÇA false: Sentry SDK'sının `sendDefaultPii` özelliği IP adresi,
    // cookie, request header'ları (authorization dahil) gibi PII'yi otomatik eklemeye
    // çalışır — security-agent'ın PII kuralına uymak için burada kasıtlı olarak kapalı
    // tutuluyor. Context'e SADECE error-handler.ts'in elle eklediği alanlar (user id,
    // route, method) gider.
    sendDefaultPii: false,
  });
}

export { Sentry };
