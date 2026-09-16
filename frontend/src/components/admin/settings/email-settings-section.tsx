"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, CheckCircle2, Mail, XCircle } from "lucide-react";
import { useEmailSettings, useTestEmailSettings, useUpdateEmailSettings } from "@/hooks/use-email-settings";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import type { EmailSettings, EmailSettingsSource, UpdateEmailSettingsRequest } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

function formatDate(iso: string | null): string {
  return iso ? dateFormatter.format(new Date(iso)) : "—";
}

const SOURCE_LABELS: Record<EmailSettingsSource, string> = {
  database: "Veritabanı yapılandırması (bu form)",
  env: "Sunucu ortam değişkenleri",
  ethereal: "Geliştirme test kutusu (Ethereal)",
  none: "Yapılandırılmamış",
};

const SOURCE_TONES: Record<EmailSettingsSource, "primary" | "neutral" | "warning" | "danger"> = {
  database: "primary",
  env: "neutral",
  ethereal: "warning",
  none: "danger",
};

const SMTP_PORT_OPTIONS: { value: "25" | "465" | "587" | "2525"; label: string }[] = [
  { value: "25", label: "25 (klasik SMTP)" },
  { value: "465", label: "465 (baştan TLS)" },
  { value: "587", label: "587 (STARTTLS, önerilen)" },
  { value: "2525", label: "2525 (sağlayıcı alternatifi)" },
];

// Backend `UpdateEmailSettingsRequestSchema`'yı (openapi.yaml `UpdateEmailSettingsRequest`)
// yansıtan istemci tarafı ön kontrol — asıl SSRF/sözdizimi doğrulaması (KARAR 2,
// `.claude/security-review-smtp-settings.md`) yalnızca sunucudadır; burada yalnızca hızlı UX
// geri bildirimi için hafif bir ön kontrol yapılır, geri kalanı backend `422` +
// `error.details.smtpHost` ile döner.
const formSchema = z
  .object({
    enabled: z.boolean(),
    smtpHost: z
      .string()
      .trim()
      .max(255, "En fazla 255 karakter olabilir.")
      .refine((v) => v === "" || !/[\s\x00-\x1F@]/.test(v), {
        message: "Host adı boşluk, kontrol karakteri veya `@` içeremez.",
      })
      .refine((v) => v === "" || !v.includes("://"), {
        message: "Host adı şema öneki (ör. `smtp://`) içeremez.",
      })
      .refine((v) => v === "" || !v.includes(":"), {
        message: "Port ayrı bir alandır; host adının içine gömülemez.",
      }),
    smtpPort: z.enum(["25", "465", "587", "2525"]),
    smtpSecure: z.boolean(),
    smtpUser: z.string().trim().max(255, "En fazla 255 karakter olabilir."),
    smtpPassword: z.string().max(255, "En fazla 255 karakter olabilir."),
    fromName: z.string().trim().max(120, "En fazla 120 karakter olabilir."),
    fromAddress: z
      .string()
      .trim()
      .max(255, "En fazla 255 karakter olabilir.")
      .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
        message: "Geçerli bir e-posta adresi girin.",
      }),
  })
  .superRefine((values, ctx) => {
    // §3.3 (architect scope) — `enabled: true` iken `smtpHost` boş olamaz: "açık ama
    // yapılandırmasız" durumu e-postanın sessizce kaybolduğu bir tuzaktır.
    if (values.enabled && !values.smtpHost) {
      ctx.addIssue({ code: "custom", path: ["smtpHost"], message: "Etkinken SMTP Host boş olamaz." });
    }
  });

type FormValues = z.infer<typeof formSchema>;

const FORM_FIELD_NAMES = [
  "enabled",
  "smtpHost",
  "smtpPort",
  "smtpSecure",
  "smtpUser",
  "smtpPassword",
  "fromName",
  "fromAddress",
] as const;

function isFormField(name: string): name is (typeof FORM_FIELD_NAMES)[number] {
  return (FORM_FIELD_NAMES as readonly string[]).includes(name);
}

function buildDefaults(data: EmailSettings): FormValues {
  return {
    enabled: data.enabled,
    smtpHost: data.smtpHost ?? "",
    smtpPort: String(data.smtpPort) as FormValues["smtpPort"],
    smtpSecure: data.smtpSecure,
    smtpUser: data.smtpUser ?? "",
    // Parola YAZ-ONLY'dir — sunucudan asla dönmez, bu alan her zaman boştan başlar.
    smtpPassword: "",
    fromName: data.fromName ?? "",
    fromAddress: data.fromAddress ?? "",
  };
}

