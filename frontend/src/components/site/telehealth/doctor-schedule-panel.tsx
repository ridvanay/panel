"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import * as telehealthApi from "@/lib/api/telehealth";
import type { DoctorAvailabilityRuleInput } from "@/lib/api/types";
import { useFriendlyError, usePortalStrings } from "@/lib/i18n/use-portal-strings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WeeklyAvailabilityEditor, type WeeklyEditorLabels } from "@/components/admin/telehealth/weekly-availability-editor";
import { TimeOffManager, type TimeOffLabels } from "@/components/telehealth/time-off-manager";

/**
 * Paket P (İş 2) — `/{lang}/doctor/schedule`: doktor haftalık çalışma saatlerini ve izin/istisna
 * günlerini TEK ekranda yönetir. Saatler doktorun kendi diliminde; izin aralığındaki onaylı
 * randevular uyarıyla listelenir, randevulara dokunulmaz.
 */
export function DoctorSchedulePanel() {
  const { t, intlLocale } = usePortalStrings();
  const s = t.doctorSchedule;
  const friendlyErrorMessage = useFriendlyError();
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [rules, setRules] = useState<DoctorAvailabilityRuleInput[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [profile, availability] = await Promise.all([telehealthApi.getDoctorPortalProfile(), telehealthApi.getMyAvailability()]);
      setTimeZone(profile.doctorProfile.timeZone);
      setRules(availability.map(({ dayOfWeek, startMinute, endMinute, isActive }) => ({ dayOfWeek, startMinute, endMinute, isActive })));
      setError(null);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, [friendlyErrorMessage]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const weeklyLabels: WeeklyEditorLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(intlLocale, { weekday: "long", timeZone: "UTC" });
    return {
      days: Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i)))),
      addWindow: s.addWindow,
      addWindowAria: s.addWindowAria,
      noWindows: s.noWindows,
      startAria: s.startAria,
      endAria: s.endAria,
      endAfterStart: s.endAfterStart,
      removeWindow: s.removeWindow,
      footer: s.footer,
    };
  }, [intlLocale, s]);

  const timeOffLabels: TimeOffLabels = {
    title: s.timeOffTitle,
    description: s.timeOffDescription,
    kindLabel: s.kindLabel,
    kinds: { VACATION: s.kindVacation, CONGRESS: s.kindCongress, SURGERY_DAY: s.kindSurgeryDay, OTHER: s.kindOther },
    allDay: s.allDay,
    fromDate: s.fromDate,
    toDate: s.toDate,
    startTime: s.startTime,
    endTime: s.endTime,
    note: s.note,
    noteWarning: s.noteWarning,
    add: s.add,
    empty: s.empty,
    remove: s.remove,
    conflictWarning: s.conflictWarning,
    conflictBadge: s.conflictBadge,
    invalidRange: s.invalidRange,
    timeZoneHint: s.timeZoneHint,
  };

  async function save() {
    if (!rules) return;
    setSaving(true);
    try {
      await telehealthApi.setMyAvailability({ rules });
      toast.success(s.saved);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="doctor-schedule-panel">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{s.pageTitle}</h1>
        <p className="mt-1 text-sm text-foreground/60">{s.pageDescription}</p>
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      {!rules || !timeZone ? (
        !error && <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-3 rounded-[var(--site-radius)] border border-border bg-surface p-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">{s.weeklyTitle}</h2>
              <p className="mt-1 text-sm text-foreground/60">{s.weeklyDescription}</p>
            </div>
            <WeeklyAvailabilityEditor rules={rules} onChange={setRules} labels={weeklyLabels} />
            <Button type="button" size="sm" loading={saving} onClick={() => void save()}>
              {s.save}
            </Button>
          </section>
          <div className="rounded-[var(--site-radius)] border border-border bg-surface p-4">
            <TimeOffManager
              doctorTimeZone={timeZone}
              labels={timeOffLabels}
              intlLocale={intlLocale}
              list={telehealthApi.listMyTimeOff}
              create={telehealthApi.createMyTimeOff}
              remove={telehealthApi.deleteMyTimeOff}
              errorMessage={friendlyErrorMessage}
            />
          </div>
        </div>
      )}
    </div>
  );
}
