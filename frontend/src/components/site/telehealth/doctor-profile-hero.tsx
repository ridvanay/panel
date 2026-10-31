import { BadgeCheck, Building2, Stethoscope } from "lucide-react";
import type { DoctorProfile, ReviewSummary } from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";
import { DoctorAvatarMedia } from "@/components/site/telehealth/doctor-avatar";
import { DoctorSocialLinks } from "@/components/site/telehealth/doctor-social-links";
import { DoctorKeyFacts } from "@/components/site/telehealth/doctor-key-facts";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import type { TelehealthStrings } from "@/lib/i18n/site-dictionaries";
import { publicDoctorName } from "@/lib/doctor-display-name";

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
interface DoctorProfileHeroProps {
  doctor: DoctorProfile;
  dict: TelehealthStrings;
  lang: string;
  /** Paket AE — "Önemli bilgiler" şeridi için (verilmezse ilgili öğe gizlenir). */
  procedureCount?: number;
  reviewSummary?: ReviewSummary | null;
}

export function DoctorProfileHero({ doctor, dict, lang, procedureCount = 0, reviewSummary = null }: DoctorProfileHeroProps) {
  let languageNames: Intl.DisplayNames | null = null;
  try {
    languageNames = new Intl.DisplayNames([contentLocaleToIntl(lang)], { type: "language" });
  } catch {
    languageNames = null;
  }
  const languagesFullLabel = doctor.languages.map((code) => languageNames?.of(code) ?? code.toUpperCase()).join(", ");

  return (
    <div>
    <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-start sm:gap-6">
      {/* Grid görevi (2026-09-14) Görev 1 — task'ın "Yuvarlak/oval çerçeveli" talebi: site'nin genel
          `rounded-[var(--site-radius)]` köşe-yuvarlama token'ından BİLİNÇLİ SAPMA, SADECE bu avatar
          için (`rounded-full`). `border-4 border-white/20` — `ring` yerine gerçek `border`, task'ın
          İSTEDİĞİ TAM sınıf. `shadow-lg` — renk İÇERMEYEN nötr derinlik (yeni renk/token İCAT
          etmiyor), avatarı koyu banttan hafifçe kabartmak için. `DoctorAvatarMedia`'nın kendi İÇ
          katmanı (görsel + monogram fallback) `sizeClassName` üzerinden AYNI `rounded-full`'a
          uyumlu kırpılır (bkz. o bileşendeki `rounded-full` eklentisi). */}
      <div className="flex shrink-0 flex-col items-center gap-3">
        <div className="h-24 w-24 overflow-hidden rounded-full border-4 border-white/20 shadow-lg sm:h-28 sm:w-28 lg:h-32 lg:w-32">
          <DoctorAvatarMedia
            doctor={doctor}
            sizeClassName="h-full w-full rounded-full"
            textClassName="text-2xl sm:text-3xl"
            sizes="128px"
            priority
          />
        </div>

        {/* [DPI] §1.1 — doktor fotoğrafının ALTINDA, boşsa HİÇ render edilmez (bkz.
            `doctor-social-links.tsx` dosya başı yorumu). */}
        <DoctorSocialLinks links={doctor.socialLinks} ariaLabel={dict.socialLinksAriaLabel} lang={lang} />
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

        <h1 className="mt-2 break-words text-2xl font-semibold tracking-tight text-white lg:text-3xl">
          {doctor.title} {publicDoctorName(doctor)}
        </h1>

        {/* Uzmanlık — koyu zeminde teal DÜZ METİN YASAK, opak teal rozet kullanılır. */}
        <Badge tone="primary" solid size="lg" className="mt-2 gap-1.5">
          <Stethoscope className="h-4 w-4" aria-hidden="true" />
          {doctor.specialty?.name ?? dict.generalConsultationSpecialty}
        </Badge>

        {/* `docs/prompts/2026-10-02-wm-health-icerik-guncellemesi.md` madde 2 — birincil
            uzmanlığın YANINDA, varsa EK uzmanlıklar küçük rozet olarak gösterilir. Dizi boşsa/yoksa
            HİÇBİR ŞEY render edilmez. Aynı koyu-zemin kontrast kuralı (opak rozet) korunur. */}
        {doctor.additionalSpecialties && doctor.additionalSpecialties.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {doctor.additionalSpecialties.map((specialty) => (
              <Badge key={specialty.id} tone="primary" solid size="sm" className="gap-1">
                {specialty.name}
              </Badge>
            ))}
          </div>
        )}

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
      </div>
    </div>
    <DoctorKeyFacts doctor={doctor} dict={dict} languagesFullLabel={languagesFullLabel} procedureCount={procedureCount} reviewSummary={reviewSummary} />
    </div>
  );
}
