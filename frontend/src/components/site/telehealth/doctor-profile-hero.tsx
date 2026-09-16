import { BadgeCheck, Briefcase, Building2, Stethoscope } from "lucide-react";
import type { DoctorProfile } from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";
import { DoctorAvatarMedia } from "@/components/site/telehealth/doctor-avatar";
import { formatSiteString } from "@/lib/i18n/site-dictionaries";
import type { TelehealthStrings } from "@/lib/i18n/site-dictionaries";

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
/** §1.1.2 — "koyu zemin çip'i" taban sınıfı, bu bantta İLK KEZ tanımlanan, blur/glow İÇERMEYEN düz alfa-şeffaflık. */
const DARK_CHIP_BASE =
  "inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-xs font-medium text-white/90";

/**
 * `.claude/architect-scope-i18n.md` §14.5 madde 9 — `dict.telehealth` VE `lang` bu bileşene sunucu
 * ebeveyninden (`doctors/[slug]/page.tsx`) geçirilir. Bu bileşen SENKRON kalmak ZORUNDADIR — `async`
 * Server Component'ler `@testing-library/react` + jsdom altında (bu projenin unit test harness'i,
 * `react-server` koşulu yok) DOĞRUDAN render EDİLEMEZ ("Only Server Components can be async at the
 * moment" hatası, qa-agent bulgusu bu turda) — bu yüzden §14.3'ün "her sunucu bileşeni sözlüğü
 * kendisi çağırır" varsayılan deseni BURADA BİLİNÇLİ OLARAK terk edilir, prop-drilling (§14.3'ün
 * izin verdiği alternatif) kullanılır. Eski sabit `LANGUAGE_NAMES` haritası `Intl.DisplayNames`
 * ile değiştirildi (§14.3) — bunun KENDİSİ senkron bir API, `async`'e gerek duymaz.
 */
export function DoctorProfileHero({ doctor, dict, lang }: { doctor: DoctorProfile; dict: TelehealthStrings; lang: string }) {
  let languageNames: Intl.DisplayNames | null = null;
  try {
    languageNames = new Intl.DisplayNames([lang], { type: "language" });
  } catch {
    languageNames = null;
  }
  const languagesFullLabel = doctor.languages.map((code) => languageNames?.of(code) ?? code.toUpperCase()).join(", ");

  return (
    <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-start sm:gap-7">
      {/* Grid görevi (2026-09-14) Görev 1 — task'ın "Yuvarlak/oval çerçeveli" talebi: site'nin genel
          `rounded-[var(--site-radius)]` köşe-yuvarlama token'ından BİLİNÇLİ SAPMA, SADECE bu avatar
          için (`rounded-full`). `border-4 border-white/20` — `ring` yerine gerçek `border`, task'ın
          İSTEDİĞİ TAM sınıf. `shadow-lg` — renk İÇERMEYEN nötr derinlik (yeni renk/token İCAT
          etmiyor), avatarı koyu banttan hafifçe kabartmak için. `DoctorAvatarMedia`'nın kendi İÇ
          katmanı (görsel + monogram fallback) `sizeClassName` üzerinden AYNI `rounded-full`'a
          uyumlu kırpılır (bkz. o bileşendeki `rounded-full` eklentisi). */}
      <div className="h-32 w-32 shrink-0 overflow-hidden rounded-full border-4 border-white/20 shadow-lg lg:h-36 lg:w-36">
        <DoctorAvatarMedia
          doctor={doctor}
          sizeClassName="h-full w-full rounded-full"
          textClassName="text-3xl sm:text-4xl"
          sizes="144px"
          priority
        />
      </div>

      <div className="min-w-0 flex-1">
        {/* `isVerified === false` iken hiçbir şey render edilmez — sahte negatif sinyal yok.
            `size="sm"` (Görev 1'de `lg` idi) — H1'in HEMEN üstünde iki ardışık `lg` solid-teal
            rozetin (doğrulama + uzmanlık) aynı görsel ağırlıkta yarışmasını önlemek için bilinçli
            küçültme; hiyerarşi artık: küçük doğrulama rozeti → büyük H1 → büyük uzmanlık rozeti. */}
        {doctor.isVerified && (
          <Badge tone="primary" solid size="sm" className="gap-1.5">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {dict.verifiedPhysicianBadge}
          </Badge>
        )}

        <h1 className="mt-3 break-words text-2xl font-semibold tracking-tight text-white lg:text-3xl">
          {doctor.title} {doctor.fullName}
        </h1>

        {/* Uzmanlık — koyu zeminde teal DÜZ METİN YASAK, opak teal rozet kullanılır. */}
        <Badge tone="primary" solid size="lg" className="mt-3 gap-1.5">
          <Stethoscope className="h-4 w-4" aria-hidden="true" />
          {doctor.specialty?.name ?? dict.generalConsultationSpecialty}
        </Badge>

        {/* Alt uzmanlık/merkez — DÜZ METİN, teal DEĞİL, white/80 (Görev'de white/70'ten hafifçe
            koyulaştırıldı, kontrastı DÜŞÜRMEZ sadece ARTIRIR). `Building2` ikonu "bağlı merkez"
            bilgisine görsel bir çapa verir — YENİ VERİ ALANI İCAT EDİLMEDİ, sadece VAR OLAN
            `subSpecialty` metninin SUNUMU güçlendirildi. */}
        {doctor.subSpecialty && (
          <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-white/80">
            <Building2 className="h-3.5 w-3.5 shrink-0 text-white/60" aria-hidden="true" />
            {doctor.subSpecialty}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {/* Deneyim rozeti — [DPI] §1.1 `experienceYears` DTO'da TÜRETİLİR, bu bant hiçbir hesap
              yapmaz. `Briefcase` ikonu Özgeçmiş zaman çizelgesindeki `EXPERIENCE` girdisiyle AYNI
              (bilinçli tekrar). */}
          {doctor.experienceYears != null && (
            <Badge tone="primary" solid size="sm" className="gap-1">
              <Briefcase className="h-3 w-3" aria-hidden="true" />
              {formatSiteString(dict.experienceYearsBadge, { years: doctor.experienceYears })}
            </Badge>
          )}

          {doctor.languages.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label={formatSiteString(dict.spokenLanguagesAriaLabel, { languages: languagesFullLabel })}>
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
