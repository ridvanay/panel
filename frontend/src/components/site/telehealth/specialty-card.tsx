import Link from "next/link";
import type { Specialty } from "@/lib/api/types";
import { resolveIcon } from "@/lib/page-builder/icon-options";
import { withLocalePrefix } from "@/lib/i18n/site-path";

/**
 * Görev (2026-09-16) — `/specialties` ızgara kartı. `doctor-card.tsx` İLE AYNI yüzey diliyle
 * (`rounded-[var(--site-radius)] border border-border bg-surface`), ikon `icon-box-block.tsx` /
 * `IconPickerField` İLE AYNI lucide-react sözlüğünden (`resolveIcon`) render edilir — ikinci bir
 * ikon haritası İCAT EDİLMEZ.
 */

/** `icon-box-block.tsx`/`slide-layer.tsx` İLE AYNI `react-hooks/static-components` yanlış-pozitifi kaçınma deseni. */
function iconGlyph(name: string, className: string) {
  const Icon = resolveIcon(name);
  return <Icon className={className} aria-hidden="true" />;
}
export function SpecialtyCard({
  specialty,
  activeLocaleCode,
  defaultLocaleCode,
}: {
  specialty: Specialty;
  activeLocaleCode?: string;
  defaultLocaleCode?: string;
}) {
  const href = activeLocaleCode
    ? withLocalePrefix(`/specialties/${specialty.slug}`, activeLocaleCode, defaultLocaleCode ?? activeLocaleCode)
    : `/specialties/${specialty.slug}`;

  return (
    <Link
      href={href}
      className="block rounded-[var(--site-radius)] border border-border bg-surface p-5 transition-all duration-150 hover:border-primary/30 hover:shadow-sm"
    >
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        {iconGlyph(specialty.icon, "h-6 w-6")}
      </span>
      <h3 className="mt-3 text-center font-semibold text-foreground">{specialty.name}</h3>
      {specialty.description && (
        <p className="mt-1.5 line-clamp-2 text-center text-sm text-foreground/60">{specialty.description}</p>
      )}
    </Link>
  );
}
