"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useForm, useWatch, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, ChevronLeft, Stethoscope } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { DoctorSocialLink, Media, Specialty } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { MediaSelectField } from "@/components/admin/media/media-select-field";
import { DoctorSocialLinksEditor } from "@/components/site/telehealth/doctor-social-links-editor";
import { DoctorAdditionalSpecialtiesField } from "@/components/admin/telehealth/doctor-additional-specialties-field";
import { PageHeading } from "@/components/admin/page-heading";
import {
  DoctorCvBasicFields,
  DoctorCvRichSections,
  DoctorLanguagesField,
  describeArrayItemErrors,
  emptyDoctorCvValue,
  toDoctorCvPayload,
  type DoctorCvFieldErrors,
  type DoctorCvFormValue,
} from "@/components/site/telehealth/doctor-cv-fields";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";
import { DoctorPublicNameField } from "@/components/admin/telehealth/doctor-public-name-field";

const CURRENCIES = ["TRY", "USD", "EUR", "GBP"] as const;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/ç/g, "c")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ı/g, "i")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const formSchema = z.object({
  title: z.string().min(1, "Unvan gerekli.").max(40),
  fullName: z.string().min(1, "Ad soyad gerekli.").max(120),
  // Paket U (C2) — sitede görünen ad (boş = otomatik kısaltma).
  publicName: z.string().max(120),
  slug: z.string().max(80).optional(),
  bio: z.string().min(1, "Kısa özet gerekli.").max(5000),
  languages: z.array(z.string()).min(1, "En az bir dil seçin.").max(6),
  timeZone: z.string().min(1, "Saat dilimi gerekli."),
  specialtyId: z.string().optional(),
  hasFee: z.boolean(),
  sessionDurationMin: z.coerce.number().int().min(5).max(240),
  sessionPriceLira: z.coerce.number({ invalid_type_error: "Geçerli bir ücret girin." }).min(0),
  currency: z.string().min(1),
  isActive: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewDoctorPage() {
  const router = useRouter();
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [avatar, setAvatar] = useState<Media | null>(null);
  const [socialLinks, setSocialLinks] = useState<DoctorSocialLink[]>([]);
  const [additionalSpecialtyIds, setAdditionalSpecialtyIds] = useState<string[]>([]);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  // Paket A4 — CV alanları doktorun "Profilim" formuyla ortak (`doctor-cv-fields.tsx`).
  const [cv, setCv] = useState<DoctorCvFormValue>(emptyDoctorCvValue);
  const [cvErrors, setCvErrors] = useState<DoctorCvFieldErrors>({});

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "Dr.",
      fullName: "",
      publicName: "",
      slug: "",
      bio: "",
      languages: ["tr"],
      timeZone: "Europe/Istanbul",
      specialtyId: "",
      hasFee: true,
      sessionDurationMin: 30,
      sessionPriceLira: 0,
      currency: "TRY",
      isActive: true,
    },
  });

  const fullName = useWatch({ control, name: "fullName" });
  const [watchTitle, watchPublicName] = useWatch({ control, name: ["title", "publicName"] });
  const hasFee = useWatch({ control, name: "hasFee" });
  const specialtyId = useWatch({ control, name: "specialtyId" });

  // Birincil uzmanlık değişip yeni değer o an ek-uzmanlık listesinde seçiliyse, çakışma
  // oluşmasın diye o seçimi otomatik kaldır (bkz. docs/prompts madde 2). `useEffect` İÇİNDE
  // senkron `setState` YERİNE, değişimin KAYNAĞI olan input'un `onChange`'ine bağlanır.
  function handleSpecialtyChange(value: string) {
    if (!value) return;
    setAdditionalSpecialtyIds((prev) => prev.filter((id) => id !== value));
  }

  useEffect(() => {
    (async () => {
      try {
        setSpecialties(await telehealthApi.listAdminSpecialties());
      } catch {
        // Uzmanlık listesi opsiyonel bir kolaylık — yüklenemezse form yine gönderilebilir.
      }
    })();
  }, []);

  function handleFullNameChange(value: string) {
    if (!slugManuallyEdited) setValue("slug", slugify(value));
  }

  async function onSubmit(values: FormValues) {
    setError(null);
    setErrorDetails([]);
    setCvErrors({});
    try {
      const doctor = await telehealthApi.createDoctor({
        ...toDoctorCvPayload(cv),
        title: values.title,
        fullName: values.fullName,
        publicName: values.publicName.trim() || null,
        slug: values.slug || undefined,
        bio: values.bio,
        languages: values.languages,
        timeZone: values.timeZone,
        specialtyId: values.specialtyId || null,
        additionalSpecialtyIds,
        sessionDurationMin: values.sessionDurationMin,
        sessionPriceCents: values.hasFee ? Math.round(values.sessionPriceLira * 100) : null,
        currency: values.currency,
        avatarMediaId: avatar?.id ?? null,
        isActive: values.isActive,
        socialLinks,
      });
      toast.success("Doktor oluşturuldu.");
      router.push(`/admin/telehealth/doctors/${doctor.id}`);
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setError(message);
      const fieldErrors = fieldErrorsFrom(err);
      setCvErrors({ subSpecialty: fieldErrors.subSpecialty, practiceStartYear: fieldErrors.practiceStartYear });
      setErrorDetails(describeArrayItemErrors(fieldErrors));
      toast.error(message);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/admin/telehealth/doctors"
        className="inline-flex items-center gap-1 text-sm text-foreground/60 transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Doktorlar
      </Link>

      <PageHeading icon={Stethoscope} title="Yeni Doktor" description="Temel bilgileri girin; müsaitlik ızgarasını sonraki adımda ayarlarsınız." />

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <Card>
          {error && (
            <Alert variant="error" className="mb-4">
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </span>
              {errorDetails.length > 0 && (
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                  {errorDetails.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              )}
            </Alert>
          )}

          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="title" label="Unvan" error={errors.title?.message} required>
                {(inputProps) => <Input {...inputProps} {...register("title")} placeholder="Dr. / Prof. Dr." />}
              </Field>
              <Field id="fullName" label="Ad soyad" error={errors.fullName?.message} required>
                {(inputProps) => (
                  <Input {...inputProps} {...register("fullName", { onChange: (e) => handleFullNameChange(e.target.value) })} autoFocus />
                )}
              </Field>
            </div>

            <DoctorPublicNameField
              registration={register("publicName")}
              title={watchTitle ?? ""}
              fullName={fullName ?? ""}
              publicName={watchPublicName ?? ""}
              isFounder={false}
              error={errors.publicName?.message}
            />

            <Field id="slug" label="Slug (URL)" hint="Boş bırakılırsa addan otomatik oluşturulur.">
              {(inputProps) => <Input {...inputProps} {...register("slug", { onChange: () => setSlugManuallyEdited(true) })} />}
            </Field>

            <Field id="bio" label="Biyografi (kısa özet)" error={errors.bio?.message} required hint="Doktor kartında ve arama sonuçlarında görünür.">
              {(inputProps) => <Textarea {...inputProps} rows={5} {...register("bio")} />}
            </Field>

            <DoctorCvBasicFields value={cv} onChange={(patch) => setCv((prev) => ({ ...prev, ...patch }))} errors={cvErrors} />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="specialtyId" label="Uzmanlık">
                {(inputProps) => (
                  <Select {...inputProps} {...register("specialtyId", { onChange: (e) => handleSpecialtyChange(e.target.value) })}>
                    <option value="">Uzmanlıksız</option>
                    {specialties.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="timeZone" label="Saat dilimi (IANA)" error={errors.timeZone?.message} required hint='Ör. "Europe/Istanbul".'>
                {(inputProps) => <Input {...inputProps} {...register("timeZone")} />}
              </Field>
            </div>

            <DoctorAdditionalSpecialtiesField
              specialties={specialties}
              primarySpecialtyId={specialtyId ?? ""}
              selectedIds={additionalSpecialtyIds}
              onChange={setAdditionalSpecialtyIds}
            />

            <Controller
              control={control}
              name="languages"
              render={({ field }) => <DoctorLanguagesField value={field.value ?? []} onChange={field.onChange} error={errors.languages?.message} />}
            />

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-foreground">Ücret Bilgisi Belirle / Ücretli Hizmet</p>
                <p className="text-xs text-foreground/60">
                  Kapalıysa bu doktor ücretsiz/bilgi-alınız olarak listelenir; rezervasyonda ödeme adımı atlanır.
                </p>
              </div>
              <Controller
                control={control}
                name="hasFee"
                render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Ücretli hizmet mi" />}
              />
            </div>

            {hasFee && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field id="sessionDurationMin" label="Seans süresi (dk)" error={errors.sessionDurationMin?.message} required>
                  {(inputProps) => <Input {...inputProps} type="number" min={5} max={240} {...register("sessionDurationMin")} />}
                </Field>
                <Field id="sessionPriceLira" label="Seans ücreti" error={errors.sessionPriceLira?.message} required>
                  {(inputProps) => <Input {...inputProps} type="number" step="0.01" min="0" {...register("sessionPriceLira")} />}
                </Field>
                <Field id="currency" label="Para birimi" required>
                  {(inputProps) => (
                    <Select {...inputProps} {...register("currency")}>
                      {CURRENCIES.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            )}

            <MediaSelectField id="avatar" label="Avatar (opsiyonel)" value={avatar} onChange={setAvatar} />

            <div className="space-y-3 rounded-lg border border-border p-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Sosyal Medya / Web Bağlantıları</h2>
                <p className="text-xs text-foreground/60">
                  Profil fotoğrafının altında yuvarlak ikon olarak gösterilir — en fazla 8 bağlantı.
                </p>
              </div>
              <DoctorSocialLinksEditor links={socialLinks} onChange={setSocialLinks} />
            </div>

              <DoctorCvRichSections
                value={cv}
                onChange={(patch) => setCv((prev) => ({ ...prev, ...patch }))}
                sectionClassName="space-y-3 rounded-lg border border-border p-3"
              />

            <Button type="submit" loading={isSubmitting} disabled={!fullName?.trim()}>
              Oluştur ve müsaitliği ayarla
            </Button>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
