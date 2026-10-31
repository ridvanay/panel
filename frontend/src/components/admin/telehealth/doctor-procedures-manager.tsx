"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Pencil, Plus, Trash2 } from "lucide-react";
import * as showcaseApi from "@/lib/api/doctor-showcase";
import { listAdminCareTopics, type AdminCareTopic } from "@/lib/api/matcher";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ShowcaseLocaleTabs } from "@/components/admin/telehealth/showcase-locale-tabs";

type ProcedureTextKey = keyof showcaseApi.DoctorProcedureText;

const TEXT_FIELDS: { key: ProcedureTextKey; label: string; max: number; multiline?: boolean }[] = [
  { key: "title", label: "Başlık", max: 160 },
  { key: "description", label: "Ne yapılır (açıklama)", max: 2000, multiline: true },
  { key: "duration", label: "Süre", max: 120 },
  { key: "anesthesia", label: "Anestezi", max: 120 },
  { key: "hospitalStay", label: "Hastanede kalış", max: 120 },
  { key: "recovery", label: "İyileşme", max: 300 },
];

const EMPTY_TEXT: showcaseApi.DoctorProcedureText = { title: "", description: "", duration: "", anesthesia: "", hospitalStay: "", recovery: "" };

interface FormState {
  id: string | null;
  translations: Record<string, showcaseApi.DoctorProcedureText>;
  relatedCareTopicIds: string[];
  sortOrder: number;
  isPublished: boolean;
}

const EMPTY_FORM: FormState = { id: null, translations: {}, relatedCareTopicIds: [], sortOrder: 0, isPublished: false };

function hasText(text: showcaseApi.DoctorProcedureText | undefined): boolean {
  return !!text && Object.values(text).some((v) => v.trim());
}

/** Dolu olmayan dilleri atar, metinleri kırpar. Fiyat alanı yoktur. */
export function buildProcedureInput(form: FormState): showcaseApi.DoctorProcedureInput {
  const translations: Record<string, showcaseApi.DoctorProcedureText> = {};
  for (const [code, text] of Object.entries(form.translations)) {
    if (!hasText(text)) continue;
    translations[code] = {
      title: text.title.trim(),
      description: text.description.trim(),
      duration: text.duration.trim(),
      anesthesia: text.anesthesia.trim(),
      hospitalStay: text.hospitalStay.trim(),
      recovery: text.recovery.trim(),
    };
  }
  return { translations, relatedCareTopicIds: form.relatedCareTopicIds, sortOrder: form.sortOrder, isPublished: form.isPublished };
}

function topicLabel(topic: AdminCareTopic): string {
  return topic.translations.tr?.label || topic.translations.en?.label || topic.slug;
}

function procedureTitle(p: showcaseApi.AdminDoctorProcedure): string {
  return p.translations.tr?.title || p.translations.en?.title || Object.values(p.translations).find((t) => t.title)?.title || "(başlıksız)";
}

