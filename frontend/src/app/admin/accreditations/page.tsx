"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, AlertTriangle, BadgeCheck, ImageIcon, Pencil, Plus, Trash2 } from "lucide-react";
import * as accreditationsApi from "@/lib/api/accreditations";
import type { AccreditationInput, AdminAccreditation, Media } from "@/lib/api/types";
import { PageHeading } from "@/components/admin/page-heading";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MediaPicker } from "@/components/admin/media/media-picker";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";
import { useAuth } from "@/context/auth-context";
import { cn } from "@/lib/utils";

/** Ad/açıklama çeviri sekmeleri — kanonik ad EN (`name`); EN açıklama da `translations.en`'de tutulur. */
const TRANSLATION_LOCALES = ["en", "tr", "de", "es", "fr", "ar", "ru", "ro", "sr-latn"] as const;

interface FormState {
  name: string;
  issuer: string;
  logoMediaId: string | null;
  logoUrl: string | null;
  certificateNo: string;
  verificationUrl: string;
  validUntil: string;
  sortOrder: number;
  isActive: boolean;
  translations: Record<string, { name: string; description: string }>;
}

function emptyForm(): FormState {
  return { name: "", issuer: "", logoMediaId: null, logoUrl: null, certificateNo: "", verificationUrl: "", validUntil: "", sortOrder: 0, isActive: false, translations: {} };
}

function toForm(b: AdminAccreditation): FormState {
  const translations: FormState["translations"] = {};
  for (const [locale, t] of Object.entries(b.translations)) translations[locale] = { name: t.name ?? "", description: t.description ?? "" };
  return {
    name: b.name,
    issuer: b.issuer,
    logoMediaId: b.logoMediaId,
    logoUrl: b.logoUrl,
    certificateNo: b.certificateNo ?? "",
    verificationUrl: b.verificationUrl ?? "",
    validUntil: b.validUntil ?? "",
    sortOrder: b.sortOrder,
    isActive: b.isActive,
    translations,
  };
}

function toInput(form: FormState): AccreditationInput {
  const translations: NonNullable<AccreditationInput["translations"]> = {};
  for (const [locale, t] of Object.entries(form.translations)) {
    translations[locale] = { name: t.name.trim() || null, description: t.description.trim() || null };
  }
  return {
    name: form.name.trim(),
    issuer: form.issuer.trim(),
    logoMediaId: form.logoMediaId,
    certificateNo: form.certificateNo.trim() || null,
    verificationUrl: form.verificationUrl.trim() || null,
    validUntil: form.validUntil || null,
    sortOrder: form.sortOrder,
    isActive: form.isActive,
    translations,
  };
}

/**
 * Paket V (İş 4) — "Yetki Belgeleri ve Akreditasyonlar". Logo dosyaları resmi kaynaktan alınıp medya
 * kütüphanesine yönetici tarafından yüklenir (repoda logo yoktur). Belge numarası olmayan kayıt aktif
 * edilemez; süresi geçen belge sitede otomatik gizlenir ve burada uyarı gösterilir. Yazma yalnızca ADMIN.
 */
