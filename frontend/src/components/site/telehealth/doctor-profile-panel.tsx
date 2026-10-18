"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage, fieldErrorsFrom } from "@/lib/api/friendly-error";
import { useDoctorPortalProfile } from "@/components/site/telehealth/doctor-portal-context";
import {
  DoctorCvBasicFields,
  DoctorCvRichSections,
  DoctorLanguagesField,
  describeArrayItemErrors,
  doctorCvValueFromProfile,
  toDoctorCvPayload,
  type DoctorCvFieldErrors,
  type DoctorCvFormValue,
} from "@/components/site/telehealth/doctor-cv-fields";
import { formatPriceFromCents } from "@/lib/format-price";
import { useActiveLocaleCode } from "@/context/locale-alternates-context";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

/**
 * `.claude/architect-scope-doctor-portfolio-identity-console.md` (**[DPI]**) §1.4 +
 * `.claude/design-notes-doctor-portfolio-console.md` — `/doctor/profile`. `PUT /doctor/profile`
 * ile YALNIZCA `subSpecialty`/`bio`/`aboutHtml`/`practiceStartYear`/`languages`/`timeZone`/
 * `cvEntries`/`publications` yazılabilir. Doktor `title`/`fullName`/`slug`/`specialty`/fiyat/süre/
 * avatar DEĞİŞTİREMEZ — bu alanlar salt-okunur bir özet blokta gösterilir, formda YER ALMAZ.
 *
 * Bug-fix turu (2026-09-15) — backend-agent `timeZone`'u YAZILABİLİR hale getirdi (doktor konsolu
 * saat karışıklığı şikayeti: doktor kendi diliminin hastanın rezervasyon dilimiyle [Europe/Istanbul]
 * farklı olduğunu bilip düzeltebilmeli/ayarlayabilmeli). Alan salt-okunur özet blokundan ÇIKARILDI,
 * forma taşındı — `admin/telehealth/doctors/new/page.tsx`teki AYNI serbest metin + IANA doğrulama
 * (backend 422) deseni kullanılır, yeni bir dropdown/select İCAT EDİLMEDİ.
 */

// Paket A4 (2026-10-18) — alt branş, mesleğe başlama yılı, hakkında, özgeçmiş, yayınlar ve diller
// admin doktor formuyla ORTAK bileşenlerden gelir (`doctor-cv-fields.tsx`).
const profileFormSchema = z.object({
  bio: z.string().trim().min(1, "Kısa özet gerekli.").max(5000),
  languages: z.array(z.string()).min(1, "En az bir dil seçin.").max(6),
  timeZone: z.string().trim().min(1, "Saat dilimi gerekli.").max(80),
});
type ProfileFormValues = z.infer<typeof profileFormSchema>;

export function DoctorProfilePanel() {
  const portalProfile = useDoctorPortalProfile();
  const { doctorProfile } = portalProfile;
  // Görev (2026-09-16) — currency/locale format denetimi (bkz. `useActiveLocaleCode` yorumu).
  const intlLocale = contentLocaleToIntl(useActiveLocaleCode());

  // [DPI] §1.4 — `aboutHtml`/`cvEntries`/`publications` karmaşık/dizi veridir; proje genelinde
  // zengin metin/dizi editörleri RHF'in DIŞINDA, düz `useState` ile yönetilir — bu AYNI, ZATEN kurulu desendir.
  const [cv, setCv] = useState<DoctorCvFormValue>(() => doctorCvValueFromProfile(doctorProfile));
  const [cvErrors, setCvErrors] = useState<DoctorCvFieldErrors>({});

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
      bio: doctorProfile.bio,
      languages: doctorProfile.languages,
      timeZone: doctorProfile.timeZone,
    },
  });

  const selectedLanguages = watch("languages");


  async function onSubmit(values: ProfileFormValues) {
    setSubmitError(null);
    setSubmitErrorDetails([]);
    setCvErrors({});
    try {
      const updated = await telehealthApi.updateDoctorSelfProfile({
        ...toDoctorCvPayload(cv),
        bio: values.bio,
        languages: values.languages,
        timeZone: values.timeZone.trim(),
      });
      setSavedProfile(updated.doctorProfile);
      setCv(doctorCvValueFromProfile(updated.doctorProfile));
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
      for (const field of ["bio", "timeZone"] as const) {
        if (fieldErrors[field]) setError(field, { message: fieldErrors[field] });
      }
      setCvErrors({ subSpecialty: fieldErrors.subSpecialty, practiceStartYear: fieldErrors.practiceStartYear });
      setSubmitErrorDetails(describeArrayItemErrors(fieldErrors));
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Profilim</h1>
        <p className="mt-1 text-sm text-foreground/60">Kurumsal özgeçmişinizi ve biyografinizi düzenleyin.</p>
      </div>

      {/* Salt-okunur özet — unvan/ad/uzmanlık/fiyat/süre DOKTOR TARAFINDAN DEĞİŞTİRİLEMEZ. Saat
          dilimi artık aşağıdaki formda DÜZENLENEBİLİR (bkz. `timeZone` alanı), burada TEKRAR
          EDİLMEZ (çift gösterim kafa karıştırır). */}
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
            <dd className="text-foreground">
              {savedProfile.sessionPriceCents != null ? formatPriceFromCents(savedProfile.sessionPriceCents, savedProfile.currency, intlLocale) : "Ücretsiz / Bilgi Alınız"}
            </dd>
          </div>
        </dl>

        <p className="mt-4 text-xs text-foreground/50">
          Unvan, ad-soyad, uzmanlık alanı, fiyat ve süreyi/profil fotoğrafınızı değiştirmek için yönetici ile iletişime geçin.
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

          <Field id="bio" label="Kısa Özet" error={errors.bio?.message} required hint="Doktor kartında ve arama sonuçlarında görünür (~280 karakter önerilir).">
            {(inputProps) => <Textarea {...inputProps} rows={3} maxLength={5000} {...register("bio")} />}
          </Field>

          <DoctorCvBasicFields value={cv} onChange={(patch) => setCv((prev) => ({ ...prev, ...patch }))} errors={cvErrors} />

          <Field
            id="timeZone"
            label="Saat dilimi (IANA)"
            error={errors.timeZone?.message}
            required
            hint='Randevu saatleriniz bu dilimde gösterilir. Ör. "Europe/Istanbul".'
          >
            {(inputProps) => <Input {...inputProps} {...register("timeZone")} />}
          </Field>

          <DoctorLanguagesField
            value={selectedLanguages ?? []}
            onChange={(next) => setValue("languages", next, { shouldValidate: true })}
            error={errors.languages?.message}
          />
        </div>

        <DoctorCvRichSections
          value={cv}
          onChange={(patch) => setCv((prev) => ({ ...prev, ...patch }))}
          sectionClassName="space-y-3 rounded-[var(--site-radius)] border border-border bg-surface p-5"
        />

        <Button type="submit" loading={isSubmitting} className="rounded-[var(--site-radius)]">
          Kaydet
        </Button>
      </form>
    </div>
  );
}
