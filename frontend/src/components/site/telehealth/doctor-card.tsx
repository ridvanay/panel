import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import type { DoctorProfile } from "@/lib/api/types";
import { formatPriceFromCents } from "@/lib/format-price";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * `.claude/design-notes-telehealth.md` §2 — doktor kartı. Izgara (`/doctors`) VE profil sayfasının
 * üst özet kartı AYNI yapıyı paylaşır, yalnızca boyut (`size`) değişir. Fotogerçekçi/AI insan
 * görseli YASAK ([DTI] §9.3) — gerçek `Media` yoksa DAİMA monogram + gradyan fallback.
 */

function initialsFromFullName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

function DoctorAvatar({ doctor, size }: { doctor: DoctorProfile; size: "sm" | "lg" }) {
  const dimensionClass = size === "sm" ? "h-16 w-16 text-lg" : "h-24 w-24 text-2xl";
  return (
    <div className="relative shrink-0">
      {doctor.avatarMedia ? (
        // eslint-disable-next-line @next/next/no-img-element -- dairesel küçük avatar, next/image remotePatterns kapsamı dışı olabilir
        <img
          src={doctor.avatarMedia.url}
          alt={doctor.avatarMedia.altText ?? ""}
          className={cn("rounded-full border border-border object-cover", dimensionClass)}
        />
      ) : (
        <div
          className={cn(
            "flex items-center justify-center rounded-full font-semibold text-white",
            "bg-gradient-to-br from-[#0F766E] to-[#0369A1]",
            dimensionClass
          )}
          aria-hidden="true"
        >
          {initialsFromFullName(doctor.fullName)}
        </div>
      )}
      {doctor.isVerified && (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white ring-2 ring-surface">
          <BadgeCheck className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">Doğrulanmış hekim</span>
        </span>
      )}
    </div>
  );
}

export function DoctorCard({
  doctor,
  activeLocaleCode,
  defaultLocaleCode,
  size = "sm",
  ctaHref,
}: {
  doctor: DoctorProfile;
  activeLocaleCode?: string;
  defaultLocaleCode?: string;
  size?: "sm" | "lg";
  /**
   * CTA'nın hedefini `href`'ten (doktor profili) BAĞIMSIZ olarak override eder — profil
   * sayfasının kendisinde kullanıldığında (`doctors/[slug]/page.tsx`) "Randevu Al" kendi
   * sayfasına değil, sayfanın slot takvimine (`#randevu`) kaydırır
   * (`.claude/design-notes-telehealth.md` §2 CTA notu).
   */
  ctaHref?: string;
}) {
  const href = activeLocaleCode
    ? withLocalePrefix(`/doctors/${doctor.slug}`, activeLocaleCode, defaultLocaleCode ?? activeLocaleCode)
    : `/doctors/${doctor.slug}`;

  const languageNames: Record<string, string> = { tr: "Türkçe", en: "İngilizce", de: "Almanca", fr: "Fransızca", es: "İspanyolca", ar: "Arapça" };
  const languagesFullLabel = doctor.languages.map((code) => languageNames[code] ?? code.toUpperCase()).join(", ");

  return (
    <div className="rounded-[var(--site-radius)] border border-border bg-surface p-5 transition-all duration-150 hover:border-primary/30 hover:shadow-sm">
      <div className="flex items-center gap-4">
        <DoctorAvatar doctor={doctor} size={size} />
        <div className="min-w-0">
          <Link href={href} className="hover:underline">
            <h3 className={cn("truncate font-semibold text-foreground", size === "lg" ? "text-2xl sm:text-3xl" : "text-sm")}>
              {doctor.title} {doctor.fullName}
            </h3>
          </Link>
          <p className="text-sm text-foreground/60">{doctor.specialty?.name ?? "Genel"}</p>
        </div>
      </div>

      {doctor.languages.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label={`Konuşulan diller: ${languagesFullLabel}`}>
          {doctor.languages.map((code) => (
            <Badge key={code} tone="neutral" size="sm">
              {code.toUpperCase()}
            </Badge>
          ))}
        </div>
      )}

      <div className="my-3 border-t border-border/60" />

      <div className="flex items-baseline gap-1.5 text-sm">
        <span className="text-foreground/60">{doctor.sessionDurationMin} dk</span>
        <span aria-hidden="true">·</span>
        <span className="font-semibold text-foreground">{formatPriceFromCents(doctor.sessionPriceCents, doctor.currency)}</span>
      </div>

      <Link
        href={ctaHref ?? href}
        className={cn(
          buttonVariants({ variant: size === "lg" ? "default" : "outline", size: size === "lg" ? "lg" : "sm" }),
          "mt-3 w-full rounded-[var(--site-radius)]"
        )}
      >
        {size === "lg" ? "Randevu Al" : "Profili Gör"}
      </Link>
    </div>
  );
}
