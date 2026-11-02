"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/service-desk", label: "Masa ayarları" },
  { href: "/admin/service-desk/coordinators", label: "Koordinatörler" },
  { href: "/admin/service-desk/consultations", label: "Görüşmeler" },
];

/** Hizmet Masası alt gezinmesi (yan menüde tek öğe olduğundan sayfa içi sekmeler). */
export function ServiceDeskNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Hizmet masası bölümleri" className="flex flex-wrap gap-1">
      {TABS.map((tab) => {
        const active = pathname === tab.href || (tab.href !== "/admin/service-desk" && pathname.startsWith(`${tab.href}/`));
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-300",
              active ? "bg-primary text-primary-foreground" : "bg-surface-muted text-foreground/70 hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
