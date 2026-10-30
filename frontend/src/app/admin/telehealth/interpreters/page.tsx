"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Download, Languages, Plus, Save } from "lucide-react";
import * as interpreterApi from "@/lib/api/interpreter";
import type { AdminInterpreter, InterpreterConfidentialityText, InterpreterReportRow } from "@/lib/api/types";
import { PageHeading } from "@/components/admin/page-heading";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";
import { useAuth } from "@/context/auth-context";
import { cn } from "@/lib/utils";

/** Dil kodları virgülle (ör. "ar, en, fa"). */
function parseLanguages(value: string): string[] {
  return [...new Set(value.split(/[,\s]+/).map((v) => v.trim().toLowerCase()).filter(Boolean))];
}

function isoDay(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Paket AA — "Tercümanlar". Hesap oluşturma (davet e-postası, tercüman şifresini kendisi belirler),
 * diller, aktif/pasif, gizlilik taahhüdü ve 2FA durumu; tercüman bazında rapor (CSV) ve taahhüt metni
 * (HUKUK KONTROLÜ GEREKLİ). Yazma yalnızca ADMIN; MANAGER salt okunur. Atama rezervasyon listesinden.
 */
export default function AdminInterpretersPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN";
  const [items, setItems] = useState<AdminInterpreter[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setItems(await interpreterApi.listAdminInterpreters());
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeading
        icon={Languages}
        title="Tercümanlar"
        description="Görüşmelere görüntü ve sesle katılan tercümanlar. Atama rezervasyon listesinden yapılır. Tercümanlar 2FA kurmadan ve gizlilik taahhüdünü onaylamadan görüşmeye katılamaz."
      />
      {loadError && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {loadError}
          </span>
        </Alert>
      )}
      {canEdit && <CreateInterpreterCard onCreated={() => void load()} />}
      {items === null && !loadError ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : (
        <Card className="space-y-3">
          <h2 className="admin-h2">Tercüman hesapları</h2>
          {items && items.length === 0 && <p className="admin-text-secondary">Henüz tercüman yok.</p>}
          <ul className="divide-y divide-border">
            {items?.map((it) => (
              <InterpreterRow key={it.id} item={it} canEdit={canEdit} onUpdated={(next) => setItems((prev) => prev?.map((p) => (p.id === next.id ? next : p)) ?? null)} />
            ))}
          </ul>
        </Card>
      )}
      <ReportCard />
      <ConfidentialityTextCard canEdit={canEdit} />
    </div>
  );
}

function CreateInterpreterCard({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", displayName: "", languages: "", timeZone: "Europe/Istanbul", notes: "" });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit() {
    setSaving(true);
    setErrors({});
    try {
      const res = await interpreterApi.createAdminInterpreter({
        name: form.name.trim(),
        email: form.email.trim(),
        ...(form.displayName.trim() ? { displayName: form.displayName.trim() } : {}),
        languages: parseLanguages(form.languages),
        timeZone: form.timeZone.trim() || "Europe/Istanbul",
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      });
      toast.success(res.emailStatus === "sent" ? "Tercüman oluşturuldu, davet e-postası gönderildi." : "Tercüman oluşturuldu; davet e-postası gönderilemedi (yeniden gönderebilirsiniz).");
      setForm({ name: "", email: "", displayName: "", languages: "", timeZone: "Europe/Istanbul", notes: "" });
      setOpen(false);
      onCreated();
    } catch (err) {
      setErrors(fieldErrorsFrom(err));
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button type="button" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Yeni tercüman
        </Button>
      </div>
    );
  }
  return (
    <Card className="space-y-4" data-testid="interpreter-create">
      <h2 className="admin-h2">Yeni tercüman</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ad soyad" error={errors.name}>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="E-posta" error={errors.email}>
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Görünen ad (boşsa baş harfli: A. Yılmaz)" error={errors.displayName}>
          <Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        </Field>
        <Field label="Diller (kod, virgülle: ar, en, fa)" error={errors.languages}>
          <Input value={form.languages} onChange={(e) => setForm({ ...form, languages: e.target.value })} />
        </Field>
        <Field label="Saat dilimi" error={errors.timeZone}>
          <Input value={form.timeZone} onChange={(e) => setForm({ ...form, timeZone: e.target.value })} />
        </Field>
        <Field label="Not (yalnızca admin görür)" error={errors.notes}>
          <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
          Vazgeç
        </Button>
        <Button type="button" loading={saving} disabled={!form.name.trim() || !form.email.trim() || parseLanguages(form.languages).length === 0} onClick={() => void submit()}>
          Oluştur ve davet gönder
        </Button>
      </div>
    </Card>
  );
}

