"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { WEEKLY_EDITOR_LABELS_TR, WeeklyAvailabilityEditor, type WeeklyEditorLabels } from "@/components/admin/telehealth/weekly-availability-editor";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { setServiceDeskHours, type ServiceDeskHour } from "@/lib/api/service-desk-admin";
import type { DoctorAvailabilityRuleInput } from "@/lib/api/types";
import { DAY_NAMES_TR, findHourOverlaps } from "./service-desk-format";

const LABELS: WeeklyEditorLabels = {
  ...WEEKLY_EDITOR_LABELS_TR,
  noWindows: "Bu gün çalışma saati tanımlı değil (kapalı).",
  addWindow: "Aralık ekle",
  addWindowAria: "{day} için çalışma aralığı ekle",
  startAria: "{day} başlangıç saati",
  endAria: "{day} bitiş saati",
  removeWindow: "Aralığı kaldır",
  footer: "Saatler masa saat diliminin duvar saatidir. Hasta, bu aralıklardaki uygun görüşme saatlerini görür. En fazla 21 aralık tanımlanabilir.",
};

function toRules(hours: ServiceDeskHour[]): DoctorAvailabilityRuleInput[] {
  return hours.map((h) => ({ dayOfWeek: h.dayOfWeek, startMinute: h.startMinute, endMinute: h.endMinute, isActive: true }));
}

/**
 * Hizmet masası haftalık çalışma saatleri. Mevcut doktor haftalık müsaitlik editörünü (`WeeklyAvailabilityEditor`) yeniden
 * kullanır; ek olarak aynı gün içindeki çakışan aralıkları uyarır ve kaydı engeller. Kayıt, TAM listeyi gönderir.
 */
export function DeskHoursCard({
  hours,
  timeZone,
  canEdit,
  onSaved,
}: {
  hours: ServiceDeskHour[];
  timeZone: string;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [rules, setRules] = useState<DoctorAvailabilityRuleInput[]>(() => toRules(hours));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const overlapDays = useMemo(() => findHourOverlaps(rules), [rules]);
  const invalidRange = rules.some((r) => r.startMinute >= r.endMinute);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const saved = await setServiceDeskHours(
        rules.map((r) => ({ dayOfWeek: r.dayOfWeek, startMinute: r.startMinute, endMinute: r.endMinute }))
      );
      setRules(toRules(saved));
      toast.success("Çalışma saatleri kaydedildi.");
      onSaved();
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4" data-testid="desk-hours-card">
      <div>
        <h2 className="admin-h2 flex items-center gap-2">
          <Clock className="h-4 w-4" aria-hidden="true" />
          Haftalık çalışma saatleri
        </h2>
        <p className="mt-1 admin-text-secondary">Hizmet masasının görüşme alabildiği saatler ({timeZone}). Tatil günleri bu saatleri o gün için kapatır.</p>
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      {overlapDays.length > 0 && (
        <Alert variant="warning">
          <span className="flex items-start gap-2" data-testid="desk-hours-overlap">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Çakışan aralıklar var: {overlapDays.map((d) => DAY_NAMES_TR[d - 1]).join(", ")}. Aynı gündeki aralıklar birbirine girmemeli.</span>
          </span>
        </Alert>
      )}
      <fieldset disabled={!canEdit || saving} className="min-w-0 border-0 p-0">
        <legend className="sr-only">Haftalık çalışma saatleri</legend>
        <WeeklyAvailabilityEditor rules={rules} onChange={setRules} labels={LABELS} />
      </fieldset>
      {canEdit && (
        <Button type="button" loading={saving} disabled={overlapDays.length > 0 || invalidRange} onClick={() => void save()}>
          Çalışma saatlerini kaydet
        </Button>
      )}
    </Card>
  );
}
