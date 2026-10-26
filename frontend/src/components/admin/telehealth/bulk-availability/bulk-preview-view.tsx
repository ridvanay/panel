"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { BulkConflict, BulkPreview, BulkPreviewDoctor, BulkPreviewResult, BulkWeeklyMode } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TIME_OFF_LABELS_TR } from "@/components/telehealth/time-off-manager";
import { TURKEY_TIME_ZONE, cityLabel, gmtLabel, isSameClockAsTurkey } from "@/lib/dual-time";
import { DAY_SHORT_TR, groupByDay, ruleKey, ruleRange } from "./bulk-format";

/**
 * Paket Q — toplu işlem önizlemesi: doğrulama hataları (satır numarasıyla) YA DA doktor bazında
 * haftalık saatler (önce/sonra), eklenecek izinler, onaylı randevu çakışmaları ve dosyada olmayan
 * doktorlar. Çakışma varsa onay kutusu işaretlenmeden "Uygula" pasif (sunucu da 400 döner).
 */
const turkeyFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: TURKEY_TIME_ZONE });

function ConflictTime({ conflict }: { conflict: BulkConflict }) {
  const tz = conflict.patientTimeZone;
  const patient =
    tz && !isSameClockAsTurkey(conflict.startsAt, tz)
      ? ` · Hasta: ${cityLabel(tz)} ${new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: tz }).format(new Date(conflict.startsAt))} (${gmtLabel(conflict.startsAt, tz)})`
      : "";
  return (
    <bdi dir="ltr">
      {turkeyFormatter.format(new Date(conflict.startsAt))} TSİ{patient}
    </bdi>
  );
}

function timeOffText(t: BulkPreviewDoctor["timeOff"]["toAdd"][number], timeZone: string) {
  const date = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone });
  const time = new Intl.DateTimeFormat("tr-TR", { timeStyle: "short", timeZone });
  const start = new Date(t.startsAt);
  // Bitiş hariç tutulan sınırdır; tam gün izinde son gün = bitiş − 1 ms.
  const end = new Date(new Date(t.endsAt).getTime() - (t.allDay ? 1 : 0));
  const days = date.format(start) === date.format(end) ? date.format(start) : `${date.format(start)} – ${date.format(end)}`;
  return t.allDay ? `${days} (tam gün)` : `${days} ${time.format(start)}–${time.format(new Date(t.endsAt))}`;
}