function InterpreterRow({ item, canEdit, onUpdated }: { item: AdminInterpreter; canEdit: boolean; onUpdated: (next: AdminInterpreter) => void }) {
  const [editing, setEditing] = useState(false);
  const [languages, setLanguages] = useState(item.languages.join(", "));
  const [displayName, setDisplayName] = useState(item.displayName);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [busy, setBusy] = useState(false);

  async function patch(input: Parameters<typeof interpreterApi.updateAdminInterpreter>[1]) {
    setBusy(true);
    try {
      onUpdated(await interpreterApi.updateAdminInterpreter(item.id, input));
      toast.success("Kaydedildi.");
      setEditing(false);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li data-testid="interpreter-row" className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">
            {item.displayName} <span className="text-xs font-normal text-foreground/60">({item.name} · {item.email})</span>
          </p>
          <p className="text-xs text-foreground/60">
            Diller: {item.languages.join(", ")} · Saat dilimi: {item.timeZone} · Aktif atama: {item.activeAssignments}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge tone={item.isActive ? "success" : "neutral"} size="sm">{item.isActive ? "Aktif" : "Pasif"}</Badge>
            <Badge tone={item.twoFactorEnabled ? "success" : "warning"} size="sm">{item.twoFactorEnabled ? "2FA açık" : "2FA kurulmadı"}</Badge>
            <Badge tone={item.confidentialityCurrent ? "success" : "warning"} size="sm">
              {item.confidentialityCurrent ? "Taahhüt onaylı" : item.confidentialityAcceptedAt ? "Taahhüt metni güncellendi — yeniden onay bekleniyor" : "Taahhüt onayı yok"}
            </Badge>
            {!item.hasLoggedIn && <Badge tone="neutral" size="sm">Hesabı etkinleştirmedi</Badge>}
          </div>
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={item.isActive} disabled={busy} onCheckedChange={(v: boolean) => void patch({ isActive: v })} aria-label="Aktif" />
              Aktif
            </label>
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing((v) => !v)}>
              Düzenle
            </Button>
            {!item.hasLoggedIn && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    const r = await interpreterApi.resendInterpreterInvite(item.id);
                    toast[r.emailStatus === "sent" ? "success" : "error"](r.emailStatus === "sent" ? "Davet yeniden gönderildi." : "Davet gönderilemedi.");
                  } catch (err) {
                    toast.error(friendlyErrorMessage(err));
                  }
                }}
              >
                Daveti yeniden gönder
              </Button>
            )}
          </div>
        )}
      </div>
      {editing && (
        <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-3">
          <Input aria-label="Görünen ad" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <Input aria-label="Diller" value={languages} onChange={(e) => setLanguages(e.target.value)} />
          <Input aria-label="Not" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Not (yalnızca admin)" />
          <div className="sm:col-span-3 flex justify-end">
            <Button type="button" size="sm" loading={busy} onClick={() => void patch({ displayName: displayName.trim(), languages: parseLanguages(languages), notes: notes.trim() || null })}>
              Kaydet
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function ReportCard() {
  const [from, setFrom] = useState(isoDay(-30));
  const [to, setTo] = useState(isoDay(0));
  const [rows, setRows] = useState<InterpreterReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    try {
      setRows(await interpreterApi.getInterpreterReport(from, to));
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }

  async function download() {
    try {
      const blob = await interpreterApi.downloadInterpreterReportCsv(from, to);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tercuman-raporu-${from}-${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    }
  }

  return (
    <Card className="space-y-3" data-testid="interpreter-report">
      <h2 className="admin-h2">Rapor</h2>
      <p className="admin-text-secondary">Tercüman bazında görüşme sayısı, dil ve toplam süre (katılım/ayrılış kayıtlarından).</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Başlangıç">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Bitiş">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Button type="button" onClick={() => void run()}>
          Göster
        </Button>
        <Button type="button" variant="outline" onClick={() => void download()}>
          <Download className="h-4 w-4" aria-hidden="true" />
          CSV
        </Button>
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      {rows && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-foreground/60">
              <th className="py-1">Tercüman</th>
              <th>Dil</th>
              <th>Görüşme</th>
              <th>Toplam süre (dk)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-2 text-foreground/60">
                  Bu aralıkta kayıt yok.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={`${r.interpreterId}-${r.language}`} className="border-t border-border">
                  <td className="py-1.5">{r.displayName}</td>
                  <td>{r.language}</td>
                  <td>{r.consultations}</td>
                  <td>{Math.round(r.totalSeconds / 60)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function ConfidentialityTextCard({ canEdit }: { canEdit: boolean }) {
  const [text, setText] = useState<InterpreterConfidentialityText | null>(null);
  const [tab, setTab] = useState<"tr" | "en">("tr");
  const [draft, setDraft] = useState({ en: "", tr: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    interpreterApi
      .getInterpreterConfidentialityText()
      .then((t) => {
        setText(t);
        setDraft({ en: t.en, tr: t.tr });
      })
      .catch(() => {});
  }, []);

  if (!text) return null;
  const dirty = draft.en !== text.en || draft.tr !== text.tr;
  return (
    <Card className="space-y-3" data-testid="interpreter-confidentiality">
      <h2 className="admin-h2">Gizlilik taahhüdü metni</h2>
      <Alert variant="warning">Hukuk kontrolü gerekli. Metin değişince tercümanlardan yeniden onay istenir (sürüm: {text.version}).</Alert>
      <div role="tablist" aria-label="Metin dili" className="flex gap-1">
        {(["tr", "en"] as const).map((code) => (
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
      <Textarea role="tabpanel" rows={12} value={draft[tab]} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, [tab]: e.target.value })} />
      {canEdit && (
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={!dirty}
            loading={saving}
            onClick={async () => {
              setSaving(true);
              try {
                const next = await interpreterApi.updateInterpreterConfidentialityText(draft);
                setText(next);
                setDraft({ en: next.en, tr: next.tr });
                toast.success("Taahhüt metni kaydedildi.");
              } catch (err) {
                toast.error(friendlyErrorMessage(err));
              } finally {
                setSaving(false);
              }
            }}
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            Kaydet
          </Button>
        </div>
      )}
    </Card>
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
