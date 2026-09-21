"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Bug-fix turu (2026-09-21, kullanıcı talebi) — `/consultation/[id]` altında (`layout.tsx` +
 * `[id]/page.tsx` + `consultation-room.tsx`) beklenmeyen bir render hatası artık BURADA
 * yakalanır; eskiden bu segmentin YEREL bir `error.tsx`'i olmadığı için hata kök `global-error.tsx`'e
 * kadar yükselip TÜM sayfayı (site başlığı/navigasyonu dahil) "Beklenmeyen bir hata oluştu" genel
 * ekranıyla DEĞİŞTİRİYORDU. Bilinen/beklenen erişim reddi durumları (misafir token'ı geçersiz,
 * oturum yok) BU BOUNDARY'E hiç DÜŞMEZ — `consultation-room.tsx::ConsultationRoom` bunları kendi
 * `try/catch`'i + `ConsultationAccessGate`'i ile ZATEN inline olarak ele alır (bkz. o dosyanın
 * dosya başı yorumu); bu dosya yalnızca GERÇEKTEN beklenmeyen bir render hatası için son savunma
 * hattıdır. `products/error.tsx` İLE AYNI desen (`reset`/konsola loglama), yalnızca metin telehealth
 * bağlamına uyarlandı + "Randevularım"a dönüş bağlantısı eklendi (kullanıcının çıkmaz bir yolda
 * kalmaması için).
 */
export default function ConsultationError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // observability-agent'ın Sentry entegrasyonu bu konsol çıktısını da yakalar; ek bir raporlama mantığı BU turun kapsamı DEĞİL.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-24 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-danger/10 text-danger">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </span>
      <h1 className="text-lg font-semibold text-foreground">Görüşmeye ulaşılamadı</h1>
      <p className="text-sm text-foreground/60">
        Bu görüşme sayfası yüklenirken beklenmeyen bir sorun oluştu. Lütfen tekrar deneyin veya randevularım
        sayfasından tekrar giriş yapın.
      </p>
      <div className="mt-2 flex items-center gap-3">
        <Button onClick={reset} className="rounded-[var(--site-radius)]">
          Tekrar Dene
        </Button>
        <Link href="/patient/appointments" className="text-sm font-medium text-primary hover:underline">
          Randevularım
        </Link>
      </div>
    </div>
  );
}
