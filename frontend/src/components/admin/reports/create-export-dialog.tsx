"use client";

import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateExportJob } from "@/hooks/use-export-jobs";
import type { CreateExportJobRequest, ExportJobType, SiteRole, StatsGranularity, SubscriptionStatus } from "@/lib/api/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { GRANULARITY_LABELS, dateKeyToUtcIso } from "@/lib/stats-range";
import {
  EXPORT_FILE_FORMAT_LABELS,
  EXPORT_JOB_TYPE_DESCRIPTIONS,
  EXPORT_JOB_TYPE_LABELS,
  EXPORT_JOB_TYPES_WITH_PII,
  EXPORT_JOB_TYPES_WITH_ROLE_FILTER,
  EXPORT_JOB_TYPES_WITH_SUBSCRIPTION_FILTER,
} from "./export-labels";

const EXPORT_TYPE_OPTIONS: ExportJobType[] = ["VIEWS", "BREAKDOWN", "SUMMARY", "TOP_CONTENT", "USERS", "REVENUE"];
const FORMAT_OPTIONS: CreateExportJobRequest["format"][] = ["CSV", "PDF"];
const GRANULARITY_OPTIONS: StatsGranularity[] = ["day", "week", "month"];
const ROLE_OPTIONS: SiteRole[] = ["ADMIN", "EDITOR", "VIEWER"];
const SUBSCRIPTION_STATUS_OPTIONS: SubscriptionStatus[] = ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "INCOMPLETE"];

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// Backend `CreateExportJobRequestSchema`'yı BİREBİR (openapi.yaml `Reports` tag'i) yansıtan
// istemci tarafı zod şeması — react-hook-form + zod ile client-side doğrulama (frontend-agent
// sorumluluğu; backend hata mesajları da `mutation.error` üzerinden forma yansıtılır).
const formSchema = z
  .object({
    type: z.enum(["VIEWS", "BREAKDOWN", "SUMMARY", "TOP_CONTENT", "USERS", "REVENUE"]),
    format: z.enum(["CSV", "PDF"]),
    from: z.string().min(1, "Başlangıç tarihi gerekli."),
    to: z.string().min(1, "Bitiş tarihi gerekli."),
    granularity: z.enum(["day", "week", "month"]),
    // Boş string "filtre yok" anlamına gelir — enum'a BİLEREK kısıtlanmaz (bkz. onSubmit'teki dönüşüm).
    role: z.string().optional(),
    subscriptionStatus: z.string().optional(),
    unmaskPii: z.boolean(),
  })
  .refine((v) => v.from <= v.to, { message: "Başlangıç tarihi bitiş tarihinden sonra olamaz.", path: ["to"] });

type FormValues = z.infer<typeof formSchema>;

interface CreateExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Oluşturma başarılı olunca çağrılır — üst bileşen yeni işi listede/detaylı görünümde vurgulayabilir. */
  onCreated: (jobId: string) => void;
}

/**
 * "Yeni Dışa Aktarma" formu — `admin/import/import-upload-dialog.tsx` ile AYNI Dialog görsel
 * dilini kullanır. `unmaskPii` uyarısı compliance-agent'ın maskeleme kararına saygılı bir UX:
 * varsayılan KAPALI, yalnızca PII içerebilecek rapor tiplerinde (`USERS`) gösterilir ve
 * "yalnızca zorunlu durumlarda" ibaresiyle AÇIKÇA uyarır.
 */
