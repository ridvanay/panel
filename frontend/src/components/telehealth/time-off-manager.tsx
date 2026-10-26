"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarOff, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type {
  CreateDoctorTimeOffRequest,
  DoctorTimeOff,
  DoctorTimeOffKind,
} from "@/lib/api/types";
import { addDaysToDateKey, wallTimeToUtcIso } from "@/lib/doctor-schedule";
import { cityLabel, gmtLabel } from "@/lib/dual-time";

/**
 * Paket P (İş 2) — izin/istisna günleri yönetimi (doktor portalı + admin, aynı bileşen). Tam gün ya
 * da saat aralığı; saatler DOKTORUN diliminde girilir ve gösterilir. Onaylı randevu olan aralık
 * engellenmez: kayıt sonrası çakışan randevular uyarıyla listelenir (randevulara dokunulmaz). İç not
 * hastaya gösterilmez; sağlık verisi girilmemesi için form uyarısı vardır.
 */
export interface TimeOffLabels {
  title: string;
  description: string;
  kindLabel: string;
  kinds: Record<DoctorTimeOffKind, string>;
  allDay: string;
  fromDate: string;
  toDate: string;
  startTime: string;
  endTime: string;
  note: string;
  noteWarning: string;
  add: string;
  empty: string;
  remove: string;
  /** `{count}` */
  conflictWarning: string;
  /** `{count}` */
  conflictBadge: string;
  invalidRange: string;
  /** `{zone}` */
  timeZoneHint: string;
}

export const TIME_OFF_LABELS_TR: TimeOffLabels = {
  title: "İzin ve istisna günleri",
  description:
    "Bu aralıklarda hastalara randevu saati gösterilmez. Nedeni hastaya gösterilmez.",
  kindLabel: "Tür",
  kinds: {
    VACATION: "Tatil",
    CONGRESS: "Kongre",
    SURGERY_DAY: "Ameliyat günü",
    OTHER: "Diğer",
  },
  allDay: "Tam gün",
  fromDate: "Başlangıç tarihi",
  toDate: "Bitiş tarihi",
  startTime: "Başlangıç saati",
  endTime: "Bitiş saati",
  note: "İç not (isteğe bağlı)",
  noteWarning:
    "Buraya hasta veya sağlık bilgisi yazmayın. Not yalnızca panelde görünür, hastaya gösterilmez.",
  add: "İzin ekle",
  empty: "Tanımlı izin yok.",
  remove: "Kaldır",
  conflictWarning:
    "Bu aralıkta {count} onaylı randevu var. Randevular otomatik iptal edilmez veya değiştirilmez; gerekirse hastayla ayrıca iletişime geçin.",
  conflictBadge: "{count} çakışan randevu",
  invalidRange: "Bitiş, başlangıçtan sonra olmalı.",
  timeZoneHint: "Saatler doktorun saat diliminde: {zone}",
};

const fill = (template: string, params: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ""));

export interface TimeOffManagerProps {
  doctorTimeZone: string;
  labels?: TimeOffLabels;
  intlLocale?: string;
  list: () => Promise<DoctorTimeOff[]>;
  create: (input: CreateDoctorTimeOffRequest) => Promise<DoctorTimeOff>;
  remove: (id: string) => Promise<void>;
  /** Hata mesajı üretici (ör. `friendlyErrorMessage`). */
  errorMessage: (err: unknown) => string;
}

