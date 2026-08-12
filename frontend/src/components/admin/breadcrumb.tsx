"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useT } from "@/context/i18n-context";

/**
 * `sidebar.tsx`'teki `navItems` ile birebir aynı href→anahtar eşlemesi (referans alındı,
 * o dosyaya dokunulmadı — bkz. `command-palette.tsx`'teki aynı pattern). Etiketler `nav.*`
 * sözlük anahtarlarıyla `t()` üzerinden çözümlenir — sabit Türkçe string YOK.
 */
const NAV_LABEL_KEYS: { href: string; labelKey: string }[] = [
  { href: "/admin", labelKey: "nav.overview" },
  { href: "/admin/pages", labelKey: "nav.pages" },
  { href: "/admin/blog", labelKey: "nav.blog" },
  { href: "/admin/stats", labelKey: "nav.stats" },
  { href: "/admin/media", labelKey: "nav.media" },
  { href: "/admin/navigation", labelKey: "nav.navigation" },
  { href: "/admin/import", labelKey: "nav.import" },
  { href: "/admin/users", labelKey: "nav.users" },
  { href: "/admin/system", labelKey: "nav.system" },
  { href: "/admin/notifications/templates", labelKey: "nav.emailTemplates" },
  { href: "/admin/settings/security", labelKey: "nav.security" },
  { href: "/admin/settings", labelKey: "nav.settings" },
];

/**
 * Bilinen sabit alt-segment adları (`new`, `categories` vb.) için sözlük anahtarı.
 * Bilinmeyen (dinamik id/key) segmentler varsayılan olarak "Düzenle" sayılır — ANCAK
 * `/admin/import/<jobId>` bir düzenleyici DEĞİL, rapor/onay ekranıdır, bu yüzden
 * `parentHref` ile özel durum tanımlanır.
 */
function subSegmentLabelKey(segment: string, parentHref: string): string {
  if (segment === "new") return "breadcrumb.new";
  if (segment === "categories") return "breadcrumb.categories";
  if (parentHref === "/admin/import") return "breadcrumb.jobDetail";
  return "breadcrumb.edit";
}

interface Crumb {
  labelKey: string;
  href: string | null;
}

/** Belirtilen pathname için breadcrumb dizisini üretir; üst düzey/nav'la birebir eşleşen rotalarda `null` döner. */
export function buildBreadcrumbs(pathname: string): Crumb[] | null {
  if (pathname === "/admin") return null;

  const matched = [...NAV_LABEL_KEYS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) =>
      item.href === "/admin" ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)
    );

  if (!matched) {
    // navItems'da olmayan üst düzey bir rota (örn. /admin/logs) — tek segmentse gösterme.
    const rest = pathname.replace(/^\/admin\/?/, "").split("/").filter(Boolean);
    if (rest.length <= 1) return null;
    return null;
  }

  if (matched.href === pathname) return null;

  const remainder = pathname.slice(matched.href.length).split("/").filter(Boolean);
  if (remainder.length === 0) return null;

  const crumbs: Crumb[] = [{ labelKey: matched.labelKey, href: matched.href }];
  remainder.forEach((segment, index) => {
    const isLast = index === remainder.length - 1;
    crumbs.push({
      labelKey: subSegmentLabelKey(segment, matched.href),
      href: isLast ? null : `${matched.href}/${remainder.slice(0, index + 1).join("/")}`,
    });
  });

  return crumbs;
}

export function AdminBreadcrumb({ pathname }: { pathname: string }) {
  const t = useT();
  const crumbs = buildBreadcrumbs(pathname);
  if (!crumbs || crumbs.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-xs">
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        const label = t(crumb.labelKey);
        return (
          <span key={`${crumb.labelKey}-${index}`} className="flex items-center gap-1.5">
            {index > 0 && <ChevronRight className="h-3 w-3 text-foreground/30" />}
            {isLast || !crumb.href ? (
              <span className="font-medium text-foreground">{label}</span>
            ) : (
              <Link href={crumb.href} className="text-foreground/50 transition-colors hover:text-foreground/80">
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
