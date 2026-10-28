"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useForm, useWatch, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, Archive, ChevronLeft, Stethoscope, Trash2 } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { DoctorAvailabilityRuleInput, DoctorProfile, DoctorSocialLink, Media, Specialty } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { MediaSelectField } from "@/components/admin/media/media-select-field";
import { PageHeading } from "@/components/admin/page-heading";
import { WeeklyAvailabilityEditor } from "@/components/admin/telehealth/weekly-availability-editor";
import { TimeOffManager } from "@/components/telehealth/time-off-manager";
import { DoctorSocialLinksEditor } from "@/components/site/telehealth/doctor-social-links-editor";
import { DoctorAdditionalSpecialtiesField } from "@/components/admin/telehealth/doctor-additional-specialties-field";
import { DoctorDeleteOrArchiveDialog } from "@/components/admin/telehealth/doctor-delete-or-archive-dialog";
import { DoctorLinkedAccountPanel } from "@/components/admin/telehealth/doctor-linked-account-panel";
import {
  DoctorCvBasicFields,
  DoctorCvRichSections,
  DoctorLanguagesField,
  describeArrayItemErrors,
  doctorCvValueFromProfile,
  emptyDoctorCvValue,
  toDoctorCvPayload,
  type DoctorCvFieldErrors,
  type DoctorCvFormValue,
} from "@/components/site/telehealth/doctor-cv-fields";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";
import { DoctorPublicNameField } from "@/components/admin/telehealth/doctor-public-name-field";

const CURRENCIES = ["TRY", "USD", "EUR", "GBP"] as const;

const formSchema = z.object({
  title: z.string().min(1, "Unvan gerekli.").max(40),
  fullName: z.string().min(1, "Ad soyad gerekli.").max(120),
  // Paket U (C2) — sitede görünen ad (boş = otomatik kısaltma).
  publicName: z.string().max(120),
  slug: z.string().min(1, "Slug gerekli.").max(80),
  bio: z.string().min(1, "Kısa özet gerekli.").max(5000),
  languages: z.array(z.string()).min(1, "En az bir dil seçin.").max(6),
  timeZone: z.string().min(1, "Saat dilimi gerekli."),
  specialtyId: z.string().optional(),
  hasFee: z.boolean(),
  sessionDurationMin: z.coerce.number().int().min(5).max(240),
  sessionPriceLira: z.coerce.number({ invalid_type_error: "Geçerli bir ücret girin." }).min(0),
  currency: z.string().min(1),
  isActive: z.boolean(),
  isVerified: z.boolean(),
  // Paket P (İş 3) — kurucu işareti (tek kurucu; sunucu 409) + opsiyonel kadro katmanı (boş = yok).
  isFounder: z.boolean(),
  rosterTier: z.string().regex(/^[1-9]?$/, "1–9 arasında bir sayı girin ya da boş bırakın."),
});

type FormValues = z.infer<typeof formSchema>;

