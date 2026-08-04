"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * Next.js App Router özel dosya konvansiyonu — kök `layout.tsx` içinde (veya render'ı
 * sırasında) yakalanamayan hataları yakalar. Bu, `instrumentation.ts::onRequestError`'ın
 * KAÇIRDIĞI tek senaryodur (React render hataları, client-side hydration hataları) — bu
 * yüzden `global-error.tsx` Sentry'nin resmi Next.js entegrasyon dokümantasyonunda AYRI bir
 * zorunlu adım olarak listelenir. Kök layout'un YERİNE geçer, bu yüzden kendi <html>/<body>'sini
 * tanımlamak zorundadır — normal `providers.tsx`/tasarım sistemi bileşenlerine güvenilemez
 * (hatanın kaynağı bizzat layout/providers olabilir).
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="tr">
      <body>
        <main
          style={{
            display: "flex",
            minHeight: "100vh",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1rem",
            padding: "2rem",
            textAlign: "center",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Beklenmeyen bir hata oluştu</h1>
          <p style={{ color: "#666", maxWidth: "28rem" }}>
            Sorun otomatik olarak bildirildi. Lütfen tekrar deneyin; sorun devam ederse bir süre sonra tekrar
            ziyaret edin.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "0.5rem 1.25rem",
              borderRadius: "0.375rem",
              border: "1px solid #ccc",
              background: "#111",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Tekrar dene
          </button>
        </main>
      </body>
    </html>
  );
}
