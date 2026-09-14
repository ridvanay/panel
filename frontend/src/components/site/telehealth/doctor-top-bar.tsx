"use client";

import Link from "next/link";
import { Bell, LogOut } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { useDoctorPortalContext } from "@/components/site/telehealth/doctor-portal-context";
import { DEFAULT_HEADER_LOGO_HEIGHT } from "@/lib/site-settings/logo";
import { cn } from "@/lib/utils";

interface DoctorTopBarProps {
  siteName: string;
  logoUrl: string | null;
  logoHeight: number | null;
}

/**
 * `.claude/architect-scope-doctor-subdomain.md` §5.4 — hekim portalının minimal üst çubuğu.
 * `(doctor)` ağacında `SiteHeader` HİÇ YOKTUR (§5.2/§5.3) — bu bileşen dört parçayı (kurum logosu ·
 * hekim adı/unvanı · bildirimler · çıkış) TEK başına taşır. `doctor-portal-shell.tsx`'teki eski
 * "Katman 1 YALNIZCA SiteHeader'da yaşar" kararı bu görevle YÜRÜRLÜKTEN KALKMIŞTIR — Katman 1
 * artık BURADADIR.
 *
 * Kurum logosu — `site-header.tsx`'in AYNI render deseni (doğal en-boy oranı, `headerLogoHeight`
 * ile yükseklik), `lib/site-settings/logo.ts::DEFAULT_HEADER_LOGO_HEIGHT` PAYLAŞILIR (tekrar
 * yazılmaz). Hekim adı/unvanı + bildirim + çıkış YALNIZCA profil doğrulandıktan (`status === "ready"`)
 * ya da bir hata (`"error"` — ör. `NOT_A_DOCTOR`/`TWO_FACTOR_REQUIRED`, kullanıcı yine de oturumdan
 * çıkabilmeli) sonra gösterilir; `/doctor/login`'de (`status === "skipped"`) yalnızca marka görünür.
 *
 * Bildirim rozeti — invariant 4'ün "İZİN VERİLEN GERİ ÇEKİLME"si: ikinci bir `GET /doctor/portal-feed`
 * isteği açan paylaşılan bir feed provider'ı YAZMAK YERİNE, zil sayımsız bir bağlantı olarak
 * `/doctor#doctor-portal-feed-card`'a gider — `DoctorPortalFeedCard` zaten `/doctor` sayfasında
 * TEK bir `GET /doctor/portal-feed` isteği atar, bu bağlantı İKİNCİ bir istek AÇMAZ.
 */
export function DoctorTopBar({ siteName, logoUrl, logoHeight }: DoctorTopBarProps) {
  const auth = useAuth();
  const localize = useLocalizePath();
  const { status, profile } = useDoctorPortalContext();

  const showIdentity = status === "ready" || status === "error";
  const showNotifications = status === "ready";
  const bookingsHref = localize("/doctor");

  return (
    <header className="border-b border-border bg-[var(--site-header-bg)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href={bookingsHref} className="flex shrink-0 items-center gap-2 text-sm font-semibold text-foreground" aria-label={`${siteName?.trim() || "Site"} — Hekim Portalı`}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- site-header.tsx ile AYNI desen (remotePatterns garanti değil)
            <img
              src={logoUrl}
              alt={siteName?.trim() || "Site"}
              className="block w-auto object-contain"
              style={{ height: `${logoHeight ?? DEFAULT_HEADER_LOGO_HEIGHT}px` }}
            />
          ) : (
            <span>{siteName?.trim() || "Site"}</span>
          )}
        </Link>

        {showIdentity && (
          <div className="flex items-center gap-4 text-sm text-foreground/70">
            {profile && (
              <span className="hidden font-medium text-foreground sm:inline">
                {profile.doctorProfile.title} {profile.doctorProfile.fullName}
              </span>
            )}
            {showNotifications && (
              <Link
                href={`${bookingsHref}#doctor-portal-feed-card`}
                aria-label="Portal Akışı ve Duyurular"
                className={cn("flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-muted")}
              >
                <Bell className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Bildirimler</span>
              </Link>
            )}
            <button
              type="button"
              onClick={() => void auth.logout()}
              aria-label="Çıkış yap"
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-surface-muted"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Çıkış Yap</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
