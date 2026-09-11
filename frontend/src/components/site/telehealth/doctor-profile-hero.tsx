import { BadgeCheck, Stethoscope } from "lucide-react";
import type { DoctorProfile } from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";
import { initialsFromFullName } from "@/components/site/telehealth/doctor-card";

/**
 * `.claude/design-notes-telehealth.md` §2.1.2 — doktor detay sayfasının hero başlık satırı.
 * `DoctorCard`'ın (§2) ızgara avatarından KASITLI olarak farklı (yumuşak köşeli KARE, dairesel
 * DEĞİL) — `initialsFromFullName` ve marka gradyanı (`from-[#0F766E] to-[#0369A1]`) `doctor-card.tsx`
 * ile BİREBİR aynı, YENİ bir hash-renk paleti İCAT EDİLMEDİ. İnteraktif hiçbir öğe yok, bu yüzden
 * bir Server Component olarak kalır (`"use client"` GEREKMEZ).
 */
const LANGUAGE_NAMES: Record<string, string> = {
  tr: "Türkçe",
  en: "İngilizce",
  de: "Almanca",
  fr: "Fransızca",
  es: "İspanyolca",
  ar: "Arapça",
};

export function DoctorProfileHero({ doctor }: { doctor: DoctorProfile }) {
  const languagesFullLabel = doctor.languages.map((code) => LANGUAGE_NAMES[code] ?? code.toUpperCase()).join(", ");

  return (
    <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-start sm:gap-6">
      <div className="h-28 w-28 shrink-0 overflow-hidden rounded-[var(--site-radius)] sm:h-36 sm:w-36">
        {doctor.avatarMedia ? (
          // eslint-disable-next-line @next/next/no-img-element -- avatar URL'si medya kütüphanesinden gelir, next/image remotePatterns kapsamı dışı olabilir (doctor-card.tsx ile AYNI istisna)
          <img
            src={doctor.avatarMedia.url}
            alt={doctor.avatarMedia.altText ?? ""}
            className="h-full w-full border border-border object-cover"
          />
        ) : (
          <div
            className="flex h-full w-full select-none items-center justify-center bg-gradient-to-br from-[#0F766E] to-[#0369A1] text-3xl font-semibold text-white sm:text-4xl"
            aria-hidden="true"
          >
            {initialsFromFullName(doctor.fullName)}
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="break-words text-2xl font-semibold text-foreground sm:text-3xl">
            {doctor.title} {doctor.fullName}
          </h1>
          {/* `isVerified === false` iken hiçbir şey render edilmez — §2 ile AYNI ilke, sahte
              negatif sinyal yok. */}
          {doctor.isVerified && (
            <Badge tone="primary" solid size="lg" className="gap-1">
              <BadgeCheck className="h-4 w-4" aria-hidden="true" />
              Doğrulanmış Hekim
            </Badge>
          )}
        </div>

        <div className="mt-3">
          <Badge tone="primary" size="lg" className="gap-1.5">
            <Stethoscope className="h-4 w-4" aria-hidden="true" />
            {doctor.specialty?.name ?? "Genel Danışmanlık"}
          </Badge>
        </div>

        {doctor.languages.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`Konuşulan diller: ${languagesFullLabel}`}>
            {doctor.languages.map((code) => (
              <Badge key={code} tone="neutral" size="sm">
                {code.toUpperCase()}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
