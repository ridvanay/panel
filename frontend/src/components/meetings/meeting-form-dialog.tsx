"use client";

import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { ApiClientError } from "@/lib/api/error";
import { createMeeting, updateMeeting, type Meeting, type UpdateMeetingInput } from "@/lib/api/meetings";
import { fmt, useMeetingErrorMessage, useMeetingStrings } from "@/lib/i18n/use-meeting-strings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120] as const;
export const CAPACITY_OPTIONS = [2, 3, 4, 5, 6, 7, 8] as const;
export const DEFAULT_CAPACITY = 4;
export const TITLE_MIN = 3;
export const TITLE_MAX = 120;

export interface MeetingFormValues {
  title: string;
  date: string;
  time: string;
  durationMin: number;
  maxParticipants: number;
  note: string;
  autoAdmitGuests: boolean;
}

export type MeetingFormErrors = Partial<Record<"title" | "when", "title" | "when" | "past">>;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toTimeInput(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Yeni toplantı için varsayılan: bir sonraki tam saat. */
export function defaultFormValues(now: Date = new Date()): MeetingFormValues {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return {
    title: "",
    date: toDateInput(next),
    time: toTimeInput(next),
    durationMin: 30,
    maxParticipants: DEFAULT_CAPACITY,
    note: "",
    autoAdmitGuests: false,
  };
}

export function valuesFromMeeting(m: Meeting): MeetingFormValues {
  const start = new Date(m.startsAt);
  return {
    title: m.title,
    date: toDateInput(start),
    time: toTimeInput(start),
    durationMin: m.durationMin,
    maxParticipants: m.maxParticipants,
    note: m.note ?? "",
    autoAdmitGuests: m.autoAdmitGuests,
  };
}

/** Yerel tarih + saat → ISO (Z). Geçersizse `null`. */
export function toStartsAtIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** İstemci doğrulaması (sunucu bağlayıcıdır): başlık 3–120, geçerli tarih/saat, geçmiş değil (5 dk tolerans). */
export function validateMeetingForm(values: MeetingFormValues, opts: { checkPast: boolean; now?: number } = { checkPast: true }): MeetingFormErrors {
  const errors: MeetingFormErrors = {};
  const title = values.title.trim();
  if (title.length < TITLE_MIN || title.length > TITLE_MAX) errors.title = "title";
  const iso = toStartsAtIso(values.date, values.time);
  if (!iso) errors.when = "when";
  else if (opts.checkPast && new Date(iso).getTime() < (opts.now ?? Date.now()) - 5 * 60_000) errors.when = "past";
  return errors;
}

export function MeetingFormDialog({
  open,
  onOpenChange,
  meeting,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Verilirse düzenleme; yoksa oluşturma. */
  meeting?: Meeting | null;
  onSaved: (result: { meeting: Meeting; guestLink?: string }) => void;
}) {
  const { t } = useMeetingStrings();
  const errorMessage = useMeetingErrorMessage();
  const editing = Boolean(meeting);
  const [values, setValues] = useState<MeetingFormValues>(() => (meeting ? valuesFromMeeting(meeting) : defaultFormValues()));
  const [errors, setErrors] = useState<MeetingFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // Başlamış toplantıda başlangıç/süre değişmez (sunucu da reddeder); diyalog açılırken bir kez hesaplanır.
  const [timeLocked, setTimeLocked] = useState(false);

  // Diyalog her açıldığında (ve düzenlenen kayıt değişince) form sıfırlanır.
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setValues(meeting ? valuesFromMeeting(meeting) : defaultFormValues());
    setErrors({});
    setServerError(null);
    setTimeLocked(Boolean(meeting && new Date(meeting.startsAt).getTime() <= Date.now()));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, meeting]);

  function patch(next: Partial<MeetingFormValues>) {
    setValues((prev) => ({ ...prev, ...next }));
  }

  async function submit() {
    const found = validateMeetingForm(values, { checkPast: !timeLocked });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const startsAt = toStartsAtIso(values.date, values.time)!;
    setSubmitting(true);
    setServerError(null);
    try {
      if (meeting) {
        const input: UpdateMeetingInput = {
          title: values.title.trim(),
          maxParticipants: values.maxParticipants,
          note: values.note.trim(),
          autoAdmitGuests: values.autoAdmitGuests,
          ...(timeLocked ? {} : { startsAt, durationMin: values.durationMin }),
        };
        const updated = await updateMeeting(meeting.id, input);
        onSaved({ meeting: updated });
      } else {
        const created = await createMeeting({
          title: values.title.trim(),
          startsAt,
          durationMin: values.durationMin,
          maxParticipants: values.maxParticipants,
          autoAdmitGuests: values.autoAdmitGuests,
          ...(values.note.trim() ? { note: values.note.trim() } : {}),
        });
        onSaved({ meeting: created.meeting, guestLink: created.guestLink });
      }
    } catch (err) {
      // Sunucu alan hatalarını forma yansıt (başlık / zaman); diğerleri çevrilmiş genel mesaj.
      if (err instanceof ApiClientError && err.code === "VALIDATION_ERROR" && err.details) {
        const next: MeetingFormErrors = {};
        if (err.details.title) next.title = "title";
        if (err.details.startsAt) next.when = "when";
        setErrors(next);
      }
      setServerError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const titleError = errors.title ? t.errorTitle : undefined;
  const whenError = errors.when === "past" ? t.errorPast : errors.when ? t.errorWhen : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto sm:max-w-lg" data-testid="meeting-form-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? t.formEditTitle : t.formCreateTitle}</DialogTitle>
          <DialogDescription className="sr-only">{t.pageDescription}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-4"
        >
          {serverError && <Alert variant="error">{serverError}</Alert>}

          <div className="space-y-1.5">
            <Field id="meeting-title" label={t.fieldTitle} error={titleError} required>
              {(inputProps) => (
                <Input
                  {...inputProps}
                  value={values.title}
                  maxLength={TITLE_MAX}
                  aria-describedby={[inputProps["aria-describedby"], "meeting-title-warning"].filter(Boolean).join(" ")}
                  onChange={(e) => patch({ title: e.target.value })}
                />
              )}
            </Field>
            <p id="meeting-title-warning" className="flex items-start gap-1.5 text-xs font-medium text-warning" data-testid="meeting-title-warning">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t.titleGuestWarning}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="meeting-date" label={t.fieldDate} error={whenError} required>
              {(inputProps) => <Input {...inputProps} type="date" value={values.date} disabled={timeLocked} onChange={(e) => patch({ date: e.target.value })} />}
            </Field>
            <Field id="meeting-time" label={t.fieldTime} required>
              {(inputProps) => <Input {...inputProps} type="time" value={values.time} disabled={timeLocked} onChange={(e) => patch({ time: e.target.value })} />}
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="meeting-duration" label={t.fieldDuration}>
              {(inputProps) => (
                <Select {...inputProps} value={values.durationMin} disabled={timeLocked} onChange={(e) => patch({ durationMin: Number(e.target.value) })}>
                  {DURATION_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {fmt(t.durationMinutes, { minutes: m })}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="meeting-capacity" label={t.fieldCapacity} hint={t.capacityHint}>
              {(inputProps) => (
                <Select {...inputProps} value={values.maxParticipants} onChange={(e) => patch({ maxParticipants: Number(e.target.value) })}>
                  {CAPACITY_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {fmt(t.capacityOption, { count: n })}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <Field id="meeting-note" label={t.fieldNote} hint={t.noteHint}>
            {(inputProps) => <Textarea {...inputProps} rows={3} maxLength={1000} value={values.note} onChange={(e) => patch({ note: e.target.value })} />}
          </Field>

          <div className="flex items-start gap-3">
            <Switch
              id="meeting-auto-admit"
              checked={values.autoAdmitGuests}
              onCheckedChange={(checked) => patch({ autoAdmitGuests: checked })}
              aria-describedby="meeting-auto-admit-hint"
            />
            <div className="space-y-0.5">
              <label htmlFor="meeting-auto-admit" className="cursor-pointer text-sm font-medium text-foreground">
                {t.fieldAutoAdmit}
              </label>
              <p id="meeting-auto-admit-hint" className="text-xs text-foreground/60">
                {t.autoAdmitHint}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.formCancel}
            </Button>
            <Button type="submit" loading={submitting} data-testid="meeting-form-submit">
              {editing ? t.submitSave : t.submitCreate}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
