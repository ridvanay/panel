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
import type { Media, Specialty } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { MediaSelectField } from "@/components/admin/media/media-select-field";
import { PageHeading } from "@/components/admin/page-heading";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const LANGUAGE_OPTIONS = ["tr", "en", "de", "fr", "es", "ar"] as const;
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
  slug: z.string().max(80).optional(),
  bio: z.string().min(1, "Biyografi gerekli.").max(5000),
  languages: z.array(z.string()).min(1, "En az bir dil seçin.").max(6),
  timeZone: z.string().min(1, "Saat dilimi gerekli."),
  specialtyId: z.string().optional(),
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
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      slug: "",
      bio: "",
      languages: ["tr"],
      timeZone: "Europe/Istanbul",
      specialtyId: "",
      sessionDurationMin: 30,
      sessionPriceLira: 0,
      currency: "TRY",
      isActive: true,
    },
  });

  const fullName = useWatch({ control, name: "fullName" });

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
    try {
      const doctor = await telehealthApi.createDoctor({
        title: values.title,
        fullName: values.fullName,
        slug: values.slug || undefined,
        bio: values.bio,
        languages: values.languages,
        timeZone: values.timeZone,
        specialtyId: values.specialtyId || null,
        sessionDurationMin: values.sessionDurationMin,
        sessionPriceCents: Math.round(values.sessionPriceLira * 100),
        currency: values.currency,
        avatarMediaId: avatar?.id ?? null,
        isActive: values.isActive,
      });
      toast.success("Doktor oluşturuldu.");
      router.push(`/admin/telehealth/doctors/${doctor.id}`);
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setError(message);
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

            <Field id="slug" label="Slug (URL)" hint="Boş bırakılırsa addan otomatik oluşturulur.">
              {(inputProps) => <Input {...inputProps} {...register("slug", { onChange: () => setSlugManuallyEdited(true) })} />}
            </Field>

            <Field id="bio" label="Biyografi" error={errors.bio?.message} required>
              {(inputProps) => <Textarea {...inputProps} rows={5} {...register("bio")} />}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="specialtyId" label="Uzmanlık">
                {(inputProps) => (
                  <Select {...inputProps} {...register("specialtyId")}>
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

            <div>
              <span className="block text-sm font-medium text-foreground">
                Konuşulan diller <span className="text-danger">*</span>
              </span>
              <div className="mt-1.5 flex flex-wrap gap-3">
                <Controller
                  control={control}
                  name="languages"
                  render={({ field }) => (
                    <>
                      {LANGUAGE_OPTIONS.map((lang) => {
                        const checked = field.value.includes(lang);
                        return (
                          <label key={lang} className="flex items-center gap-1.5 text-sm text-foreground/80">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) field.onChange([...field.value, lang]);
                                else field.onChange(field.value.filter((v) => v !== lang));
                              }}
                            />
                            {lang.toUpperCase()}
                          </label>
                        );
                      })}
                    </>
                  )}
                />
              </div>
              {errors.languages && <p className="mt-1 text-xs text-danger">{errors.languages.message}</p>}
            </div>

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

            <MediaSelectField id="avatar" label="Avatar (opsiyonel)" value={avatar} onChange={setAvatar} />

            <Button type="submit" loading={isSubmitting} disabled={!fullName?.trim()}>
              Oluştur ve müsaitliği ayarla
            </Button>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
