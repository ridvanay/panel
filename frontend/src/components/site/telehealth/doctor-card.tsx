import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import type { DoctorProfile } from "@/lib/api/types";
import { formatPriceFromCents } from "@/lib/format-price";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DoctorAvatarMedia } from "@/components/site/telehealth/doctor-avatar";
import { cn } from "@/lib/utils";

/**
 * `.claude/design-notes-telehealth.md` §2 — doktor kartı. Izgara (`/doctors`) VE profil sayfasının
 * üst özet kartı AYNI yapıyı paylaşır, yalnızca boyut (`size`) değişir. Fotogerçekçi/AI insan
 * görseli YASAK ([DTI] §9.3) — gerçek `Media` yoksa DAİMA monogram + gradyan fallback. Görsel
 * render'ı (`SafeImage` + yüklenemedi-fallback) `doctor-avatar.tsx`'te ortak — bkz. o dosyanın
 * bug fix yorumu (qa-agent, 2026-09-11: düz `<img>` Docker'da tarayıcı-taraflı çözülemeyen bir
 * host'a bakıyordu).
 */

function DoctorAvatar({ doctor, size }: { doctor: DoctorProfile; size: "sm" | "lg" }) {
  const sizeClassName = size === "sm" ? "h-16 w-16 rounded-full" : "h-24 w-24 rounded-full";
  const textClassName = size === "sm" ? "text-lg" : "text-2xl";
  return (
    <div className="relative shrink-0">
      <DoctorAvatarMedia doctor={doctor} sizeClassName={sizeClassName} textClassName={textClassName} sizes={size === "sm" ? "64px" : "96px"} />
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
  intlLocale,
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
  /**
   * `formatPriceFromCents`'in `locale` parametresi — verilmezse fonksiyonun kendi varsayılanı
   * (`"tr-TR"`) kullanılır. `contentLocaleToIntl(lang)` ile üretilir (site İÇERİK dili, admin
   * panel dili DEĞİL — bkz. `lib/i18n/content-locale-to-intl.ts`).
   */
  intlLocale?: string;
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
        <span className="font-semibold text-foreground">{formatPriceFromCents(doctor.sessionPriceCents, doctor.currency, intlLocale)}</span>
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