export function CreateExportDialog({ open, onOpenChange, onCreated }: CreateExportDialogProps) {
  const mutation = useCreateExportJob();

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      type: "VIEWS",
      format: "CSV",
      from: todayKey(),
      to: todayKey(),
      granularity: "day",
      role: "",
      subscriptionStatus: "",
      unmaskPii: false,
    },
  });

  // `useWatch` — `form.watch()`'un aksine React Compiler ile UYUMLU (bkz. `react-hooks/incompatible-library`
  // lint kuralı): `watch()`'un döndürdüğü fonksiyon referansı memoize edilemediği için derleyici
  // bu bileşeni memoizasyondan atlıyordu, `useWatch` bağımsız bir reaktif abonelik olduğundan sorunu ortadan kaldırır.
  const type = useWatch({ control, name: "type" });
  const showRoleFilter = EXPORT_JOB_TYPES_WITH_ROLE_FILTER.includes(type);
  const showSubscriptionFilter = EXPORT_JOB_TYPES_WITH_SUBSCRIPTION_FILTER.includes(type);
  const showPiiWarning = EXPORT_JOB_TYPES_WITH_PII.includes(type);

  function handleOpenChange(next: boolean) {
    if (!next && !mutation.isPending) {
      reset();
      mutation.reset();
    }
    if (!mutation.isPending) onOpenChange(next);
  }

  async function onSubmit(values: FormValues) {
    const payload: CreateExportJobRequest = {
      type: values.type,
      format: values.format,
      // Yerel gün seçimini GERÇEK UTC gün başı/sonuna normalize eder — `lib/stats-range.ts` ile AYNI yardımcı.
      from: dateKeyToUtcIso(values.from, "start"),
      to: dateKeyToUtcIso(values.to, "end"),
      granularity: values.granularity,
      unmaskPii: values.unmaskPii,
      filters: {
        role: showRoleFilter && values.role ? (values.role as SiteRole) : undefined,
        subscriptionStatus: showSubscriptionFilter && values.subscriptionStatus ? (values.subscriptionStatus as SubscriptionStatus) : undefined,
      },
    };

    // `mutateAsync` başarısızlıkta fırlatır (TanStack Query) — hata zaten `mutation.error` ile
    // yukarıda render ediliyor, burada sadece yakalanmamış promise reddini önlemek için yutulur.
    let job: Awaited<ReturnType<typeof mutation.mutateAsync>>;
    try {
      job = await mutation.mutateAsync(payload);
    } catch {
      return;
    }
    reset();
    onOpenChange(false);
    onCreated(job.id);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Yeni Dışa Aktarma</DialogTitle>
          <DialogDescription>
            Bir rapor tipi ve tarih aralığı seçin — dosya arka planda hazırlanır, hazır olduğunda buradan
            indirebilirsiniz.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div>
            <Field id="export-type" label="Rapor Tipi" required>
              {(inputProps) => (
                <Select {...inputProps} {...register("type")}>
                  {EXPORT_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {EXPORT_JOB_TYPE_LABELS[option]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <p className="mt-1.5 text-xs text-foreground/60">{EXPORT_JOB_TYPE_DESCRIPTIONS[type]}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field id="export-format" label="Format" required>
              {(inputProps) => (
                <Select {...inputProps} {...register("format")}>
                  {FORMAT_OPTIONS.map((format) => (
                    <option key={format} value={format}>
                      {EXPORT_FILE_FORMAT_LABELS[format]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="export-granularity" label="Gruplama" required>
              {(inputProps) => (
                <Select {...inputProps} {...register("granularity")}>
                  {GRANULARITY_OPTIONS.map((granularity) => (
                    <option key={granularity} value={granularity}>
                      {GRANULARITY_LABELS[granularity]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field id="export-from" label="Başlangıç" error={errors.from?.message} required>
              {(inputProps) => <Input {...inputProps} type="date" max={todayKey()} {...register("from")} />}
            </Field>
            <Field id="export-to" label="Bitiş" error={errors.to?.message} required>
              {(inputProps) => <Input {...inputProps} type="date" max={todayKey()} {...register("to")} />}
            </Field>
          </div>

          {showRoleFilter && (
            <Field id="export-role" label="Rol filtresi (opsiyonel)">
              {(inputProps) => (
                <Select {...inputProps} {...register("role")}>
                  <option value="">Tümü</option>
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          {showSubscriptionFilter && (
            <Field id="export-subscription-status" label="Abonelik durumu filtresi (opsiyonel)">
              {(inputProps) => (
                <Select {...inputProps} {...register("subscriptionStatus")}>
                  <option value="">Tümü</option>
                  {SUBSCRIPTION_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          {showPiiWarning && (
            <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 p-3">
              <Controller
                control={control}
                name="unmaskPii"
                render={({ field }) => (
                  <Checkbox
                    id="export-unmask-pii"
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                    className="mt-0.5"
                  />
                )}
              />
              <div>
                <Label htmlFor="export-unmask-pii" className="text-warning">
                  Ham/maskesiz kişisel veriyi göster
                </Label>
                <p className="mt-1 text-xs text-foreground/70">
                  Varsayılan olarak e-posta gibi kişisel veriler maskelenir. Bu seçenek yalnızca ZORUNLU durumlarda
                  işaretlenmelidir — ham veri içeren dosyalar daha kısa süre saklanır ve bu işlem ayrıca denetim
                  (audit) kaydına yazılır.
                </p>
              </div>
            </div>
          )}

          {mutation.isError && <Alert variant="error">{friendlyErrorMessage(mutation.error)}</Alert>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={mutation.isPending}>
              Vazgeç
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Oluştur
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
