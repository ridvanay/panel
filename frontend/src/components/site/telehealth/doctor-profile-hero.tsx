import { BadgeCheck, Briefcase, Stethoscope } from "lucide-react";
import type { DoctorProfile } from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";
import { DoctorAvatarMedia } from "@/components/site/telehealth/doctor-avatar";

/**
 * `.claude/design-notes-doctor-portfolio-console.md` §1.1 — koyu lacivert kurumsal başlık bandı,
 * [TDN] §2.1.2'yi SUPERSEDE eder. Zemin `secondaryColor` (`#0F172A`, ZATEN kurulu kök token) +
 * edge-to-edge tam genişlik; bu bileşenin KENDİSİ yalnızca bandın İÇERİĞİNİ render eder — tam
 * genişlik zemin div'i `doctors/[slug]/page.tsx`'te kurulur (bu bileşen kendi `max-w`/`px`
 * konteynerini BİLMEZ, çağıran sayfa yönetir).
 *
 * §1.1.1 WCAG AA doğrulaması (bağlayıcı sonuç): teal (`primaryColor`, `#0F766E`) bu bantta
 * yalnızca OPAK rozet zemini veya ikon/kenarlık olarak kullanılır — ASLA düz metin rengi (koyu
 * zeminde 3.26:1, FAIL). Gerçek metin DAİMA `text-white`/`text-white/70`.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  tr: "Türkçe",
  en: "İngilizce",
  de: "Almanca",
  fr: "Fransızca",
  es: "İspanyolca",
  ar: "Arapça",
};

/** §1.1.2 — "koyu zemin çip'i" taban sınıfı, bu bantta İLK KEZ tanımlanan, blur/glow İÇERMEYEN düz alfa-şeffaflık. */
const DARK_CHIP_BASE =
  "inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-xs font-medium text-white/90";

export function DoctorProfileHero({ doctor }: { doctor: DoctorProfile }) {
  const languagesFullLabel = doctor.languages.map((code) => LANGUAGE_NAMES[code] ?? code.toUpperCase()).join(", ");

  return (
    <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-start sm:gap-6">
      <div className="h-28 w-28 shrink-0 overflow-hidden rounded-[var(--site-radius)] ring-1 ring-white/15 sm:h-36 sm:w-36">
        <DoctorAvatarMedia doctor={doctor} sizeClassName="h-full w-full" textClassName="text-3xl sm:text-4xl" sizes="144px" priority />
      </div>

      <div className="min-w-0 flex-1">
        {/* `isVerified === false` iken hiçbir şey render edilmez — sahte negatif sinyal yok. */}
        {doctor.isVerified && (
          <Badge tone="primary" solid size="lg" className="gap-1.5">
            <BadgeCheck className="h-4 w-4" aria-hidden="true" />
            Doğrulanmış Hekim
          </Badge>
        )}

        <h1 className="mt-3 break-words text-2xl font-semibold text-white sm:text-3xl">
          {doctor.title} {doctor.fullName}
        </h1>

        {/* Uzmanlık — koyu zeminde teal DÜZ METİN YASAK, opak teal rozet kullanılır. */}
        <Badge tone="primary" solid size="lg" className="mt-3 gap-1.5">
          <Stethoscope className="h-4 w-4" aria-hidden="true" />
          {doctor.specialty?.name ?? "Genel Danışmanlık"}
        </Badge>

        {/* Alt uzmanlık/merkez — DÜZ METİN, teal DEĞİL, white/70. */}
        {doctor.subSpecialty && <p className="mt-2 text-sm text-white/70">{doctor.subSpecialty}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {/* Deneyim rozeti — [DPI] §1.1 `experienceYears` DTO'da TÜRETİLİR, bu bant hiçbir hesap
              yapmaz. `Briefcase` ikonu Özgeçmiş zaman çizelgesindeki `EXPERIENCE` girdisiyle AYNI
              (bilinçli tekrar). */}
          {doctor.experienceYears != null && (
            <Badge tone="primary" solid size="sm" className="gap-1">
              <Briefcase className="h-3 w-3" aria-hidden="true" />
              {doctor.experienceYears} Yıl Deneyim
            </Badge>
          )}

          {doctor.languages.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label={`Konuşulan diller: ${languagesFullLabel}`}>
              {doctor.languages.map((code) => (
                <span key={code} className={DARK_CHIP_BASE}>
                  {code.toUpperCase()}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