export function TimeOffManager({
  doctorTimeZone,
  labels = TIME_OFF_LABELS_TR,
  intlLocale = "tr-TR",
  list,
  create,
  remove,
  errorMessage,
}: TimeOffManagerProps) {
  const [items, setItems] = useState<DoctorTimeOff[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastConflicts, setLastConflicts] = useState<
    DoctorTimeOff["conflicts"]
  >([]);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    kind: "VACATION" as DoctorTimeOffKind,
    allDay: true,
    fromDate: today,
    toDate: today,
    startTime: "09:00",
    endTime: "17:00",
    note: "",
  });
  const [saving, setSaving] = useState(false);

  // Çağıranlar API fonksiyonlarını satır içi verebilir; her render'da yeniden yüklemeyi önlemek için
  // en güncel fonksiyonlar ref'te tutulur, yükleme yalnızca mount'ta ve işlemlerden sonra çalışır.
  const apiRef = useRef({ list, errorMessage });
  useEffect(() => {
    apiRef.current = { list, errorMessage };
  });
  const load = useCallback(async () => {
    try {
      setItems(await apiRef.current.list());
      setError(null);
    } catch (err) {
      setError(apiRef.current.errorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const fmtRange = (item: DoctorTimeOff) => {
    const date = (iso: string) =>
      new Intl.DateTimeFormat(intlLocale, {
        timeZone: doctorTimeZone,
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(iso));
    const time = (iso: string) =>
      new Intl.DateTimeFormat(intlLocale, {
        timeZone: doctorTimeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(iso));
    if (item.allDay) {
      const lastDay = new Date(
        new Date(item.endsAt).getTime() - 1,
      ).toISOString();
      const a = date(item.startsAt);
      const b = date(lastDay);
      return a === b ? a : `${a} – ${b}`;
    }
    return `${date(item.startsAt)} ${time(item.startsAt)} – ${date(item.endsAt) === date(item.startsAt) ? "" : `${date(item.endsAt)} `}${time(item.endsAt)}`;
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const startsAt = wallTimeToUtcIso(
      form.fromDate,
      form.allDay ? "00:00" : form.startTime,
      doctorTimeZone,
    );
    const endsAt = form.allDay
      ? wallTimeToUtcIso(
          addDaysToDateKey(form.toDate, 1),
          "00:00",
          doctorTimeZone,
        )
      : wallTimeToUtcIso(form.toDate, form.endTime, doctorTimeZone);
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      setError(labels.invalidRange);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await create({
        startsAt,
        endsAt,
        kind: form.kind,
        allDay: form.allDay,
        note: form.note.trim() || null,
      });
      setLastConflicts(created.conflicts);
      setForm((f) => ({ ...f, note: "" }));
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: string) {
    try {
      await remove(id);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const id = (name: string) => `time-off-${name}`;

  return (
    <section className="space-y-4" data-testid="time-off-manager">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <CalendarOff
            className="h-4 w-4 text-foreground/60"
            aria-hidden="true"
          />
          {labels.title}
        </h2>
        <p className="mt-1 text-sm text-foreground/60">{labels.description}</p>
        <p className="mt-1 text-xs text-foreground/50">
          {fill(labels.timeZoneHint, {
            zone: `${cityLabel(doctorTimeZone)} (${gmtLabel(new Date().toISOString(), doctorTimeZone)})`,
          })}
        </p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {lastConflicts.length > 0 && (
        <div data-testid="time-off-conflicts">
          <Alert variant="warning">
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle
                  className="h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                {fill(labels.conflictWarning, { count: lastConflicts.length })}
              </p>
              <ul className="list-disc ps-5 text-sm">
                {lastConflicts.map((c) => (
                  <li key={c.appointmentId}>
                    {new Intl.DateTimeFormat(intlLocale, {
                      timeZone: doctorTimeZone,
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(c.startsAt))}{" "}
                    — {c.patientName}
                    {c.bookingNumber ? ` (${c.bookingNumber})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          </Alert>
        </div>
      )}

      <form
        onSubmit={(e) => void submit(e)}
        className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2"
      >
        <label className="space-y-1 text-sm" htmlFor={id("kind")}>
          <span className="block font-medium">{labels.kindLabel}</span>
          <select
            id={id("kind")}
            value={form.kind}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                kind: e.target.value as DoctorTimeOffKind,
              }))
            }
            className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
          >
            {(Object.keys(labels.kinds) as DoctorTimeOffKind[]).map((k) => (
              <option key={k} value={k}>
                {labels.kinds[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            checked={form.allDay}
            onChange={(e) =>
              setForm((f) => ({ ...f, allDay: e.target.checked }))
            }
          />
          {labels.allDay}
        </label>
        <label className="space-y-1 text-sm" htmlFor={id("from")}>
          <span className="block font-medium">{labels.fromDate}</span>
          <Input
            id={id("from")}
            type="date"
            value={form.fromDate}
            onChange={(e) =>
              setForm((f) => ({ ...f, fromDate: e.target.value }))
            }
            required
          />
        </label>
        <label className="space-y-1 text-sm" htmlFor={id("to")}>
          <span className="block font-medium">{labels.toDate}</span>
          <Input
            id={id("to")}
            type="date"
            value={form.toDate}
            onChange={(e) => setForm((f) => ({ ...f, toDate: e.target.value }))}
            required
          />
        </label>
        {!form.allDay && (
          <>
            <label className="space-y-1 text-sm" htmlFor={id("start")}>
              <span className="block font-medium">{labels.startTime}</span>
              <Input
                id={id("start")}
                type="time"
                value={form.startTime}
                onChange={(e) =>
                  setForm((f) => ({ ...f, startTime: e.target.value }))
                }
                required
              />
            </label>
            <label className="space-y-1 text-sm" htmlFor={id("end")}>
              <span className="block font-medium">{labels.endTime}</span>
              <Input
                id={id("end")}
                type="time"
                value={form.endTime}
                onChange={(e) =>
                  setForm((f) => ({ ...f, endTime: e.target.value }))
                }
                required
              />
            </label>
          </>
        )}
        <label className="space-y-1 text-sm sm:col-span-2" htmlFor={id("note")}>
          <span className="block font-medium">{labels.note}</span>
          <Textarea
            id={id("note")}
            rows={2}
            maxLength={500}
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            aria-describedby={id("note-warning")}
          />
          <span
            id={id("note-warning")}
            className="flex items-start gap-1 text-xs text-warning"
          >
            <AlertTriangle
              className="mt-0.5 h-3 w-3 shrink-0"
              aria-hidden="true"
            />
            {labels.noteWarning}
          </span>
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" loading={saving}>
            {labels.add}
          </Button>
        </div>
      </form>

      {items && items.length === 0 && (
        <p className="text-sm text-foreground/50">{labels.empty}</p>
      )}
      {items && items.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              data-testid="time-off-row"
            >
              <div className="min-w-0">
                <p className="font-medium text-foreground">
                  {labels.kinds[item.kind]} ·{" "}
                  <span className="tabular-nums">{fmtRange(item)}</span>
                </p>
                {item.note && (
                  <p className="truncate text-xs text-foreground/50">
                    {item.note}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {item.conflicts.length > 0 && (
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                    {fill(labels.conflictBadge, {
                      count: item.conflicts.length,
                    })}
                  </span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRemove(item.id)}
                  aria-label={`${labels.remove}: ${labels.kinds[item.kind]} ${fmtRange(item)}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {labels.remove}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