/**
 * `/admin/settings` → "E-posta / API Yapılandırmaları" sekmesindeki "E-posta Yapılandırması"
 * kartı. `.claude/architect-scope-smtp-settings.md` + `.claude/security-review-smtp-settings.md`
 * bağlayıcıdır. Üç uç: `GET/PATCH /admin/settings/email`, `POST /admin/settings/email/test`
 * (yalnızca ADMIN). Akış "önce Kaydet, sonra Test Et" — kaydedilmemiş değişiklik varken test
 * butonu devre dışıdır (backend her zaman KAYDEDİLMİŞ satırı test eder, istek gövdesindeki
 * geçici değerleri DEĞİL).
 */
export function EmailSettingsSection() {
  const query = useEmailSettings();
  const updateMutation = useUpdateEmailSettings();
  const testMutation = useTestEmailSettings();

  const [passwordCleared, setPasswordCleared] = useState(false);
  const initializedRef = useRef(false);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    setError,
    control,
    formState: { errors, isDirty: formIsDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      enabled: false,
      smtpHost: "",
      smtpPort: "587",
      smtpSecure: false,
      smtpUser: "",
      smtpPassword: "",
      fromName: "",
      fromAddress: "",
    },
  });

  const enabledValue = useWatch({ control, name: "enabled" });
  const isDirty = formIsDirty || passwordCleared;

  // İlk yükleme TAMAMLANDIĞINDA formu sunucu değerleriyle doldurur — yalnızca BİR KEZ.
  // Sonraki arka plan yeniden çekimlerinde (ör. test sonrası invalidate) formu SIFIRLAMAZ,
  // aksi halde kullanıcının henüz kaydetmediği değişiklikler sessizce silinirdi.
  useEffect(() => {
    if (query.data && !initializedRef.current) {
      initializedRef.current = true;
      reset(buildDefaults(query.data));
    }
  }, [query.data, reset]);

  // §10.12.8 ortak hook — kaydedilmemiş değişiklik varken sekme değişimi/sayfadan
  // ayrılmada uyarır.
  useUnsavedChangesGuard({ enabled: isDirty });

  function handleRequestPasswordClear() {
    setPasswordCleared(true);
    setValue("smtpPassword", "");
  }

  async function onSubmit(values: FormValues) {
    const payload: UpdateEmailSettingsRequest = {
      enabled: values.enabled,
      smtpHost: values.smtpHost.trim() ? values.smtpHost.trim() : null,
      smtpPort: Number(values.smtpPort),
      smtpSecure: values.smtpSecure,
      smtpUser: values.smtpUser.trim() ? values.smtpUser.trim() : null,
      fromName: values.fromName.trim() ? values.fromName.trim() : null,
      fromAddress: values.fromAddress.trim() ? values.fromAddress.trim() : null,
    };
    // Üç durumlu parola semantiği (bağlayıcı): temizleme istendiyse `null`; kullanıcı yeni bir
    // değer YAZDIYSA gönder; dokunulmadıysa alanı gövdeye HİÇ EKLEME (mevcut parola korunur).
    if (passwordCleared) {
      payload.smtpPassword = null;
    } else if (values.smtpPassword.trim()) {
      payload.smtpPassword = values.smtpPassword.trim();
    }

    let updated: EmailSettings;
    try {
      updated = await updateMutation.mutateAsync(payload);
    } catch (err) {
      for (const [field, message] of Object.entries(fieldErrorsFrom(err))) {
        if (isFormField(field)) setError(field, { message });
      }
      return;
    }

    toast.success("E-posta yapılandırması kaydedildi.");
    setPasswordCleared(false);
    reset(buildDefaults(updated));
  }

  async function handleTest() {
    try {
      const result = await testMutation.mutateAsync();
      toast.success(`Test e-postası gönderildi: ${result.sentTo}`);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Mail className="h-4 w-4" />
        </span>
        <div>
          <h2 className="admin-h2">E-posta Yapılandırması</h2>
          <p className="mt-0.5 admin-text-secondary">
            SMTP entegrasyon ayarları. Parola sunucudan hiçbir zaman geri okunmaz.
          </p>
        </div>
      </div>

      {query.isError && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {friendlyErrorMessage(query.error)}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      {!query.isError && query.isPending && (
        <div className="space-y-4">
          <Skeleton className="h-14 w-full" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        </div>
      )}

      {!query.isError && !query.isPending && query.data && (
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Bu yapılandırmayı etkinleştir</p>
              <p className="text-xs text-foreground/60">
                Etkinken kayıtlı SMTP bilgileri, sunucu ortam değişkenlerinin önüne geçer.
              </p>
            </div>
            <Controller
              control={control}
              name="enabled"
              render={({ field }) => (
                <Switch
                  aria-label="E-posta yapılandırmasını etkinleştir"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-foreground/60">Şu anda kullanılan:</span>
            <Badge tone={SOURCE_TONES[query.data.effectiveSource]} solid>
              {SOURCE_LABELS[query.data.effectiveSource]}
            </Badge>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="smtpHost" label="SMTP Host" error={errors.smtpHost?.message} required={enabledValue}>
              {(inputProps) => <Input {...inputProps} placeholder="smtp.ornek.com" {...register("smtpHost")} />}
            </Field>

            <Field id="smtpPort" label="SMTP Port" error={errors.smtpPort?.message}>
              {(inputProps) => (
                <Select {...inputProps} {...register("smtpPort")}>
                  {SMTP_PORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field id="smtpUser" label="SMTP Kullanıcı Adı" error={errors.smtpUser?.message}>
              {(inputProps) => <Input {...inputProps} placeholder="ornek@site.com" {...register("smtpUser")} />}
            </Field>

            <div className="space-y-1.5">
              <Field
                id="smtpPassword"
                label="SMTP Parola"
                error={errors.smtpPassword?.message}
                hint={
                  !errors.smtpPassword && query.data.smtpPasswordSet && !passwordCleared
                    ? "Değiştirmek için yeni bir parola girin; boş bırakırsanız mevcut parola korunur."
                    : undefined
                }
              >
                {(inputProps) => (
                  <Input
                    {...inputProps}
                    type="password"
                    autoComplete="new-password"
                    disabled={passwordCleared}
                    placeholder={
                      passwordCleared ? "Kaydedilince kaldırılacak" : query.data.smtpPasswordSet ? "••••••••" : "Parola girin"
                    }
                    {...register("smtpPassword", {
                      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                        if (event.target.value) setPasswordCleared(false);
                      },
                    })}
                  />
                )}
              </Field>
              {query.data.smtpPasswordSet &&
                (passwordCleared ? (
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => setPasswordCleared(false)}
                  >
                    Parolayı kaldırma isteğinden vazgeç
                  </button>
                ) : (
                  <button
                    type="button"
                    className="text-xs text-danger hover:underline"
                    onClick={handleRequestPasswordClear}
                  >
                    Parolayı Kaldır
                  </button>
                ))}
            </div>

            <Field id="fromName" label="Gönderen Adı" error={errors.fromName?.message}>
              {(inputProps) => <Input {...inputProps} placeholder="Örnek Klinik" {...register("fromName")} />}
            </Field>

            <Field id="fromAddress" label="Gönderen Adresi" error={errors.fromAddress?.message}>
              {(inputProps) => <Input {...inputProps} placeholder="bilgi@ornek.com" {...register("fromAddress")} />}
            </Field>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 sm:col-span-2">
              <div>
                <p className="text-sm font-medium text-foreground">TLS bağlantısı</p>
                <p className="text-xs text-foreground/60">
                  Açıkken bağlantı en baştan TLS kurar (genellikle port 465). Kapalıyken STARTTLS kullanılır (587/25).
                </p>
              </div>
              <Controller
                control={control}
                name="smtpSecure"
                render={({ field }) => (
                  <Switch
                    aria-label="SMTP TLS bağlantısını etkinleştir"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </div>
          </div>

          {updateMutation.isError && <Alert variant="error">{friendlyErrorMessage(updateMutation.error)}</Alert>}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div className="flex flex-col gap-1">
              {query.data.lastTestedAt ? (
                <span className="flex items-center gap-1.5 text-xs text-foreground/70">
                  {query.data.lastTestSucceeded ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 shrink-0 text-danger" />
                  )}
                  Son test: {formatDate(query.data.lastTestedAt)} —{" "}
                  {query.data.lastTestSucceeded ? "başarılı" : "başarısız"}
                  {!query.data.lastTestSucceeded && query.data.lastTestError && ` (${query.data.lastTestError})`}
                </span>
              ) : (
                <span className="text-xs text-foreground/60">Henüz test edilmedi.</span>
              )}
              {isDirty && <span className="text-xs text-warning">Test etmeden önce değişiklikleri kaydedin.</span>}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                loading={testMutation.isPending}
                disabled={isDirty || updateMutation.isPending}
                onClick={() => void handleTest()}
              >
                Test E-postası Gönder
              </Button>
              <Button type="submit" loading={updateMutation.isPending}>
                Kaydet
              </Button>
            </div>
          </div>
        </form>
      )}
    </Card>
  );
}
