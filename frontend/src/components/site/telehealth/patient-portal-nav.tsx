"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock, ClipboardList, FileText, LayoutDashboard, UserCog } from "lucide-react";
import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { cn } from "@/lib/utils";

/**
 * `.claude/design-notes-telehealth.md` §14.1 — hasta portalı gezinme paterni. TEK bileşen, `variant`
 * prop'uyla iki render biçimi üretir (`rail` — `lg:` sol ray, `strip` — `<lg` yatay kaydırılabilir
 * şerit); rota/etiket/ikon listesi TEK yerde tanımlıdır (ikili bakım yükü YOK). `.claude/architect-scope-telehealth-template.md`
 * §9.8.3 — rota haritası (`/patient`, `/patient/appointments`, `/patient/documents`,
 * `/patient/prescriptions`, `/patient/profile`); §9.8.2 KARAR M'nin bağlayıcı çerçevesi.
 */

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<LucideProps>;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/patient", label: "Genel Bakış", icon: LayoutDashboard },
  { href: "/patient/appointments", label: "Randevularım", icon: CalendarClock },
  { href: "/patient/documents", label: "Belgelerim", icon: FileText },
  { href: "/patient/prescriptions", label: "Reçetelerim", icon: ClipboardList },
  { href: "/patient/profile", label: "Profilim", icon: UserCog },
];

const BASE_LINK_CLASS =
  "inline-flex items-center gap-2.5 rounded-[var(--site-radius)] px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface";
const ACTIVE_LINK_CLASS = "bg-primary/10 text-primary";
const INACTIVE_LINK_CLASS = "text-foreground/70 hover:bg-surface-muted hover:text-foreground";

function isNavItemActive(pathname: string | null, localizedHref: string): boolean {
  if (!pathname) return false;
  return pathname === localizedHref || pathname.startsWith(`${localizedHref}/`);
}

export function PatientPortalNav({ variant, className }: { variant: "rail" | "strip"; className?: string }) {
  const pathname = usePathname();
  const localize = useLocalizePath();
  const localizedOverviewHref = localize("/patient");

  return (
    <nav
      aria-label="Hasta portalı gezinmesi"
      className={cn(
        variant === "rail" ? "flex flex-col gap-1" : "-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6",
        className
      )}
    >
      {NAV_ITEMS.map((item) => {
        const localizedHref = localize(item.href);
        // "/patient" (Genel Bakış) TAM eşleşme GEREKTİRİR — aksi halde diğer 4 rotanın hepsinde
        // (prefix eşleşmesiyle) YANLIŞLIKLA aktif görünürdü.
        const active = item.href === "/patient" ? pathname === localizedOverviewHref : isNavItemActive(pathname, localizedHref);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={localizedHref}
            aria-current={active ? "page" : undefined}
            className={cn(BASE_LINK_CLASS, active ? ACTIVE_LINK_CLASS : INACTIVE_LINK_CLASS, variant === "strip" && "shrink-0 whitespace-nowrap")}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
