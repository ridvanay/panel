"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage, fieldErrorsFrom } from "@/lib/api/friendly-error";
import type { DoctorCvEntry, DoctorPublication } from "@/lib/api/types";
import { useDoctorPortalProfile } from "@/components/site/telehealth/doctor-portal-context";
import { DoctorAboutEditor } from "@/components/site/telehealth/doctor-about-editor";
import { DoctorCvEntriesEditor } from "@/components/site/telehealth/doctor-cv-entries-editor";
import { DoctorPublicationsEditor } from "@/components/site/telehealth/doctor-publications-editor";
import { formatPriceFromCents } from "@/lib/format-price";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

/**
 * `.claude/architect-scope-doctor-portfolio-identity-console.md` (**[DPI]**) §1.4 +
 * `.claude/design-notes-doctor-portfolio-console.md` — `/doctor/profile`. `PUT /doctor/profile`
 * ile YALNIZCA `subSpecialty`/`bio`/`aboutHtml`/`practiceStartYear`/`languages`/`cvEntries`/
 * `publications` yazılabilir. Doktor `title`/`fullName`/`slug`/`specialty`/fiyat/süre/avatar
 * DEĞİŞTİREMEZ — bu alanlar salt-okunur bir özet blokta gösterilir, formda YER ALMAZ.
 */

const LANGUAGE_OPTIONS = ["tr", "en", "de", "fr", "es", "ar"] as const;

// Sunucu `cvEntries.0.doi` gibi dizin-içi anahtarlarla döner (bkz. backend/src/plugins/
// error-handler.ts::flattenZodIssues) — RHF bu alanları register ETMEDİĞİ için (dizi editörleri
// kendi `useState`'iyle yönetilir) tek yol bu anahtarları okunabilir Türkçe metne çevirip genel
// `Alert`in altında listelemektir (bkz. `describeArrayItemError`).
const PUBLICATION_FIELD_LABELS: Record<string, string> = {
  kind: "Tür",
  title: "Başlık",
  venue: "Dergi/Kongre/Kitap Adı",
  authors: "Yazarlar",
  year: "Yıl",
  doi: "DOI",
  url: "URL",
};

const CV_ENTRY_FIELD_LABELS: Record<string, string> = {
  kind: "Tür",
  title: "Başlık",
  organization: "Kurum",
  location: "Konum",
  startYear: "Başlangıç Yılı",
  endYear: "Bitiş Yılı",
  description: "Açıklama",
};

function describeArrayItemError(field: string, message: string): string | null {
  const match = field.match(/^(publications|cvEntries)\.(\d+)\.(.+)$/);
  if (!match) return null;
  const [, listKey, indexStr, subField] = match;
  const index = Number(indexStr) + 1;
  const listLabel = listKey === "publications" ? "Yayın" : "Özgeçmiş";
  const fieldLabels = listKey === "publications" ? PUBLICATION_FIELD_LABELS : CV_ENTRY_FIELD_LABELS;
  return `${listLabel} ${index} - ${fieldLabels[subField] ?? subField}: ${message}`;
}

const profileFormSchema = z.object({
  subSpecialty: z.string().trim().max(120),
  bio: z.string().trim().min(1, "Kısa özet gerekli.").max(5000),
  practiceStartYear: z.string(),
  languages: z.array(z.string()).min(1, "En az bir dil seçin.").max(6),
});
type ProfileFormValues = z.infer<typeof profileFormSchema>;

