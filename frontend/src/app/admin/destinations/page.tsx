"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, MapPin, Pencil } from "lucide-react";
import * as packagesApi from "@/lib/api/admin-packages";
import type { AdminDestination, DestinationInput } from "@/lib/api/admin-packages";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeading } from "@/components/admin/page-heading";
import { useTranslationLocales } from "@/components/admin/translation-locale-tabs";
import { DestinationForm } from "@/components/admin/destinations/destination-form";

/** Paket X — "Top destinations" CRUD. */
function destinationTitle(d: AdminDestination): string {
  return d.translations?.en?.title || d.city;
}

export default function AdminDestinationsPage() {
  const [items, setItems] = useState<AdminDestination[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminDestination | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<AdminDestination | null>(null);
  const [deleting, setDeleting] = useState(false);
  const locales = useTranslationLocales();

  const load = useCallback(async () => {
    try {
      setItems(await packagesApi.listAdminDestinations());
      setError(null);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  function openForm(d: AdminDestination | null) {
    setEditing(d);
    setServerErrors({});
    setFormOpen(true);
  }
  function closeForm() {
    setFormOpen(false);
    setEditing(null);
  }

  async function handleSubmit(body: DestinationInput) {
    setSaving(true);
    setServerErrors({});
    try {
      if (editing) {
        await packagesApi.updateAdminDestination(editing.id, body);
        toast.success("Destinasyon güncellendi.");
      } else {
        await packagesApi.createAdminDestination(body);
        toast.success("Destinasyon eklendi.");
      }
      closeForm();
      await load();
    } catch (err) {
      setServerErrors(fieldErrorsFrom(err));
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await packagesApi.deleteAdminDestination(pendingDelete.id);
      toast.success("Destinasyon silindi.");
      setPendingDelete(null);
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  const sorted = items ? [...items].sort((a, b) => a.sortOrder - b.sortOrder) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeading
        icon={MapPin}
        title="Destinasyonlar"
        description="Sitedeki “Top destinations” bölümünü yönetin. Hiç aktif kayıt yoksa bölüm sitede görünmez."
        actions={
          <Button type="button" onClick={() => openForm(null)}>
            Yeni destinasyon
          </Button>
        }
      />

      {error && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      {sorted === null ? (
        !error && (
          <div className="flex justify-center py-8">
            <Spinner className="h-6 w-6 text-primary" />
          </div>
        )
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="Henüz destinasyon yok"
          description="İlk destinasyonunuzu ekleyerek başlayın."
          action={
            <Button type="button" onClick={() => openForm(null)}>
              Yeni destinasyon
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Destinasyon</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead className="text-right">Tedavi</TableHead>
              <TableHead className="text-right">Sıra</TableHead>
              <TableHead className="text-right">İşlemler</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  <span className="font-medium text-foreground">{d.city}</span>
                  <p className="text-xs text-foreground/50" dir="ltr">
                    /{d.slug}
                  </p>
                </TableCell>
                <TableCell>{d.isActive ? <Badge tone="success">Aktif</Badge> : <Badge tone="warning">Taslak</Badge>}</TableCell>
                <TableCell className="text-right">{d.topTreatments?.length ?? 0}</TableCell>
                <TableCell className="text-right">{d.sortOrder}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" aria-label={`"${destinationTitle(d)}" destinasyonunu düzenle`} onClick={() => openForm(d)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" aria-label={`"${destinationTitle(d)}" destinasyonunu sil`} onClick={() => setPendingDelete(d)}>
                      Sil
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {formOpen && (
        <DestinationForm
          key={editing?.id ?? "new"}
          destination={editing}
          locales={locales}
          saving={saving}
          serverErrors={serverErrors}
          onSubmit={(body) => void handleSubmit(body)}
          onCancel={closeForm}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Destinasyonu sil"
        description={pendingDelete ? `"${destinationTitle(pendingDelete)}" destinasyonunu silmek istediğinize emin misiniz?` : undefined}
        confirmText="Sil"
        tone="danger"
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
