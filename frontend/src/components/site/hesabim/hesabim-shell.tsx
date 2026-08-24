"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Heart, MapPin, Receipt, UserRound, type LucideIcon } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface HesabimTab {
  key: string;
  label: string;
  /** Locale-siz, kök-göreceli yol — `useLocalizePath()` ile öneklenir. */
  path: string;
  icon: LucideIcon;
  /** `true` ise yalnızca `products` modülü açıkken sekme listesine girer (§4.3). */
  moduleGated: boolean;
}

const TABS: HesabimTab[] = [
  { key: "profil", label: "Profilim & Güvenlik", path: "/hesabim/profil", icon: UserRound, moduleGated: false },
  { key: "adreslerim", label: "Adreslerim", path: "/hesabim/adreslerim", icon: MapPin, moduleGated: false },
  { key: "siparislerim", label: "Siparişlerim", path: "/hesabim/siparislerim", icon: Receipt, moduleGated: true },
  { key: "favorilerim", label: "Favori Ürünlerim", path: "/hesabim/favorilerim", icon: Heart, moduleGated: true },
];

interface HesabimShellProps {
  productsModuleEnabled: boolean;
  children: ReactNode;
}

/**
 * §customer-portal §4.3/§7.2, design-notes §1/§2 — sol sabit sekme (masaüstü) + üstte yatay
 * kaydırılabilir sekme çubuğu (mobil), TEK auth guard'ı. Sekme görünürlüğü bir GÜVENLİK
 * önlemi DEĞİLDİR — `role === "CUSTOMER"` koşulu KULLANILMAZ (§10.21.7).
 */
export function HesabimShell({ productsModuleEnabled, children }: HesabimShellProps) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const localize = useLocalizePath();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, router, pathname]);

  const visibleTabs = TABS.filter((tab) => !tab.moduleGated || productsModuleEnabled);

  // `status === "loading"` VEYA henüz yönlendirme tamamlanmadıysa ("unauthenticated") hiçbir
  // alt sayfa/veri çekimi mount edilmez — `app/admin/layout.tsx`'teki
  // `redirectingEditorFromDashboard` deseniyle AYNI ilke.
  if (status !== "authenticated") {
    return (
      <div className="mx-auto flex max-w-5xl justify-center px-4 py-24 sm:px-6">
        <Spinner className="h-6 w-6 text-[var(--site-primary)]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">Hesabım</h1>
        <p className="mt-1 text-sm text-foreground/60">Profilinizi, adreslerinizi ve siparişlerinizi yönetin.</p>
      </div>

      <div className="mt-6 flex flex-col gap-6 md:flex-row md:items-start">
        <nav aria-label="Hesap bölümleri" className="hidden space-y-1 md:flex md:w-56 md:shrink-0 md:flex-col">
          {visibleTabs.map((tab) => {
            const href = localize(tab.path);
            const active = pathname === href || pathname.startsWith(`${href}/`);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.key}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-foreground/70 hover:bg-surface-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <nav
          aria-label="Hesap bölümleri"
          className="flex gap-2 overflow-x-auto pb-1 md:hidden [-webkit-overflow-scrolling:touch]"
        >
          {visibleTabs.map((tab) => {
            const href = localize(tab.path);
            const active = pathname === href || pathname.startsWith(`${href}/`);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.key}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border text-foreground/70 hover:bg-surface-muted"
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <div className="min-w-0 max-w-2xl flex-1">{children}</div>
      </div>
    </div>
  );
}