export default function EditDoctorPage({ params }: { params: Promise<{ doctorId: string }> }) {
  const { doctorId } = use(params);
  const router = useRouter();

  const [doctor, setDoctor] = useState<DoctorProfile | null>(null);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [avatar, setAvatar] = useState<Media | null>(null);
  const [socialLinks, setSocialLinks] = useState<DoctorSocialLink[]>([]);
  const [additionalSpecialtyIds, setAdditionalSpecialtyIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveErrorDetails, setSaveErrorDetails] = useState<string[]>([]);
  // Paket A4 — CV alanları doktorun "Profilim" formuyla ortak (`doctor-cv-fields.tsx`).
  const [cv, setCv] = useState<DoctorCvFormValue>(emptyDoctorCvValue);
  const [cvErrors, setCvErrors] = useState<DoctorCvFieldErrors>({});

  const [rules, setRules] = useState<DoctorAvailabilityRuleInput[]>([]);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState(false);
  const [unarchiving, setUnarchiving] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  const hasFee = useWatch({ control, name: "hasFee" });
  const [watchTitle, watchFullName, watchPublicName, watchIsFounder] = useWatch({ control, name: ["title", "fullName", "publicName", "isFounder"] });
  const specialtyId = useWatch({ control, name: "specialtyId" });

  // Birincil uzmanlık değişip yeni değer o an ek-uzmanlık listesinde seçiliyse, çakışma
  // oluşmasın diye o seçimi otomatik kaldır (bkz. docs/prompts madde 2). `useEffect` İÇİNDE
  // senkron `setState` YERİNE, değişimin KAYNAĞI olan input'un `onChange`'ine bağlanır.
  function handleSpecialtyChange(value: string) {
    if (!value) return;
    setAdditionalSpecialtyIds((prev) => prev.filter((id) => id !== value));
  }

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
      setSocialLinks(doc.socialLinks);
      setCv(doctorCvValueFromProfile(doc));
      setAdditionalSpecialtyIds(doc.additionalSpecialties?.map((s) => s.id) ?? []);
      setRules(availability.map((rule) => ({ dayOfWeek: rule.dayOfWeek, startMinute: rule.startMinute, endMinute: rule.endMinute, isActive: rule.isActive })));
      reset({
        title: doc.title,
        fullName: doc.fullName,
        publicName: doc.publicName ?? "",
        slug: doc.slug,
        bio: doc.bio,
        languages: doc.languages,
        timeZone: doc.timeZone,
        specialtyId: doc.specialtyId ?? "",
        hasFee: doc.sessionPriceCents != null,
        sessionDurationMin: doc.sessionDurationMin,
        sessionPriceLira: doc.sessionPriceCents != null ? doc.sessionPriceCents / 100 : 0,
        currency: doc.currency,
        isActive: doc.isActive,
        isVerified: doc.isVerified,
        isFounder: doc.isFounder ?? false,
        rosterTier: doc.rosterTier != null ? String(doc.rosterTier) : "",
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
    setSaveErrorDetails([]);
    setCvErrors({});
    try {
      const updated = await telehealthApi.updateDoctor(doctorId, {
        ...toDoctorCvPayload(cv),
        title: values.title,
        fullName: values.fullName,
        publicName: values.publicName.trim() || null,
        slug: values.slug,
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
        isVerified: values.isVerified,
        isFounder: values.isFounder,
        rosterTier: values.rosterTier ? Number(values.rosterTier) : null,
        socialLinks,
      });
      setDoctor(updated);
      setSocialLinks(updated.socialLinks);
      setCv(doctorCvValueFromProfile(updated));
      setAdditionalSpecialtyIds(updated.additionalSpecialties?.map((s) => s.id) ?? []);
      toast.success("Doktor güncellendi.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setSaveError(message);
      const fieldErrors = fieldErrorsFrom(err);
      setCvErrors({ subSpecialty: fieldErrors.subSpecialty, practiceStartYear: fieldErrors.practiceStartYear });
      setSaveErrorDetails(describeArrayItemErrors(fieldErrors));
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

  async function handleUnarchive() {
    setUnarchiving(true);
    try {
      const updated = await telehealthApi.unarchiveDoctor(doctorId);
      setDoctor(updated);
      toast.success("Doktor arşivden çıkarıldı. Sitede görünmesi için \"Aktif\" anahtarını açıp kaydedin.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setUnarchiving(false);
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
          doctor &&
          !doctor.archivedAt && (
            <Button type="button" variant="destructive" onClick={() => setPendingDelete(true)}>
              <Trash2 className="h-4 w-4" />
              Sil / Arşivle
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

      {doctor?.archivedAt && (
        <Alert variant="warning">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <Archive className="h-4 w-4 shrink-0" />
              Bu doktor arşivlenmiş: sitede, aramada ve sitemap&apos;te görünmez, yeni randevu alamaz. Geçmiş kayıtlar korunur.
            </span>
            <Button type="button" variant="outline" size="sm" loading={unarchiving} onClick={() => void handleUnarchive()}>
              Arşivden çıkar
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
                {saveErrorDetails.length > 0 && (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                    {saveErrorDetails.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                )}
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

              <DoctorPublicNameField
                registration={register("publicName")}
                title={watchTitle ?? ""}
                fullName={watchFullName ?? ""}
                publicName={watchPublicName ?? ""}
                isFounder={Boolean(watchIsFounder)}
                error={errors.publicName?.message}
              />

              <Field id="slug" label="Slug (URL)" error={errors.slug?.message} required>
                {(inputProps) => <Input {...inputProps} {...register("slug")} />}
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
                <Field id="timeZone" label="Saat dilimi (IANA)" error={errors.timeZone?.message} required>
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

              <MediaSelectField id="avatar" label="Avatar" value={avatar} onChange={setAvatar} />

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

              {/* K8 — bağlama/çözme SADECE `/admin/users`'ta yapılır (ADMIN-only, backend
               * `PATCH .../doctors/{id}` gövdesinde `userId` alanı ADMIN'e kilitli); burada
               * salt-okunur bir durum satırı + oraya yönlendiren bir bağlantı gösterilir. */}
              <DoctorLinkedAccountPanel userId={doctor.userId} />

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

              {/* Paket P (İş 3) — kurucu ve kadro katmanı (Öne Çıkan Doktorlar "Piramit" + /doctors sıralaması). */}
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-foreground">Kurucu (Founder)</p>
                  <p className="text-xs text-foreground/60">
                    Aynı anda yalnızca bir doktor kurucu olabilir. Anasayfa “Piramit” düzeninde üstte, doktorlar sayfasında en üstte ayrı kartla gösterilir.
                  </p>
                </div>
                <Controller
                  control={control}
                  name="isFounder"
                  render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Kurucu doktor mu" />}
                />
              </div>
              <Field id="doctor-roster-tier" label="Kadro katmanı (isteğe bağlı)" hint="1 = en üst. Piramitte diğer doktorlar katmana, sonra sıraya göre dizilir." error={errors.rosterTier?.message}>
                {(inputProps) => <Input {...inputProps} inputMode="numeric" maxLength={1} className="w-24" {...register("rosterTier")} />}
              </Field>

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

            {/* Paket P (İş 2) — haftalık saatler ve izinler aynı kartta: doktor adına izin ekleme. */}
            <div className="mt-6 border-t border-border pt-6">
              <TimeOffManager
                doctorTimeZone={doctor.timeZone}
                list={() => telehealthApi.listDoctorTimeOff(doctor.id)}
                create={(input) => telehealthApi.createDoctorTimeOff(doctor.id, input)}
                remove={(id) => telehealthApi.deleteDoctorTimeOff(doctor.id, id)}
                errorMessage={friendlyErrorMessage}
              />
            </div>
          </Card>
        </>
      ) : null}

      <DoctorDeleteOrArchiveDialog
        doctor={pendingDelete ? doctor : null}
        onOpenChange={setPendingDelete}
        onDeleted={() => router.push("/admin/telehealth/doctors")}
        onArchived={() => void load()}
      />
    </div>
  );
}
