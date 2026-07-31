import Link from "next/link";
import { ChevronRight } from "lucide-react";

/**
 * `sidebar.tsx`'teki `navItems` ile birebir aynı href→label eşlemesi (referans alındı,
 * o dosyaya dokunulmadı — bkz. `command-palette.tsx`'teki aynı pattern).
 */
const NAV_LABELS: { href: string; label: string }[] = [
  { href: "/admin", label: "Genel Bakış" },
  { href: "/admin/pages", label: "Sayfalar" },
  { href: "/admin/blog", label: "Blog" },
  { href: "/admin/stats", label: "İstatistikler" },
  { href: "/admin/media", label: "Medya" },
  { href: "/admin/navigation", label: "Navigasyon" },
  { href: "/admin/users", label: "Kullanıcılar" },
  { href: "/admin/system", label: "Sistem Sağlığı" },
  { href: "/admin/notifications/templates", label: "Bildirimler" },
  { href: "/admin/settings/security", label: "Güvenlik" },
  { href: "/admin/settings", label: "Ayarlar" },
];

/** Bilinen sabit alt-segment adları (`new`, `categories` vb.) için Türkçe etiket. Bilinmeyen (dinamik id/key) segmentler "Düzenle" varsayar. */
function subSegmentLabel(segment: string): string {
  if (segment === "new") return "Yeni";
  if (segment === "categories") return "Kategoriler";
  return "Düzenle";
}

interface Crumb {
  label: string;
  href: string | null;
}

/** Belirtilen pathname için breadcrumb dizisini üretir; üst düzey/nav'la birebir eşleşen rotalarda `null` döner. */
export function buildBreadcrumbs(pathname: string): Crumb[] | null {
  if (pathname === "/admin") return null;

  const matched = [...NAV_LABELS]
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

  const crumbs: Crumb[] = [{ label: matched.label, href: matched.href }];
  remainder.forEach((segment, index) => {
    const isLast = index === remainder.length - 1;
    crumbs.push({
      label: subSegmentLabel(segment),
      href: isLast ? null : `${matched.href}/${remainder.slice(0, index + 1).join("/")}`,
    });
  });

  return crumbs;
}

export function AdminBreadcrumb({ pathname }: { pathname: string }) {
  const crumbs = buildBreadcrumbs(pathname);
  if (!crumbs || crumbs.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-xs">
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        return (
          <span key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
            {index > 0 && <ChevronRight className="h-3 w-3 text-foreground/30" />}
            {isLast || !crumb.href ? (
              <span className="font-medium text-foreground">{crumb.label}</span>
            ) : (
              <Link href={crumb.href} className="text-foreground/50 transition-colors hover:text-foreground/80">
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
