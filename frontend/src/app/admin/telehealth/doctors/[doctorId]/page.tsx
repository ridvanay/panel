"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, ChevronLeft, Stethoscope, Trash2 } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { DoctorAvailabilityRuleInput, DoctorProfile, Media, Specialty } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MediaSelectField } from "@/components/admin/media/media-select-field";
import { PageHeading } from "@/components/admin/page-heading";
import { WeeklyAvailabilityEditor } from "@/components/admin/telehealth/weekly-availability-editor";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { ApiClientError } from "@/lib/api/error";

const LANGUAGE_OPTIONS = ["tr", "en", "de", "fr", "es", "ar"] as const;
const CURRENCIES = ["TRY", "USD", "EUR", "GBP"] as const;

const formSchema = z.object({
  title: z.string().min(1, "Unvan gerekli.").max(40),
  fullName: z.string().min(1, "Ad soyad gerekli.").max(120),
  slug: z.string().min(1, "Slug gerekli.").max(80),
  bio: z.string().min(1, "Biyografi gerekli.").max(5000),
  languages: z.array(z.string()).min(1, "En az bir dil seçin.").max(6),
  timeZone: z.string().min(1, "Saat dilimi gerekli."),
  specialtyId: z.string().optional(),
  sessionDurationMin: z.coerce.number().int().min(5).max(240),
  sessionPriceLira: z.coerce.number({ invalid_type_error: "Geçerli bir ücret girin." }).min(0),
  currency: z.string().min(1),
  isActive: z.boolean(),
  isVerified: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

export default function EditDoctorPage({ params }: { params: Promise<{ doctorId: string }> }) {
  const { doctorId } = use(params);
  const router = useRouter();

  const [doctor, setDoctor] = useState<DoctorProfile | null>(null);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [avatar, setAvatar] = useState<Media | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [rules, setRules] = useState<DoctorAvailabilityRuleInput[]>([]);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  const load = useCallback(async () => {
    try {
      const [doc, specialtyList, availability] = await Promise.all([
        telehealthApi.getAdminDoctor(doctorId),
        telehealthApi.listAdminSpecialties().catch(() => []),
        telehealthApi.getDoctorAvailability(doctorId),
      ]);
      setDoctor(doc);
      setSpecialties(specialtyList);
      setAvatar(doc.avatarMedia);
      setRules(availability.map((rule) => ({ dayOfWeek: rule.dayOfWeek, startMinute: rule.startMinute, endMinute: rule.endMinute, isActive: rule.isActive })));
      reset({
        title: doc.title,
        fullName: doc.fullName,
        slug: doc.slug,
        bio: doc.bio,
        languages: doc.languages,
        timeZone: doc.timeZone,
        specialtyId: doc.specialtyId ?? "",
        sessionDurationMin: doc.sessionDurationMin,
        sessionPriceLira: doc.sessionPriceCents / 100,
        currency: doc.currency,
        isActive: doc.isActive,
        isVerified: doc.isVerified,
      });
      setLoadError(null);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, [doctorId, reset]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function onSubmit(values: FormValues) {
    setSaveError(null);
    try {
      const updated = await telehealthApi.updateDoctor(doctorId, {
        title: values.title,
        fullName: values.fullName,
        slug: values.slug,
        bio: values.bio,
        languages: values.languages,
        timeZone: values.timeZone,
        specialtyId: values.specialtyId || null,
        sessionDurationMin: values.sessionDurationMin,
        sessionPriceCents: Math.round(values.sessionPriceLira * 100),
        currency: values.currency,
        avatarMediaId: avatar?.id ?? null,
        isActive: values.isActive,
        isVerified: values.isVerified,
      });
      setDoctor(updated);
      toast.success("Doktor güncellendi.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setSaveError(message);
      toast.error(message);
    }
  }

  async function saveAvailability() {
    setAvailabilityError(null);
    if (rules.some((rule) => rule.startMinute >= rule.endMinute)) {
      setAvailabilityError("Her pencerede bitiş saati başlangıçtan sonra olmalı.");
      return;
    }
    setSavingAvailability(true);
    try {
      const updated = await telehealthApi.setDoctorAvailability(doctorId, { rules });
      setRules(updated.map((rule) => ({ dayOfWeek: rule.dayOfWeek, startMinute: rule.startMinute, endMinute: rule.endMinute, isActive: rule.isActive })));
      toast.success("Müsaitlik ızgarası kaydedildi.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setAvailabilityError(message);
      toast.error(message);
    } finally {
      setSavingAvailability(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await telehealthApi.deleteDoctor(doctorId);
      toast.success("Doktor silindi.");
      router.push("/admin/telehealth/doctors");
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        toast.error("Bu doktorun randevu geçmişi var; önce pasife alın.");
      } else {
        toast.error(friendlyErrorMessage(err));
      }
      setPendingDelete(false);
    } finally {
      setDeleting(false);
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

      <PageHeading
        icon={Stethoscope}
        title={doctor ? `${doctor.title} ${doctor.fullName}` : "Doktoru düzenle"}
        description="Profil bilgilerini ve haftalık müsaitlik ızgarasını yönetin."
        actions={
          doctor && (
            <Button type="button" variant="destructive" onClick={() => setPendingDelete(true)}>
              <Trash2 className="h-4 w-4" />
              Kalıcı Sil
            </Button>
          )
        }
      />

      {loadError && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {loadError}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      {!loadError && !doctor ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : doctor ? (
        <>
          <Card>
            {saveError && (
              <Alert variant="error" className="mb-4">
                <span className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {saveError}
                </span>
              </Alert>
            )}

            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="title" label="Unvan" error={errors.title?.message} required>
                  {(inputProps) => <Input {...inputProps} {...register("title")} />}
                </Field>
                <Field id="fullName" label="Ad soyad" error={errors.fullName?.message} required>
                  {(inputProps) => <Input {...inputProps} {...register("fullName")} />}
                </Field>
              </div>

              <Field id="slug" label="Slug (URL)" error={errors.slug?.message} required>
                {(inputProps) => <Input {...inputProps} {...register("slug")} />}
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
                <Field id="timeZone" label="Saat dilimi (IANA)" error={errors.timeZone?.message} required>
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
                          const checked = field.value?.includes(lang) ?? false;
                          return (
                            <label key={lang} className="flex items-center gap-1.5 text-sm text-foreground/80">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const current = field.value ?? [];
                                  if (e.target.checked) field.onChange([...current, lang]);
                                  else field.onChange(current.filter((v) => v !== lang));
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

              <MediaSelectField id="avatar" label="Avatar" value={avatar} onChange={setAvatar} />

              {/* K8 — bağlama/çözme SADECE `/admin/users`'ta yapılır (ADMIN-only, backend
               * `PATCH .../doctors/{id}` gövdesinde `userId` alanı ADMIN'e kilitli); burada
               * salt-okunur bir durum satırı + oraya yönlendiren bir bağlantı gösterilir. */}
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-foreground">Bağlı hesap</p>
                  <p className="text-xs text-foreground/60">
                    {doctor.userId ? "Bağlı ✓" : "Bağlı hesap yok"}
                  </p>
                </div>
                <Link href="/admin/users" className="text-xs font-medium text-primary hover:underline">
                  Bağlantıyı /admin/users üzerinden yönetin →
                </Link>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-foreground">Aktif</p>
                  <p className="text-xs text-foreground/60">Pasif doktorlar public listede/rezervasyonda görünmez.</p>
                </div>
                <Controller
                  control={control}
                  name="isActive"
                  render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Doktor aktif mi" />}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-foreground">Doğrulanmış hekim</p>
                  <p className="text-xs text-foreground/60">
                    Kimlik/diploma doğrulaması yapılmış profillere işaretleyin — gerçek bir beyandır, gelişigüzel
                    işaretlenmemelidir.
                  </p>
                </div>
                <Controller
                  control={control}
                  name="isVerified"
                  render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Doktor doğrulanmış mı" />}
                />
              </div>

              <Button type="submit" loading={isSubmitting}>
                Kaydet
              </Button>
            </form>
          </Card>

          <Card>
            <h2 className="admin-h2">Haftalık Müsaitlik</h2>
            <p className="mt-1 admin-text-secondary">
              Tekrarlayan haftalık pencereler — somut randevu saatleri buradan + mevcut randevulardan çalışma zamanında
              türetilir.
            </p>

            {availabilityError && (
              <Alert variant="error" className="mt-4">
                <span className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {availabilityError}
                </span>
              </Alert>
            )}

            <div className="mt-4">
              <WeeklyAvailabilityEditor rules={rules} onChange={setRules} />
            </div>

            <Button type="button" className="mt-4" loading={savingAvailability} onClick={() => void saveAvailability()}>
              Müsaitliği Kaydet
            </Button>
          </Card>
        </>
      ) : null}

      <ConfirmDialog
        open={pendingDelete}
        onOpenChange={setPendingDelete}
        title="Doktoru kalıcı sil"
        description={
          doctor
            ? `"${doctor.title} ${doctor.fullName}" kalıcı olarak silinecek. Bu doktorun randevu geçmişi varsa işlem engellenir. Bu işlem geri alınamaz.`
            : undefined
        }
        confirmText="Kalıcı Sil"
        tone="danger"
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