/** Paket Y — hekim "İşlemler" yöneticisi (liste, ekle/düzenle/sil, dil sekmeleri, yayın, sıra, ilgili konular). Fiyat YOK. */
export function DoctorProceduresManager({ doctorId }: { doctorId: string }) {
  const [items, setItems] = useState<showcaseApi.AdminDoctorProcedure[] | null>(null);
  const [topics, setTopics] = useState<AdminCareTopic[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [locale, setLocale] = useState<string>("tr");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<showcaseApi.AdminDoctorProcedure | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setItems(await showcaseApi.listDoctorProcedures(doctorId));
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, [doctorId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  useEffect(() => {
    (async () => {
      try {
        setTopics(await listAdminCareTopics());
      } catch {
        // Eşleştirme konusu seçimi opsiyonel — yüklenemezse form yine kaydedilebilir.
      }
    })();
  }, []);

  const sortedTopics = useMemo(() => [...topics].sort((a, b) => topicLabel(a).localeCompare(topicLabel(b), "tr")), [topics]);

  function openNew() {
    setForm({ ...EMPTY_FORM, sortOrder: items?.length ?? 0 });
    setLocale("tr");
    setFormError(null);
    setFieldErrors({});
  }

  function openEdit(p: showcaseApi.AdminDoctorProcedure) {
    setForm({ id: p.id, translations: { ...p.translations }, relatedCareTopicIds: [...p.relatedCareTopicIds], sortOrder: p.sortOrder, isPublished: p.isPublished });
    setLocale("tr");
    setFormError(null);
    setFieldErrors({});
  }

  function setText(key: ProcedureTextKey, value: string) {
    setForm((prev) => (prev ? { ...prev, translations: { ...prev.translations, [locale]: { ...(prev.translations[locale] ?? EMPTY_TEXT), [key]: value } } } : prev));
  }

  function toggleTopic(id: string, checked: boolean) {
    setForm((prev) => (prev ? { ...prev, relatedCareTopicIds: checked ? [...prev.relatedCareTopicIds, id] : prev.relatedCareTopicIds.filter((t) => t !== id) } : prev));
  }

  async function save() {
    if (!form) return;
    const input = buildProcedureInput(form);
    setFormError(null);
    setFieldErrors({});
    if (!Object.values(input.translations).some((t) => t.title)) {
      setFormError("En az bir dilde başlık girin.");
      return;
    }
    if (Object.entries(input.translations).some(([, t]) => !t.title)) {
      setFormError("Metin girilen her dilde başlık da gerekli; boş dilleri tamamen boş bırakın.");
      return;
    }
    setSaving(true);
    try {
      if (form.id) await showcaseApi.updateDoctorProcedure(doctorId, form.id, input);
      else await showcaseApi.createDoctorProcedure(doctorId, input);
      toast.success("İşlem kaydedildi.");
      setForm(null);
      await load();
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setFormError(message);
      setFieldErrors(fieldErrorsFrom(err));
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await showcaseApi.deleteDoctorProcedure(doctorId, pendingDelete.id);
      toast.success("İşlem silindi.");
      setPendingDelete(null);
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  const current = form?.translations[locale] ?? EMPTY_TEXT;

  return (
    <Card className="space-y-4" data-testid="doctor-procedures-manager">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="admin-h2">İşlemler</h2>
          <p className="mt-0.5 admin-text-secondary">Profilde “Tedaviler ve işlemler” bölümünde gösterilir. Fiyat bilgisi girilmez.</p>
        </div>
        {!form && (
          <Button type="button" variant="outline" size="sm" onClick={openNew}>
            <Plus className="h-4 w-4" />
            İşlem ekle
          </Button>
        )}
      </div>

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

      {!loadError && items === null && (
        <div className="flex justify-center py-6">
          <Spinner className="h-5 w-5 text-primary" />
        </div>
      )}

      {items && items.length === 0 && !form && <p className="text-sm text-foreground/60">Henüz işlem eklenmedi.</p>}

      {items && items.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{procedureTitle(p)}</p>
                <p className="text-xs text-foreground/60">
                  Sıra {p.sortOrder} · {Object.keys(p.translations).map((c) => c.toUpperCase()).join(", ")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={p.isPublished ? "success" : "neutral"}>{p.isPublished ? "Yayında" : "Taslak"}</Badge>
                <Button type="button" variant="ghost" size="sm" aria-label={`${procedureTitle(p)} işlemini düzenle`} onClick={() => openEdit(p)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" aria-label={`${procedureTitle(p)} işlemini sil`} onClick={() => setPendingDelete(p)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {form && (
        <div className="space-y-4 rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold text-foreground">{form.id ? "İşlemi düzenle" : "Yeni işlem"}</h3>
          {formError && (
            <Alert variant="error">
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {formError}
              </span>
            </Alert>
          )}
          <ShowcaseLocaleTabs value={locale} onChange={setLocale} filled={(c) => hasText(form.translations[c])} label="İşlem metni dili" />
          <div className="space-y-3" role="tabpanel" aria-label={`İşlem metni (${locale.toUpperCase()})`} dir={locale === "ar" ? "rtl" : undefined}>
            {TEXT_FIELDS.map((f) => (
              <Field key={f.key} id={`procedure-${locale}-${f.key}`} label={f.label} error={fieldErrors[`translations.${locale}.${f.key}`]}>
                {(inputProps) =>
                  f.multiline ? (
                    <Textarea {...inputProps} rows={4} maxLength={f.max} value={current[f.key]} onChange={(e) => setText(f.key, e.target.value)} />
                  ) : (
                    <Input {...inputProps} maxLength={f.max} value={current[f.key]} onChange={(e) => setText(f.key, e.target.value)} />
                  )
                }
              </Field>
            ))}
          </div>

          {sortedTopics.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-foreground">İlgili eşleştirme konuları (opsiyonel)</legend>
              <p className="text-xs text-foreground/60">“Find my physician” sonuçlarında bu işlem, seçilen konularla ilişkilendirilir.</p>
              <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2">
                {sortedTopics.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.relatedCareTopicIds.includes(t.id)} onChange={(e) => toggleTopic(t.id, e.target.checked)} />
                    <span>{topicLabel(t)}</span>
                  </label>
                ))}
              </div>
              {fieldErrors.relatedCareTopicIds && <p className="text-xs text-danger">{fieldErrors.relatedCareTopicIds}</p>}
            </fieldset>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="procedure-sort" label="Sıra" hint="Küçük sayı önce gösterilir.">
              {(inputProps) => (
                <Input {...inputProps} type="number" min={0} max={100000} className="w-28" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Math.max(0, Number(e.target.value) || 0) })} />
              )}
            </Field>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
              <span className="text-sm font-medium text-foreground">Yayında</span>
              <Switch checked={form.isPublished} onCheckedChange={(checked: boolean) => setForm({ ...form, isPublished: checked })} aria-label="İşlem yayında" />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setForm(null)}>
              Vazgeç
            </Button>
            <Button type="button" loading={saving} onClick={() => void save()}>
              Kaydet
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="İşlem silinsin mi?"
        description={pendingDelete ? `“${procedureTitle(pendingDelete)}” kalıcı olarak silinir.` : undefined}
        confirmText="Sil"
        tone="danger"
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </Card>
  );
}