export default function AdminAccreditationsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN";
  const [items, setItems] = useState<AdminAccreditation[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [tab, setTab] = useState<string>("en");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<AdminAccreditation | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setItems(await accreditationsApi.listAdminAccreditations());
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  function startEdit(target: AdminAccreditation | "new") {
    setEditingId(target === "new" ? "new" : target.id);
    setForm(target === "new" ? emptyForm() : toForm(target));
    setTab("en");
    setSaveError(null);
    setFieldErrors({});
  }

  const activationBlocked = form.isActive && form.certificateNo.trim() === "";

  async function save() {
    if (!editingId) return;
    if (activationBlocked) {
      setFieldErrors({ certificateNo: "Belge numarası olmadan belge aktif edilemez." });
      return;
    }
    setSaving(true);
    setSaveError(null);
    setFieldErrors({});
    try {
      const input = toInput(form);
      if (editingId === "new") await accreditationsApi.createAccreditation(input);
      else await accreditationsApi.updateAccreditation(editingId, input);
      toast.success("Belge kaydedildi.");
      setEditingId(null);
      await load();
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setSaveError(message);
      setFieldErrors(fieldErrorsFrom(err));
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await accreditationsApi.deleteAccreditation(deleteTarget.id);
      toast.success("Belge silindi.");
      if (editingId === deleteTarget.id) setEditingId(null);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  const setTranslation = (field: "name" | "description", value: string) =>
    setForm((prev) => ({ ...prev, translations: { ...prev.translations, [tab]: { ...{ name: "", description: "" }, ...prev.translations[tab], [field]: value } } }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeading
        icon={BadgeCheck}
        title="Yetki Belgeleri ve Akreditasyonlar"
        description="Health Türkiye, TÜRSAB, T.C. Sağlık Bakanlığı gibi resmi belgeler. Anasayfa şeridi, footer logoları ve Hakkımızda listesinde gösterilir."
      />

      <Alert variant="info">
        <span className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          Logoları yalnızca resmi kaynaktan alın ve medya kütüphanesine yükleyin. Belge numarası olmayan ya da süresi geçmiş belge sitede
          gösterilmez.
        </span>
      </Alert>

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

      {items === null && !loadError ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : (
        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="admin-h2">Belgeler</h2>
            {canEdit && (
              <Button type="button" size="sm" onClick={() => startEdit("new")}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Yeni belge
              </Button>
            )}
          </div>
          {items && items.length === 0 && <p className="admin-text-secondary">Henüz belge eklenmedi.</p>}
          <ul className="divide-y divide-border">
            {items?.map((b) => (
              <li key={b.id} data-testid="accreditation-row" className="flex flex-wrap items-center gap-3 py-3">
                <div className="flex h-10 w-16 items-center justify-center rounded border border-border bg-surface">
                  {b.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.logoUrl} alt="" className="max-h-9 max-w-14 object-contain" />
                  ) : (
                    <ImageIcon className="h-4 w-4 text-foreground/40" aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{b.name}</p>
                  <p className="text-xs text-foreground/60">
                    {b.issuer} · Belge no: {b.certificateNo ?? "—"}
                    {b.validUntil ? ` · Geçerlilik: ${b.validUntil}` : ""}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                    <span className={cn("rounded-full px-2 py-0.5", b.publiclyVisible ? "bg-success/15 text-success" : "bg-surface-muted text-foreground/60")}>
                      {b.publiclyVisible ? "Sitede görünüyor" : "Sitede gizli"}
                    </span>
                    {b.expired && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-warning" data-testid="accreditation-expired">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        Süresi geçmiş — yenileyin
                      </span>
                    )}
                    {!b.certificateNo && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-foreground/60">Belge numarası yok</span>}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => startEdit(b)} aria-label={`${b.name} düzenle`}>
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setDeleteTarget(b)} aria-label={`${b.name} sil`}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editingId && canEdit && (
        <Card className="space-y-4" data-testid="accreditation-form">
          <h2 className="admin-h2">{editingId === "new" ? "Yeni belge" : "Belgeyi düzenle"}</h2>
          {saveError && (
            <Alert variant="error">
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {saveError}
              </span>
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ad (EN, kanonik)" error={fieldErrors.name}>
              <Input value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Veren kurum" error={fieldErrors.issuer}>
              <Input value={form.issuer} maxLength={160} onChange={(e) => setForm({ ...form, issuer: e.target.value })} />
            </Field>
            <Field label="Belge numarası" error={fieldErrors.certificateNo}>
              <Input value={form.certificateNo} maxLength={80} onChange={(e) => setForm({ ...form, certificateNo: e.target.value })} />
            </Field>
            <Field label="Doğrulama adresi (https://)" error={fieldErrors.verificationUrl}>
              <Input type="url" value={form.verificationUrl} placeholder="https://" onChange={(e) => setForm({ ...form, verificationUrl: e.target.value })} />
            </Field>
            <Field label="Geçerlilik sonu (opsiyonel)" error={fieldErrors.validUntil}>
              <Input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
            </Field>
            <Field label="Sıra" error={fieldErrors.sortOrder}>
              <Input type="number" min={0} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) || 0 })} />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-12 w-20 items-center justify-center rounded border border-border bg-surface">
              {form.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.logoUrl} alt="" className="max-h-11 max-w-[4.5rem] object-contain" />
              ) : (
                <ImageIcon className="h-5 w-5 text-foreground/40" aria-hidden="true" />
              )}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
              Logo seç (PNG, JPG, WebP)
            </Button>
            {form.logoMediaId && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ ...form, logoMediaId: null, logoUrl: null })}>
                Logoyu kaldır
              </Button>
            )}
            {fieldErrors.logoMediaId && <p className="text-xs text-danger">{fieldErrors.logoMediaId}</p>}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Ad ve açıklama çevirileri</p>
            <div role="tablist" aria-label="Çeviri dili" className="flex flex-wrap gap-1">
              {TRANSLATION_LOCALES.map((code) => (
                <button
                  key={code}
                  type="button"
                  role="tab"
                  aria-selected={tab === code}
                  onClick={() => setTab(code)}
                  className={cn("rounded-md px-2.5 py-1 text-xs font-medium", tab === code ? "bg-primary text-primary-foreground" : "bg-surface-muted text-foreground/70")}
                >
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
            <div role="tabpanel" className="grid gap-3">
              {tab !== "en" && (
                <Input
                  aria-label={`Ad (${tab.toUpperCase()})`}
                  placeholder={`Ad (${tab.toUpperCase()}) — boşsa EN ad`}
                  maxLength={120}
                  value={form.translations[tab]?.name ?? ""}
                  onChange={(e) => setTranslation("name", e.target.value)}
                />
              )}
              <Textarea
                aria-label={`Açıklama (${tab.toUpperCase()})`}
                placeholder={`Kısa açıklama (${tab.toUpperCase()}, opsiyonel)`}
                maxLength={300}
                rows={2}
                value={form.translations[tab]?.description ?? ""}
                onChange={(e) => setTranslation("description", e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
            <span className="text-sm">
              <span className="font-medium text-foreground">Sitede göster (aktif)</span>
              <span className="block text-xs text-foreground/60">Belge numarası zorunludur.</span>
            </span>
            <Switch checked={form.isActive} onCheckedChange={(checked: boolean) => setForm({ ...form, isActive: checked })} aria-label="Sitede göster" />
          </label>
          {activationBlocked && <p className="text-xs text-danger">Belge numarası olmadan belge aktif edilemez.</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditingId(null)}>
              Vazgeç
            </Button>
            <Button type="button" loading={saving} disabled={activationBlocked || !form.name.trim() || !form.issuer.trim()} onClick={() => void save()}>
              Kaydet
            </Button>
          </div>

          <MediaPicker
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            onSelect={(media: Media) => {
              setForm((prev) => ({ ...prev, logoMediaId: media.id, logoUrl: media.url }));
              setPickerOpen(false);
            }}
          />
        </Card>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Belge silinsin mi?"
        description={deleteTarget ? `"${deleteTarget.name}" kalıcı olarak silinecek. Logo dosyası medya kütüphanesinde kalır.` : undefined}
        confirmText="Sil"
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      {children}
      {error && <span className="block text-xs text-danger">{error}</span>}
    </label>
  );
}
