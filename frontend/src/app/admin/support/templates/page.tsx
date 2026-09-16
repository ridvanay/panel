"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { AlertCircle, ChevronLeft, FileText, MoreVertical, Plus } from "lucide-react";
import * as supportApi from "@/lib/api/support";
import type { SupportReplyTemplate } from "@/lib/api/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PageHeading } from "@/components/admin/page-heading";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

/**
 * `.claude/design-notes-support-desk.md` §2.7 — `notifications/templates/page.tsx` deseninin
 * BİREBİR aynısı (masaüstü `Table` + mobil kart, `Dialog` tabanlı form, `ConfirmDialog
 * tone="danger"` ile silme). Şablonlar bir blok editörü GEREKTİRMEZ (düz metin, ≤2000 karakter)
 * — bu yüzden `email-templates` gibi AYRI bir detay sayfası yerine TEK bir `Dialog` hem
 * oluşturma hem düzenleme için kullanılır.
 */
function relativeDate(iso: string): { relative: string; absolute: string } {
  const date = new Date(iso);
  return {
    relative: formatDistanceToNow(date, { addSuffix: true, locale: tr }),
    absolute: date.toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" }),
  };
}

function TemplateFormDialog({
  open,
  onOpenChange,
  template,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = yeni şablon oluşturma modu. */
  template: SupportReplyTemplate | null;
  onSaved: (template: SupportReplyTemplate) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- `locale-manager.tsx` İLE AYNI desen: dialog her açılışta formu sıfırlar
    setTitle(template?.title ?? "");
    setBody(template?.body ?? "");
    setIsActive(template?.isActive ?? true);
    setError(null);
  }, [open, template]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const saved = template
        ? await supportApi.updateSupportTemplate(template.id, { title, body, isActive })
        : await supportApi.createSupportTemplate({ title, body, isActive });
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{template ? "Şablonu Düzenle" : "Yeni Şablon"}</DialogTitle>
          <DialogDescription>Hazır yanıt şablonu — temsilciler sohbet yanıtlarında bunu seçip düzenleyebilir.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field id="support-template-title" label="Başlık" required>
            {(inputProps) => (
              <Input {...inputProps} required value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="ör. Randevu Değişikliği" />
            )}
          </Field>
          <Field id="support-template-body" label="Metin" required hint={`${body.length}/2000`}>
            {(inputProps) => (
              <Textarea
                {...inputProps}
                required
                rows={5}
                maxLength={2000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Düz metin — HTML/Markdown desteklenmez."
              />
            )}
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <span className="text-sm text-foreground">Aktif</span>
            <Switch checked={isActive} onCheckedChange={setIsActive} aria-label="Şablon aktif mi" />
          </div>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button type="button" loading={saving} disabled={!title.trim() || !body.trim()} onClick={handleSave}>
            {template ? "Kaydet" : "Oluştur"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SupportTemplatesPage() {
  const [templates, setTemplates] = useState<SupportReplyTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<SupportReplyTemplate | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<SupportReplyTemplate | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const items = await supportApi.listSupportTemplates(true);
      setTemplates(items);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  function handleSaved(saved: SupportReplyTemplate) {
    setTemplates((prev) => {
      if (!prev) return [saved];
      const exists = prev.some((t) => t.id === saved.id);
      const next = exists ? prev.map((t) => (t.id === saved.id ? saved : t)) : [...prev, saved];
      return next.sort((a, b) => a.sortOrder - b.sortOrder || a.seq - b.seq);
    });
    toast.success(formTarget ? "Şablon güncellendi." : "Şablon oluşturuldu.");
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await supportApi.deleteSupportTemplate(deleteTarget.id);
      toast.success("Şablon silindi.");
      setDeleteTarget(null);
      setTemplates((prev) => prev?.filter((t) => t.id !== deleteTarget.id) ?? null);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/support" className="inline-flex items-center gap-1 text-sm text-foreground/60 transition-colors hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
          Canlı Destek
        </Link>
      </div>

      <PageHeading
        icon={FileText}
        title="Hazır Yanıt Şablonları"
        description="Temsilcilerin sohbet yanıtlarında kullanabileceği hazır metinler."
        actions={
          <Button type="button" size="sm" onClick={() => setFormTarget(null)}>
            <Plus className="h-4 w-4" />
            Yeni Şablon
          </Button>
        }
      />

      {loadError && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {loadError}
          </span>
        </Alert>
      )}

      {!loadError && templates === null && (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      )}

      {!loadError && templates !== null && templates.length === 0 && (
        <EmptyState icon={FileText} title="Henüz şablon yok" description='Sağ üstteki "Yeni Şablon" ile başlayın.' />
      )}

      {!loadError && templates !== null && templates.length > 0 && (
        <>
          {/* Masaüstü (≥768px) */}
          <div className="hidden overflow-hidden rounded-xl border border-border bg-card shadow-sm md:block">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead className="w-auto">Başlık</TableHead>
                  <TableHead className="w-24">Durum</TableHead>
                  <TableHead className="w-32">Kullanım</TableHead>
                  <TableHead className="w-40">Son Düzenleme</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((template) => {
                  const date = relativeDate(template.updatedAt);
                  const busy = busyId === template.id;
                  return (
                    <TableRow key={template.id} className="even:bg-muted hover:bg-primary/8 dark:hover:bg-primary/10">
                      <TableCell className="w-auto">
                        <button type="button" onClick={() => setFormTarget(template)} className="admin-link text-left">
                          {template.title}
                        </button>
                      </TableCell>
                      <TableCell className="w-24">
                        <Badge tone={template.isActive ? "success" : "neutral"} solid size="lg">
                          {template.isActive ? "Aktif" : "Pasif"}
                        </Badge>
                      </TableCell>
                      <TableCell className="w-32">{template.usageCount}</TableCell>
                      <TableCell className="w-40" title={date.absolute}>
                        {date.relative}
                      </TableCell>
                      <TableCell className="w-10 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`${template.title} için işlemler`} />}>
                            <MoreVertical className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setFormTarget(template)}>Düzenle</DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" disabled={busy} onClick={() => setDeleteTarget(template)}>
                              Sil
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobil (<768px) */}
          <div className="space-y-3 md:hidden">
            {templates.map((template) => {
              const date = relativeDate(template.updatedAt);
              const busy = busyId === template.id;
              return (
                <div key={template.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" onClick={() => setFormTarget(template)} className="text-left text-[15px] font-semibold text-primary">
                      {template.title}
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" aria-label={`${template.title} için işlemler`} />}>
                        <MoreVertical className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setFormTarget(template)}>Düzenle</DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" disabled={busy} onClick={() => setDeleteTarget(template)}>
                          Sil
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge tone={template.isActive ? "success" : "neutral"} solid size="lg">
                      {template.isActive ? "Aktif" : "Pasif"}
                    </Badge>
                    <span className="text-xs text-foreground/60">Kullanım: {template.usageCount}</span>
                    <span className="text-xs text-foreground/60" title={date.absolute}>
                      {date.relative}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <TemplateFormDialog open={formTarget !== undefined} onOpenChange={(open) => !open && setFormTarget(undefined)} template={formTarget ?? null} onSaved={handleSaved} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        tone="danger"
        title="Şablonu sil"
        description={deleteTarget ? `"${deleteTarget.title}" şablonunu silmek istediğinize emin misiniz? Bu işlem geri alınamaz.` : undefined}
        confirmText="Sil"
        loading={busyId === deleteTarget?.id}
        onConfirm={handleDelete}
      />
    </div>
  );
}
