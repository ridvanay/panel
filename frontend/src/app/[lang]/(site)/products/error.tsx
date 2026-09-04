"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Next.js `error.tsx` — `products/page.tsx` `fetchProductCatalogServer` başarısız (ağ hatası/
 * `!res.ok`) olduğunda fırlattığı hatayı yakalar. "0 sonuç" (geçerli, boş durum) ile "API'ye
 * ulaşılamadı" (gerçek hata) burada AYRIŞIR — bkz. `page.tsx` yorumu.
 */
export default function ProductsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // observability-agent'ın Sentry entegrasyonu bu konsol çıktısını da yakalar; ek bir raporlama mantığı BU turun kapsamı DEĞİL.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-24 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-danger/10 text-danger">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </span>
      <h1 className="text-lg font-semibold text-foreground">Ürünler yüklenemedi</h1>
      <p className="text-sm text-foreground/60">
        Katalog verisine şu anda ulaşılamıyor. Lütfen tekrar deneyin.
      </p>
      <Button onClick={reset} className="mt-2 rounded-[var(--site-radius)]">
        Tekrar Dene
      </Button>
    </div>
  );
}
