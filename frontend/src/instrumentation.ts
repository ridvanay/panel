import type { Instrumentation } from "next";

// Next.js 16 instrumentation dosya konvansiyonu (bkz. node_modules/next/dist/docs/01-app/
// 03-api-reference/03-file-conventions/instrumentation.md) — `register()` sunucu başlarken BİR
// KEZ çağrılır, `onRequestError` her sunucu-taraflı (Server Component/Route Handler/Server
// Action) hatasında tetiklenir. Bu, backend'in `error-handler.ts`'teki "beklenmedik 500"
// yakalama noktasının frontend karşılığıdır.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    // Sır yoksa admin kayıtları sitede ancak 60 sn'lik yedek yenilemeyle görünür — sessiz kalmasın.
    const { getRevalidateSecret } = await import("./lib/revalidate-secret");
    if (!getRevalidateSecret()) {
      console.warn(
        "[revalidate] REVALIDATE_SECRET tanımsız/boş (veya örnek yer tutucu) — POST /api/revalidate her isteği 401 ile reddeder; " +
          "admin değişiklikleri sitede ~60 sn sonra görünür. Backend ile AYNI değeri frontend/.env.local'e ekleyin (bkz. INFRA.md)."
      );
    }
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// `Sentry.captureRequestError` — sunucu tarafı render/route/action hatalarını, PII olmadan
// (yalnızca route bilgisi/hata mesajı) Sentry'ye iletir. `SENTRY_DSN` tanımsızsa no-op'tur.
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  const { captureRequestError } = await import("@sentry/nextjs");
  await captureRequestError(...args);
};
