"use client";

import Link from "next/link";
import { Mic, UserCog, Video, Wallet } from "lucide-react";
import { useLocalizePath } from "@/context/locale-alternates-context";

/**
 * Grid görevi (2026-09-14) Görev 4 — sağ sidebar "Hızlı Kısayollar / Durum Özeti" mini-paneli.
 * `doctor-portal-shell.tsx`'teki AYNI `/doctor/earnings` ve `/doctor/profile` hedeflerine kısa
 * bağlantılar (üstteki shell navigasyonuyla KASITLI KÜÇÜK bir tekrar — dashboard içinde hızlı
 * erişim için kabul edilebilir).
 *
 * Kamera/mikrofon durumu: GERÇEK bir `navigator.mediaDevices.getUserMedia` PROBE'U YAPILMAZ —
 * hekim sadece dashboard'u açtığında istemeden tarayıcı izin isteği (permission prompt) tetiklenmesi
 * KÖTÜ UX olur ve bu görevin kapsamı DIŞINDADIR (kamera/mikrofon gerçek kontrolü zaten görüşme
 * odası akışının, `consultation-room.tsx`'in işi). Bunun yerine SADE, bilgilendirici statik bir
 * metin gösterilir — yanıltıcı bir "hazır/aktif" durumu UYDURULMAZ.
 */
export function DoctorPortalQuickLinksCard() {
  const localize = useLocalizePath();

  return (
    <section className="space-y-3 rounded-[var(--site-radius)] border border-border bg-surface p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground/70">Hızlı Kısayollar</h2>

      <nav className="flex flex-col gap-1 text-sm">
        <Link
          href={localize("/doctor/earnings")}
          className="inline-flex items-center gap-2 rounded-[var(--site-radius)] px-1.5 py-1.5 text-foreground/80 transition-colors hover:bg-surface-muted hover:text-primary"
        >
          <Wallet className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Kazançlarım
        </Link>
        <Link
          href={localize("/doctor/profile")}
          className="inline-flex items-center gap-2 rounded-[var(--site-radius)] px-1.5 py-1.5 text-foreground/80 transition-colors hover:bg-surface-muted hover:text-primary"
        >
          <UserCog className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Profilim
        </Link>
      </nav>

      <div className="flex items-start gap-2 rounded-[var(--site-radius)] border border-border/60 bg-surface-muted p-2.5 text-xs text-foreground/60">
        <div className="flex shrink-0 gap-1 pt-0.5">
          <Video className="h-3.5 w-3.5" aria-hidden="true" />
          <Mic className="h-3.5 w-3.5" aria-hidden="true" />
        </div>
        <p>Kamera ve mikrofon izni, görüşmeye katıldığınızda istenir.</p>
      </div>
    </section>
  );
}
