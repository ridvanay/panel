"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { CalendarOff, CalendarRange, Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import * as telehealthApi from "@/lib/api/telehealth";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type {
  BulkOperation,
  BulkPreviewResult,
  BulkWeeklyMode,
  DoctorAvailabilityRuleInput,
  DoctorProfile,
  DoctorTimeOffKind,
  Specialty,
} from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WeeklyAvailabilityEditor } from "@/components/admin/telehealth/weekly-availability-editor";
import { TIME_OFF_LABELS_TR } from "@/components/telehealth/time-off-manager";
import { BulkDoctorPicker } from "./bulk-doctor-picker";
import { BulkPreviewView } from "./bulk-preview-view";
import { BulkOperationsList } from "./bulk-operations-list";
import { BULK_MAX_FILE_BYTES, fileToBase64 } from "./bulk-format";

/**
 * Paket Q — `/admin/telehealth/doctors/bulk`: üç yol (Excel/CSV, haftalık şablon, toplu izin) AYNI
 * önizleme → uygula → geri al akışına bağlanır. Yalnızca ADMIN (sunucu 403 döner).
 */
async function loadAllDoctors(): Promise<DoctorProfile[]> {
  const all: DoctorProfile[] = [];
  let cursor: string | undefined;
  do {
    const page = await telehealthApi.listAdminDoctors({ limit: 100, cursor });
    all.push(...page.items);
    cursor = page.meta?.nextCursor ?? undefined;
  } while (cursor);
  return all.filter((d) => d.isActive && !d.archivedAt);
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function BulkAvailabilityPanel() {
  const id = useId();
  const [doctors, setDoctors] = useState<DoctorProfile[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [operations, setOperations] = useState<BulkOperation[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkPreviewResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [undoBlocked, setUndoBlocked] = useState<{ operationId: string; changes: string[] } | null>(null);

  // CSV
  const [delimiter, setDelimiter] = useState<"semicolon" | "comma">("semicolon");
  const [file, setFile] = useState<File | null>(null);
  const [downloading, setDownloading] = useState(false);
  // Haftalık şablon
  const [templateRules, setTemplateRules] = useState<DoctorAvailabilityRuleInput[]>([]);
  const [templateDoctorIds, setTemplateDoctorIds] = useState<string[]>([]);
  const [copyFrom, setCopyFrom] = useState("");
  // Toplu izin
  const [timeOffDoctorIds, setTimeOffDoctorIds] = useState<string[]>([]);
  const [timeOff, setTimeOff] = useState({ startDate: "", endDate: "", allDay: true, startTime: "09:00", endTime: "17:00", kind: "VACATION" as DoctorTimeOffKind, note: "" });

  const loadOperations = useCallback(async () => {
    try {
      setOperations(await telehealthApi.listBulkOperations());
    } catch (err) {
      setOperations([]);
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const [docs, specs] = await Promise.all([loadAllDoctors(), telehealthApi.listAdminSpecialties()]);
      setDoctors(docs);
      setSpecialties(specs);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
    await loadOperations();
  }, [loadOperations]);

  const reload = useCallback(async () => {
    setLoadError(null);
    await load();
  }, [load]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function runPreview(request: () => Promise<BulkPreviewResult>, keepResult = false) {
    setBusy(true);
    setActionError(null);
    if (!keepResult) setResult(null);
    try {
      setResult(await request());
    } catch (err) {
      setActionError(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplate() {
    setDownloading(true);
    try {
      const { blob, filename } = await telehealthApi.downloadBulkAvailabilityTemplate(delimiter);
      saveBlob(blob, filename ?? "calisma-saatleri-izinler.csv");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  async function previewFile() {
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setActionError("Yalnızca .csv ya da .txt dosyası yüklenebilir. Excel'de \"CSV olarak kaydet\" kullanın.");
      return;
    }
    if (file.size > BULK_MAX_FILE_BYTES) {
      setActionError("Dosya en fazla 2 MB olabilir.");
      return;
    }
    await runPreview(async () =>
      telehealthApi.previewBulkCsv({ fileName: file.name, contentBase64: await fileToBase64(file), weeklyMode: "replace" })
    );
  }

  async function copyRules(doctorId: string) {
    setCopyFrom(doctorId);
    if (!doctorId) return;
    try {
      const rules = await telehealthApi.getDoctorAvailability(doctorId);
      setTemplateRules(rules.filter((r) => r.isActive).map(({ dayOfWeek, startMinute, endMinute }) => ({ dayOfWeek, startMinute, endMinute, isActive: true })));
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    }
  }

  async function changeMode(mode: BulkWeeklyMode) {
    const previewId = result?.preview?.previewId;
    if (!previewId) return;
    await runPreview(() => telehealthApi.changeBulkPreviewMode(previewId, mode), true);
  }

  async function apply(acknowledgeConflicts: boolean) {
    const previewId = result?.preview?.previewId;
    if (!previewId) return;
    setBusy(true);
    setActionError(null);
    try {
      await telehealthApi.applyBulkPreview(previewId, acknowledgeConflicts);
      toast.success("Toplu işlem uygulandı. Gerekirse \"Son toplu işlemler\" listesinden geri alabilirsiniz.");
      setResult(null);
      setFile(null);
      await loadOperations();
    } catch (err) {
      const stale = err instanceof ApiClientError && (err.code === "BULK_PREVIEW_STALE" || err.status === 404);
      setActionError(stale ? "Önizlemeden sonra veriler değişti ya da önizlemenin süresi doldu. Lütfen yeniden önizleyin." : friendlyErrorMessage(err));
      if (stale) setResult(null);
    } finally {
      setBusy(false);
    }
  }

  async function undo(op: BulkOperation) {
    setUndoingId(op.id);
    setUndoBlocked(null);
    try {
      await telehealthApi.undoBulkOperation(op.id);
      toast.success("Toplu işlem geri alındı.");
      await loadOperations();
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "BULK_UNDO_BLOCKED") setUndoBlocked({ operationId: op.id, changes: err.details?.changes ?? [] });
      else toast.error(friendlyErrorMessage(err));
    } finally {
      setUndoingId(null);
    }
  }

  const tl = TIME_OFF_LABELS_TR;
  const timeOffRangeInvalid =
    Boolean(timeOff.startDate && timeOff.endDate && timeOff.endDate < timeOff.startDate) ||
    (!timeOff.allDay && timeOff.startDate === timeOff.endDate && Boolean(timeOff.startTime && timeOff.endTime) && timeOff.endTime <= timeOff.startTime);
  const timeOffReady =
    timeOffDoctorIds.length > 0 &&
    timeOff.startDate &&
    timeOff.endDate &&
    !timeOffRangeInvalid &&
    (timeOff.allDay || (timeOff.startTime && timeOff.endTime));

  return (
    <div className="space-y-6" data-testid="bulk-availability-panel">
      {loadError && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            {loadError}
            <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      <Tabs
        defaultValue="csv"
        onValueChange={() => {
          setResult(null);
          setActionError(null);
        }}
      >
        <TabsList>
          <TabsTrigger value="csv">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Excel (CSV)
          </TabsTrigger>
          <TabsTrigger value="template">
            <CalendarRange className="h-3.5 w-3.5" />
            Haftalık şablon uygula
          </TabsTrigger>
          <TabsTrigger value="time-off">
            <CalendarOff className="h-3.5 w-3.5" />
            Toplu izin ekle
          </TabsTrigger>
        </TabsList>

        <TabsContent value="csv" className="mt-4 space-y-4 outline-none">
          <ol className="list-decimal space-y-1 ps-5 text-sm text-foreground/70">
            <li>Şablonu indirin: aktif doktorların mevcut haftalık saatleri ve gelecekteki izinleriyle dolu gelir.</li>
            <li>Excel&apos;de yalnızca değiştirmek istediğiniz satırları düzenleyin. Saatler doktorun kendi saat diliminde (varsayılan Türkiye saati).</li>
            <li>&quot;CSV UTF-8 (virgülle ayrılmış)&quot; ya da &quot;CSV (noktalı virgülle ayrılmış)&quot; olarak kaydedip yükleyin.</li>
            <li>Önizlemeyi kontrol edip uygulayın. Gerekirse aşağıdaki listeden geri alın.</li>
          </ol>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm" htmlFor={`${id}-delimiter`}>
              <span className="block font-medium">Ayraç</span>
              <select
                id={`${id}-delimiter`}
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value as "semicolon" | "comma")}
                className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
              >
                <option value="semicolon">Noktalı virgül (;) — Türkçe Excel</option>
                <option value="comma">Virgül (,)</option>
              </select>
            </label>
            <Button type="button" variant="outline" loading={downloading} onClick={() => void downloadTemplate()}>
              <Download className="h-4 w-4" />
              Şablonu indir
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm" htmlFor={`${id}-file`}>
              <span className="block font-medium">Düzenlenmiş dosya (.csv, en fazla 2 MB)</span>
              <Input
                id={`${id}-file`}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setResult(null);
                  setActionError(null);
                }}
              />
            </label>
            <Button type="button" disabled={!file} loading={busy} onClick={() => void previewFile()}>
              <Upload className="h-4 w-4" />
              Yükle ve önizle
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="template" className="mt-4 space-y-4 outline-none">
          <label className="block max-w-md space-y-1 text-sm" htmlFor={`${id}-copy`}>
            <span className="block font-medium">Bir doktorun saatlerini kopyala (isteğe bağlı)</span>
            <select
              id={`${id}-copy`}
              value={copyFrom}
              onChange={(e) => void copyRules(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
            >
              <option value="">— Seçin —</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title} {d.fullName}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <p className="mb-2 text-sm font-medium">Haftalık şablon (doktorun kendi saat diliminde)</p>
              <WeeklyAvailabilityEditor rules={templateRules} onChange={setTemplateRules} />
            </div>
            <BulkDoctorPicker idPrefix="template" doctors={doctors} specialties={specialties} selected={templateDoctorIds} onChange={setTemplateDoctorIds} />
          </div>
          <Button
            type="button"
            loading={busy}
            disabled={templateDoctorIds.length === 0 || templateRules.length === 0}
            onClick={() =>
              void runPreview(() =>
                telehealthApi.previewBulkWeeklyTemplate({
                  doctorIds: templateDoctorIds,
                  rules: templateRules.map(({ dayOfWeek, startMinute, endMinute }) => ({ dayOfWeek, startMinute, endMinute })),
                  weeklyMode: "replace",
                })
              )
            }
          >
            Önizle
          </Button>
        </TabsContent>

        <TabsContent value="time-off" className="mt-4 space-y-4 outline-none">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm" htmlFor={`${id}-kind`}>
                <span className="block font-medium">{tl.kindLabel}</span>
                <select
                  id={`${id}-kind`}
                  value={timeOff.kind}
                  onChange={(e) => setTimeOff((f) => ({ ...f, kind: e.target.value as DoctorTimeOffKind }))}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                >
                  {(Object.keys(tl.kinds) as DoctorTimeOffKind[]).map((k) => (
                    <option key={k} value={k}>
                      {tl.kinds[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 self-end text-sm">
                <input type="checkbox" checked={timeOff.allDay} onChange={(e) => setTimeOff((f) => ({ ...f, allDay: e.target.checked }))} />
                {tl.allDay}
              </label>
              <label className="space-y-1 text-sm" htmlFor={`${id}-from`}>
                <span className="block font-medium">{tl.fromDate}</span>
                <Input
                  id={`${id}-from`}
                  type="date"
                  value={timeOff.startDate}
                  onChange={(e) => setTimeOff((f) => ({ ...f, startDate: e.target.value, endDate: f.endDate || e.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm" htmlFor={`${id}-to`}>
                <span className="block font-medium">{tl.toDate}</span>
                <Input
                  id={`${id}-to`}
                  type="date"
                  min={timeOff.startDate || undefined}
                  value={timeOff.endDate}
                  onChange={(e) => setTimeOff((f) => ({ ...f, endDate: e.target.value }))}
                />
              </label>
              {!timeOff.allDay && (
                <>
                  <label className="space-y-1 text-sm" htmlFor={`${id}-start`}>
                    <span className="block font-medium">{tl.startTime}</span>
                    <Input id={`${id}-start`} type="time" value={timeOff.startTime} onChange={(e) => setTimeOff((f) => ({ ...f, startTime: e.target.value }))} />
                  </label>
                  <label className="space-y-1 text-sm" htmlFor={`${id}-end`}>
                    <span className="block font-medium">{tl.endTime}</span>
                    <Input id={`${id}-end`} type="time" value={timeOff.endTime} onChange={(e) => setTimeOff((f) => ({ ...f, endTime: e.target.value }))} />
                  </label>
                </>
              )}
              <label className="space-y-1 text-sm sm:col-span-2" htmlFor={`${id}-note`}>
                <span className="block font-medium">{tl.note}</span>
                <Textarea id={`${id}-note`} maxLength={500} rows={2} value={timeOff.note} onChange={(e) => setTimeOff((f) => ({ ...f, note: e.target.value }))} />
                <span className="block text-xs text-warning">{tl.noteWarning}</span>
              </label>
              {timeOffRangeInvalid && <p className="text-xs text-danger sm:col-span-2">{tl.invalidRange}</p>}
              <p className="text-xs text-foreground/50 sm:col-span-2">Tarih ve saatler her doktorun kendi saat diliminde uygulanır.</p>
            </div>
            <BulkDoctorPicker idPrefix="time-off" doctors={doctors} specialties={specialties} selected={timeOffDoctorIds} onChange={setTimeOffDoctorIds} />
          </div>
          <Button
            type="button"
            loading={busy}
            disabled={!timeOffReady}
            onClick={() =>
              void runPreview(() =>
                telehealthApi.previewBulkTimeOff({
                  doctorIds: timeOffDoctorIds,
                  startDate: timeOff.startDate,
                  endDate: timeOff.endDate,
                  startTime: timeOff.allDay ? null : timeOff.startTime,
                  endTime: timeOff.allDay ? null : timeOff.endTime,
                  kind: timeOff.kind,
                  note: timeOff.note.trim() || null,
                })
              )
            }
          >
            Önizle
          </Button>
        </TabsContent>
      </Tabs>

      {actionError && (
        <div data-testid="bulk-action-error" role="alert">
          <Alert variant="error">{actionError}</Alert>
        </div>
      )}
      {result && (
        <BulkPreviewView
          key={result.preview?.previewId ?? "errors"}
          result={result}
          busy={busy}
          onModeChange={(mode) => void changeMode(mode)}
          onApply={(ack) => void apply(ack)}
          onDiscard={() => setResult(null)}
        />
      )}

      <BulkOperationsList operations={operations} onUndo={(op) => void undo(op)} undoBlocked={undoBlocked} undoingId={undoingId} />
    </div>
  );
}
