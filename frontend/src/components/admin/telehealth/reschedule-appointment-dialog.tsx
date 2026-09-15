"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CalendarClock } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { Appointment } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";
import { ApiClientError } from "@/lib/api/error";

const dateTimeFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

/**
 * Backend `RescheduleAppointmentRequestSchema` (openapi.yaml) gövdesini yansıtan istemci tarafı
 * zod şeması — `newDate` `YYYY-MM-DD`, `newStartTime` `HH:mm`, ikisi de doktorun kendi saat
 * diliminde DUVAR SAATİDİR. Süre alanı BİLİNÇLİ olarak YOKTUR — backend süreyi korur.
 */
const rescheduleFormSchema = z.object({
  newDate: z
    .string()
    .min(1, "Yeni tarih seçin.")
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Geçerli bir tarih seçin."),
  newStartTime: z
    .string()
    .min(1, "Yeni başlangıç saati seçin.")
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Geçerli bir saat seçin."),
  reason: z.string().max(500, "Değişiklik nedeni en fazla 500 karakter olabilir.").optional(),
});

type RescheduleFormValues = z.infer<typeof rescheduleFormSchema>;

interface RescheduleAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` iken dialog kapalı sayılır (`open` zaten `false` olur, ama içerik render edilmeye çalışılmaz). */
  appointment: Appointment | null;
  /** Kaydetme başarılı olduktan SONRA çağrılır — çağıran taraf tabloyu yeniden yükler. */
  onRescheduled: () => void | Promise<void>;
}

/**
 * "Tarih/Saat Değiştir" — `PATCH /admin/telehealth/appointments/{id}/reschedule` (YALNIZCA ADMIN,
 * `MANAGER` 403 alır — sunucu tarafında zaten uygulanıyor, bu dialog kendi başına bir rol kontrolü
 * YAPMAZ). Backend'in DESTEKLEMEDİĞİ bir "doktorun müsait slotları" listesi İCAT EDİLMEZ — yalnızca
 * serbest tarih+saat girişi sunulur, 409 çakışma hatası forma kullanıcı-dostu bir mesajla yansıtılır.
 */
export function RescheduleAppointmentDialog({ open, onOpenChange, appointment, onRescheduled }: RescheduleAppointmentDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RescheduleFormValues>({
    resolver: zodResolver(rescheduleFormSchema),
    defaultValues: { newDate: "", newStartTime: "", reason: "" },
  });

  // Dialog her açılışta (farklı bir randevu için yeniden açılsa dahi) temiz bir formla başlar —
  // önceki randevu için girilmiş bir tarih/saatin YANLIŞLIKLA başka bir randevuya gönderilmesi
  // riskini ortadan kaldırır (`set-user-password-dialog.tsx` İLE AYNI desen).
  useEffect(() => {
    if (open) reset({ newDate: "", newStartTime: "", reason: "" });
  }, [open, reset]);

  function handleOpenChange(next: boolean) {
    if (!isSubmitting) onOpenChange(next);
  }

  async function onSubmit(values: RescheduleFormValues) {
    if (!appointment) return;
    try {
      await telehealthApi.rescheduleAppointment(appointment.id, {
        newDate: values.newDate,
        newStartTime: values.newStartTime,
        reason: values.reason?.trim() ? values.reason.trim() : undefined,
      });
    } catch (err) {
      // 409 (doktorun aynı saatte başka aktif randevusu) — kullanıcı dostu bir mesajla `newStartTime`
      // alanına yansıtılır (ham backend mesajı zaten Türkçe/anlaşılır, ama alanla ilişkilendirilir).
      if (err instanceof ApiClientError && err.code === "APPOINTMENT_RESCHEDULE_CONFLICT") {
        setError("newStartTime", { message: "Doktorun bu saatte başka bir randevusu var, farklı bir saat seçin." });
        return;
      }
      // 422 (DST/biçim hatası) — backend `newStartTime` alanına detay döner.
      const fieldErrors = fieldErrorsFrom(err);
      if (fieldErrors.newStartTime) {
        setError("newStartTime", { message: fieldErrors.newStartTime });
      } else if (fieldErrors.newDate) {
        setError("newDate", { message: fieldErrors.newDate });
      } else {
        setError("root", { message: friendlyErrorMessage(err) });
      }
      return;
    }
    toast.success("Randevu yeniden planlandı, ilgili taraflara bildirim gönderildi.");
    await onRescheduled();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CalendarClock className="h-4 w-4" />
            </span>
            <div>
              <DialogTitle>Tarih/Saat Değiştir</DialogTitle>
              <DialogDescription className="mt-1">
                {appointment
                  ? `"${appointment.patientName}" için mevcut randevu ${dateTimeFormatter.format(new Date(appointment.startsAt))} tarihinde. Yeni tarih ve saati doktorun KENDİ yerel saatine göre girin.`
                  : undefined}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          {errors.root?.message && <Alert variant="error">{errors.root.message}</Alert>}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="reschedule-new-date" label="Yeni Tarih" error={errors.newDate?.message} required>
              {(inputProps) => <Input {...inputProps} type="date" {...register("newDate")} />}
            </Field>

            <Field id="reschedule-new-start-time" label="Yeni Başlangıç Saati" error={errors.newStartTime?.message} required>
              {(inputProps) => <Input {...inputProps} type="time" {...register("newStartTime")} />}
            </Field>
          </div>

          <Field
            id="reschedule-reason"
            label="Değişiklik Nedeni"
            hint="Opsiyonel — hasta ve doktora gönderilecek bildirimde kullanılır."
            error={errors.reason?.message}
          >
            {(inputProps) => <Textarea {...inputProps} maxLength={500} rows={3} {...register("reason")} />}
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
              Vazgeç
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Değişikliği Kaydet ve Taraflara Bildir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