export function DoctorProfilePanel() {
  const portalProfile = useDoctorPortalProfile();
  const { doctorProfile } = portalProfile;

  // [DPI] §1.4 — `aboutHtml`/`cvEntries`/`publications` karmaşık/dizi veridir; proje genelinde
  // zengin metin/dizi editörleri (bkz. `post-editor.tsx`'in `contentHtml` state'i) RHF'in DIŞINDA,
  // düz `useState` ile yönetilir — bu AYNI, ZATEN kurulu desendir.
  const [aboutHtml, setAboutHtml] = useState(doctorProfile.aboutHtml ?? "");
  const [cvEntries, setCvEntries] = useState<DoctorCvEntry[]>(doctorProfile.cvEntries);
  const [publications, setPublications] = useState<DoctorPublication[]>(doctorProfile.publications);

  const [savedProfile, setSavedProfile] = useState(doctorProfile);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitErrorDetails, setSubmitErrorDetails] = useState<string[]>([]);

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      subSpecialty: doctorProfile.subSpecialty ?? "",
      bio: doctorProfile.bio,
      practiceStartYear: doctorProfile.practiceStartYear != null ? String(doctorProfile.practiceStartYear) : "",
      languages: doctorProfile.languages,
    },
  });

  const selectedLanguages = watch("languages");

  function toggleLanguage(lang: string, checked: boolean) {
    const current = selectedLanguages ?? [];
    setValue("languages", checked ? [...current, lang] : current.filter((v) => v !== lang), { shouldValidate: true });
  }

  async function onSubmit(values: ProfileFormValues) {
    setSubmitError(null);
    setSubmitErrorDetails([]);
    try {
      const trimmedSubSpecialty = values.subSpecialty.trim();
      const trimmedAboutHtml = aboutHtml.trim();
      const practiceStartYear = values.practiceStartYear.trim() ? Number(values.practiceStartYear) : null;

      const updated = await telehealthApi.updateDoctorSelfProfile({
        subSpecialty: trimmedSubSpecialty ? trimmedSubSpecialty : null,
        bio: values.bio,
        aboutHtml: trimmedAboutHtml ? trimmedAboutHtml : null,
        practiceStartYear,
        languages: values.languages,
        cvEntries,
        publications,
      });
      setSavedProfile(updated.doctorProfile);
      setAboutHtml(updated.doctorProfile.aboutHtml ?? "");
      setCvEntries(updated.doctorProfile.cvEntries);
      setPublications(updated.doctorProfile.publications);
      // Sol-alt toast, sayfa akışını bozan sabit üst banner'ın YERİNİ alır — 4sn sonra kendiliğinden
      // kapanır, `closeButton` ile de manuel kapatılabilir (bkz. proje genelinde ZATEN kurulu
      // `components/ui/sonner.tsx` — YENİ bir bildirim sistemi İCAT EDİLMEZ).
      toast.success("Profiliniz güncellendi. Kurumsal profil sayfanız kısa süre içinde yenilenecek.", {
        position: "bottom-left",
        duration: 4000,
        closeButton: true,
      });
    } catch (err) {
      setSubmitError(friendlyErrorMessage(err));
      // 422 — sunucu alan hataları (`bio`/`subSpecialty`/`practiceStartYear`) ilgili `Field`'a
      // yansıtılır; `cvEntries`/`publications` dizi-İÇİ hataları (ör. `publications.0.doi`) RHF
      // tarafından register EDİLMEDİĞİ için `describeArrayItemError` ile okunabilir metne çevrilip
      // genel `Alert`in altında listelenir (artık sessizce genel mesaja gömülmüyor).
      const fieldErrors = fieldErrorsFrom(err);
      for (const field of ["subSpecialty", "bio", "practiceStartYear"] as const) {
        if (fieldErrors[field]) setError(field, { message: fieldErrors[field] });
      }
      const detailMessages = Object.entries(fieldErrors)
        .map(([field, message]) => describeArrayItemError(field, message))
        .filter((message): message is string => message !== null);
      setSubmitErrorDetails(detailMessages);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Profilim</h1>
        <p className="mt-1 text-sm text-foreground/60">Kurumsal özgeçmişinizi ve biyografinizi düzenleyin.</p>
      </div>

      {/* Salt-okunur özet — unvan/ad/uzmanlık/fiyat/süre/saat dilimi DOKTOR TARAFINDAN DEĞİŞTİRİLEMEZ. */}
      <div className="rounded-[var(--site-radius)] border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {savedProfile.title} {savedProfile.fullName}
            </p>
            <p className="text-xs text-foreground/60">{savedProfile.specialty?.name ?? "Genel Danışmanlık"}</p>
          </div>
          {portalProfile.twoFactorEnabled && (
            <Badge tone="success" solid size="sm" className="gap-1">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              2FA Etkin
            </Badge>
          )}
        </div>

        <div className="my-4 border-t border-border" />

        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-foreground/50">E-posta</dt>
            <dd className="text-foreground">{portalProfile.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/50">Seans süresi</dt>
            <dd className="text-foreground">{savedProfile.sessionDurationMin} dakika</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/50">Seans ücreti</dt>
            <dd className="text-foreground">{formatPriceFromCents(savedProfile.sessionPriceCents, savedProfile.currency)}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/50">Saat dilimi</dt>
            <dd className="text-foreground">{savedProfile.timeZone}</dd>
          </div>
        </dl>

        <p className="mt-4 text-xs text-foreground/50">
          Unvan, ad-soyad, uzmanlık alanı, fiyat, süre ve profil fotoğrafınızı değiştirmek için yönetici ile iletişime geçin.
        </p>
      </div>

      <form className="space-y-6" onSubmit={handleSubmit(onSubmit)} noValidate>
        {submitError && (
          <Alert variant="error">
            <p>{submitError}</p>
            {submitErrorDetails.length > 0 && (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                {submitErrorDetails.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            )}
          </Alert>
        )}

        <div className="space-y-4 rounded-[var(--site-radius)] border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Kurumsal Bilgiler</h2>

          <Field id="subSpecialty" label="Alt Branş / Bağlı Merkez (opsiyonel)" error={errors.subSpecialty?.message}>
            {(inputProps) => <Input {...inputProps} maxLength={120} placeholder="Örn. Girişimsel Kardiyoloji" {...register("subSpecialty")} />}
          </Field>

          <Field id="bio" label="Kısa Özet" error={errors.bio?.message} required hint="Doktor kartında ve arama sonuçlarında görünür (~280 karakter önerilir).">
            {(inputProps) => <Textarea {...inputProps} rows={3} maxLength={5000} {...register("bio")} />}
          </Field>

          <Field
            id="practiceStartYear"
            label="Mesleğe Başlama Yılı (opsiyonel)"
            error={errors.practiceStartYear?.message}
            hint="Deneyim rozeti bu yıldan otomatik hesaplanır."
          >
            {(inputProps) => (
              <Input {...inputProps} type="number" min={1950} max={new Date().getUTCFullYear()} {...register("practiceStartYear")} />
            )}
          </Field>

          <div>
            <span className="block text-sm font-medium text-foreground">
              Konuşulan Diller <span className="text-danger">*</span>
            </span>
            <div className="mt-1.5 flex flex-wrap gap-3">
              {LANGUAGE_OPTIONS.map((lang) => (
                <label key={lang} className="flex items-center gap-1.5 text-sm text-foreground/80">
                  <input
                    type="checkbox"
                    checked={selectedLanguages?.includes(lang) ?? false}
                    onChange={(e) => toggleLanguage(lang, e.target.checked)}
                  />
                  {lang.toUpperCase()}
                </label>
              ))}
            </div>
            {errors.languages && <p className="mt-1 text-xs text-danger">{errors.languages.message}</p>}
          </div>
        </div>

        <div className="space-y-3 rounded-[var(--site-radius)] border border-border bg-surface p-5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Doktor Hakkında (uzun biyografi)</h2>
            <p className="text-xs text-foreground/50">“Doktor Hakkında” sekmesinde kısa özetin altında gösterilir.</p>
          </div>
          <DoctorAboutEditor content={aboutHtml} onChange={setAboutHtml} />
        </div>

        <div className="space-y-3 rounded-[var(--site-radius)] border border-border bg-surface p-5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Özgeçmiş</h2>
            <p className="text-xs text-foreground/50">Eğitim, deneyim, sertifika, üyelik ve ödülleriniz — eklediğiniz SIRAYLA gösterilir.</p>
          </div>
          <DoctorCvEntriesEditor entries={cvEntries} onChange={setCvEntries} />
        </div>

        <div className="space-y-3 rounded-[var(--site-radius)] border border-border bg-surface p-5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Bilimsel Yayınlar</h2>
            <p className="text-xs text-foreground/50">Makale, bildiri, kitap bölümü ve diğer yayınlarınız — türüne göre gruplanarak gösterilir.</p>
          </div>
          <DoctorPublicationsEditor publications={publications} onChange={setPublications} />
        </div>

        <Button type="submit" loading={isSubmitting} className="rounded-[var(--site-radius)]">
          Kaydet
        </Button>
      </form>
    </div>
  );
}