function WeeklyDiff({ weekly }: { weekly: NonNullable<BulkPreviewDoctor["weekly"]> }) {
  const added = new Set(weekly.added.map(ruleKey));
  const removed = new Set(weekly.removed.map(ruleKey));
  const column = (title: string, rules: typeof weekly.after, mark: Set<string>, tone: "added" | "removed") => (
    <div className="min-w-0 flex-1 rounded-md border border-border p-2">
      <p className="mb-1 text-xs font-medium text-foreground/60">{title}</p>
      {rules.length === 0 && <p className="text-xs text-foreground/50">Çalışma saati yok</p>}
      <ul className="space-y-0.5 text-sm">
        {groupByDay(rules).map(({ day, rules: list }) => (
          <li key={day} className="flex gap-2">
            <span className="w-8 shrink-0 text-foreground/60">{DAY_SHORT_TR[day]}</span>
            <span className="flex flex-wrap gap-x-2">
              {list.map((r) => {
                const changed = mark.has(ruleKey(r));
                return (
                  <bdi
                    key={ruleKey(r)}
                    dir="ltr"
                    data-diff={changed ? tone : "unchanged"}
                    className={changed ? (tone === "added" ? "font-medium text-success" : "text-danger line-through") : undefined}
                  >
                    {changed ? (tone === "added" ? "+ " : "− ") : ""}
                    {ruleRange(r)}
                  </bdi>
                );
              })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div>
      <p className="mb-1 text-xs text-foreground/60">
        Haftalık saatler: {weekly.added.length} eklenecek · {weekly.removed.length} kaldırılacak · {weekly.unchanged.length} değişmeyen
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        {column("Önce", weekly.before, removed, "removed")}
        {column("Sonra", weekly.after, added, "added")}
      </div>
    </div>
  );
}

const MODE_LABELS: Record<BulkPreview["source"], Record<BulkWeeklyMode, string>> = {
  CSV: {
    replace: "Dosyadaki doktorların haftalık saatlerini dosyadakiyle değiştir",
    append: "Yalnızca ekle (mevcut aralıklar silinmez; çakışma hata verir)",
  },
  TEMPLATE: {
    replace: "Seçilen doktorların haftalık saatlerini şablonla değiştir",
    append: "Yalnızca ekle (mevcut aralıklar silinmez; çakışma hata verir)",
  },
  TIME_OFF: { replace: "", append: "" },
};

export function BulkPreviewView({
  result,
  busy,
  onModeChange,
  onApply,
  onDiscard,
}: {
  result: BulkPreviewResult;
  busy: boolean;
  onModeChange: (mode: BulkWeeklyMode) => void;
  onApply: (acknowledgeConflicts: boolean) => void;
  onDiscard: () => void;
}) {
  const [ack, setAck] = useState(false);

  if (!result.valid || !result.preview) {
    return (
      <section className="space-y-2" data-testid="bulk-preview-errors" role="alert">
        <Alert variant="error">
          <p className="font-medium">Dosyada {result.errors.length} hata var. Hiçbir değişiklik uygulanmadı.</p>
          <p className="text-sm">Hataları düzeltip yeniden yükleyin.</p>
        </Alert>
        <ul className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-border p-3 text-sm">
          {result.errors.map((e, i) => (
            <li key={i}>
              {e.row !== null && <span className="me-2 font-medium tabular-nums">Satır {e.row}:</span>}
              {e.message}
            </li>
          ))}
        </ul>
        <Button type="button" variant="outline" size="sm" onClick={onDiscard}>
          Kapat
        </Button>
      </section>
    );
  }

  const p = result.preview;
  const conflicts = p.totals.conflicts;
  const nothingToDo = p.totals.rulesAdded === 0 && p.totals.rulesRemoved === 0 && p.totals.timeOffAdded === 0;
  const kinds = TIME_OFF_LABELS_TR.kinds;

  return (
    <section className="space-y-4" data-testid="bulk-preview" aria-label="Önizleme">
      <div className="rounded-lg border border-border bg-surface p-3 text-sm" role="status">
        <p className="font-medium">
          Önizleme{p.fileName ? ` — ${p.fileName}` : ""}: {p.totals.doctors} doktor
        </p>
        <p className="text-foreground/70">
          {p.totals.rulesAdded} saat aralığı eklenecek · {p.totals.rulesRemoved} kaldırılacak · {p.totals.timeOffAdded} izin eklenecek
          {p.totals.timeOffSkipped > 0 ? ` · ${p.totals.timeOffSkipped} izin zaten kayıtlı (atlanacak)` : ""}
        </p>
        <p className="mt-1 text-xs text-foreground/50">
          Saatler her doktorun kendi saat diliminde. Önizleme {new Intl.DateTimeFormat("tr-TR", { timeStyle: "short" }).format(new Date(p.expiresAt))} saatine kadar geçerli.
        </p>
      </div>

      {p.source !== "TIME_OFF" && (
        <fieldset className="space-y-1 text-sm">
          <legend className="font-medium">Haftalık saatler nasıl uygulansın?</legend>
          {(["replace", "append"] as const).map((mode) => (
            <label key={mode} className="flex items-center gap-2">
              <input type="radio" name="bulk-weekly-mode" checked={p.weeklyMode === mode} disabled={busy} onChange={() => onModeChange(mode)} />
              {MODE_LABELS[p.source][mode]}
            </label>
          ))}
          <p className="text-xs text-foreground/50">İzinler her zaman yalnızca eklenir; aynısı zaten varsa atlanır. İzin silme panelden tek tek yapılır.</p>
        </fieldset>
      )}

      <ul className="space-y-3">
        {p.doctors.map((d) => (
          <li key={d.doctorId} className="space-y-2 rounded-lg border border-border p-3" data-testid="bulk-preview-doctor">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{d.name}</span>
              <span className="text-xs text-foreground/50">
                {cityLabel(d.timeZone)} ({gmtLabel(new Date().toISOString(), d.timeZone)})
              </span>
              {d.conflicts.length > 0 && <Badge tone="warning">{d.conflicts.length} çakışan randevu</Badge>}
            </div>
            {d.weekly && <WeeklyDiff weekly={d.weekly} />}
            {(d.timeOff.toAdd.length > 0 || d.timeOff.skipped > 0) && (
              <div className="text-sm">
                <p className="text-xs text-foreground/60">
                  İzinler: {d.timeOff.toAdd.length} eklenecek{d.timeOff.skipped > 0 ? ` · ${d.timeOff.skipped} zaten kayıtlı` : ""}
                </p>
                <ul className="list-disc ps-5">
                  {d.timeOff.toAdd.map((t) => (
                    <li key={`${t.startsAt}-${t.endsAt}-${t.kind}`}>
                      <bdi dir="ltr">{timeOffText(t, d.timeZone)}</bdi> — {kinds[t.kind]}
                      {t.hasNote && <span className="text-xs text-foreground/50"> (iç not var)</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {d.conflicts.length > 0 && (
              <div data-testid="bulk-preview-conflicts">
                <Alert variant="warning">
                  <ul className="space-y-0.5 text-sm">
                    {d.conflicts.map((c) => (
                      <li key={c.appointmentId}>
                        <AlertTriangle className="me-1 inline h-3.5 w-3.5" aria-hidden="true" />
                        Randevu {c.bookingNumber ?? c.appointmentId.slice(0, 8)}: <ConflictTime conflict={c} /> —{" "}
                        {c.reason === "TIME_OFF" ? "yeni izin aralığında" : "kaldırılan çalışma saatinde"}
                      </li>
                    ))}
                  </ul>
                </Alert>
              </div>
            )}
          </li>
        ))}
      </ul>

      {p.untouchedDoctors.length > 0 && (
        <details className="rounded-lg border border-border p-3 text-sm">
          <summary className="cursor-pointer">Dosyada olmayan doktorlar ({p.untouchedDoctors.length}) — saatlerine dokunulmaz</summary>
          <p className="mt-2 text-foreground/70">{p.untouchedDoctors.map((d) => d.name).join(", ")}</p>
        </details>
      )}

      {conflicts > 0 && (
        <label className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
          <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>
            {conflicts} onaylı randevu yeni saatlerle çakışıyor. Bu randevular otomatik iptal edilmez veya değiştirilmez; gerekirse hastalarla ayrıca
            iletişime geçeceğim.
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" loading={busy} disabled={nothingToDo || (conflicts > 0 && !ack)} onClick={() => onApply(ack)}>
          <CheckCircle2 className="h-4 w-4" />
          Uygula
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onDiscard}>
          Vazgeç
        </Button>
        {nothingToDo && <span className="text-sm text-foreground/60">Uygulanacak değişiklik yok (her şey zaten kayıtlı).</span>}
      </div>
    </section>
  );
}
