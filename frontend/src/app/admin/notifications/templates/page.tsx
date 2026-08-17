"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { AlertCircle, Lock, Mail, MoreVertical, Plus } from "lucide-react";
import * as emailTemplatesApi from "@/lib/api/email-templates";
import type { EmailTemplatePurpose, EmailTemplateSummary } from "@/lib/api/types";
import { EMAIL_PURPOSE_LABEL, EMAIL_PURPOSES } from "@/lib/email-blocks/purpose-labels";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PageHeading } from "@/components/admin/page-heading";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

function relativeDate(iso: string): { relative: string; absolute: string } {
  const date = new Date(iso);
  return {
    relative: formatDistanceToNow(date, { addSuffix: true, locale: tr }),
    absolute: date.toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" }),
  };
}

function NewTemplateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState<EmailTemplatePurpose>("CUSTOM");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const created = await emailTemplatesApi.createTemplate({ name, purpose });
      onOpenChange(false);
      router.push(`/admin/notifications/templates/${created.id}`);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Yeni Şablon</DialogTitle>
          <DialogDescription>Şablonun amacını ve adını belirleyin — blok editörüne yönlendirileceksiniz.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field id="new-template-purpose" label="Kullanıldığı yer">
            {(inputProps) => (
              <Select {...inputProps} value={purpose} onChange={(e) => setPurpose(e.target.value as EmailTemplatePurpose)}>
                {EMAIL_PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {EMAIL_PURPOSE_LABEL[p]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="new-template-name" label="Ad" required>
            {(inputProps) => <Input {...inputProps} required value={name} onChange={(e) => setName(e.target.value)} placeholder="ör. Sipariş Onayı — Kampanya" />}
          </Field>
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
          <Button type="button" loading={creating} disabled={!name.trim()} onClick={handleCreate}>
            Oluştur
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function EmailTemplatesListPage() {
  const [templates, setTemplates] = useState<EmailTemplateSummary[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EmailTemplateSummary | null>(null);

  const load = useCallback(async () => {
    try {
      const items = await emailTemplatesApi.listTemplates();
      setTemplates(items);
      setLoaded(true);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function handleDuplicate(template: EmailTemplateSummary) {
    setBusyId(template.id);
    try {
      await emailTemplatesApi.duplicateTemplate(template.id);
      toast.success("Şablon kopyalandı.");
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleActivate(template: EmailTemplateSummary) {
    setBusyId(template.id);
    try {
      await emailTemplatesApi.activateTemplate(template.id);
      toast.success("Şablon aktif edildi.");
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await emailTemplatesApi.deleteTemplate(deleteTarget.id);
      toast.success("Şablon silindi.");
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeading
        icon={Mail}
        title="Bildirimler"
        description="Sistem tarafından gönderilen e-posta şablonlarını yönetin."
        actions={
          <Button type="button" size="sm" onClick={() => setNewDialogOpen(true)}>
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

      {!loadError && !loaded && (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      )}

      {!loadError && loaded && templates && templates.length === 0 && (
        <EmptyState icon={Mail} title="Henüz e-posta şablonu yok" description='Sağ üstteki "Yeni Şablon" ile başlayın.' />
      )}

      {!loadError && loaded && templates && templates.length > 0 && (
        <>
          {/* Masaüstü (≥768px) */}
          <div className="hidden overflow-hidden rounded-xl border border-border bg-card shadow-sm md:block">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead className="w-auto">Ad</TableHead>
                  <TableHead className="w-48">Kullanıldığı Yer</TableHead>
                  <TableHead className="w-24">Durum</TableHead>
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
                        <Link href={`/admin/notifications/templates/${template.id}`} className="admin-link inline-flex items-center gap-1.5">
                          {template.name}
                          {template.isSystem && <Lock className="h-3.5 w-3.5 text-foreground/40" aria-label="Sistem şablonu — silinemez" />}
                        </Link>
                      </TableCell>
                      <TableCell className="w-48">
                        <Badge tone="neutral" size="sm">
                          {EMAIL_PURPOSE_LABEL[template.purpose]}
                        </Badge>
                      </TableCell>
                      <TableCell className="w-24">
                        <Badge tone={template.isActive ? "success" : "neutral"} solid size="lg">
                          {template.isActive ? "Aktif" : "Pasif"}
                        </Badge>
                      </TableCell>
                      <TableCell className="w-40" title={date.absolute}>
                        {date.relative}
                      </TableCell>
                      <TableCell className="w-10 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`${template.name} için işlemler`} />}>
                            <MoreVertical className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem render={<Link href={`/admin/notifications/templates/${template.id}`} />}>Düzenle</DropdownMenuItem>
                            <DropdownMenuItem disabled={busy} onClick={() => handleDuplicate(template)}>
                              Kopyala
                            </DropdownMenuItem>
                            {!template.isActive && (
                              <DropdownMenuItem disabled={busy} onClick={() => handleActivate(template)}>
                                Aktifleştir
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={busy || template.isSystem || template.isActive}
                              title={
                                template.isSystem
                                  ? "Sistem şablonu silinemez"
                                  : template.isActive
                                    ? "Önce başka bir şablonu aktifleştirin"
                                    : undefined
                              }
                              onClick={() => setDeleteTarget(template)}
                            >
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
                    <Link href={`/admin/notifications/templates/${template.id}`} className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-primary">
                      {template.name}
                      {template.isSystem && <Lock className="h-3.5 w-3.5 text-foreground/40" aria-label="Sistem şablonu — silinemez" />}
                    </Link>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" aria-label={`${template.name} için işlemler`} />}>
                        <MoreVertical className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem render={<Link href={`/admin/notifications/templates/${template.id}`} />}>Düzenle</DropdownMenuItem>
                        <DropdownMenuItem disabled={busy} onClick={() => handleDuplicate(template)}>
                          Kopyala
                        </DropdownMenuItem>
                        {!template.isActive && (
                          <DropdownMenuItem disabled={busy} onClick={() => handleActivate(template)}>
                            Aktifleştir
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem variant="destructive" disabled={busy || template.isSystem || template.isActive} onClick={() => setDeleteTarget(template)}>
                          Sil
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral" size="sm">
                      {EMAIL_PURPOSE_LABEL[template.purpose]}
                    </Badge>
                    <Badge tone={template.isActive ? "success" : "neutral"} solid size="lg">
                      {template.isActive ? "Aktif" : "Pasif"}
                    </Badge>
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

      <NewTemplateDialog open={newDialogOpen} onOpenChange={setNewDialogOpen} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        tone="danger"
        title="Şablonu sil"
        description={deleteTarget ? `"${deleteTarget.name}" şablonunu silmek istediğinize emin misiniz? Bu işlem geri alınamaz.` : undefined}
        confirmText="Sil"
        loading={busyId === deleteTarget?.id}
        onConfirm={handleDelete}
      />
    </div>
  );
}
