"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Package, Pencil, Star } from "lucide-react";
import * as packagesApi from "@/lib/api/admin-packages";
import { PACKAGE_CATEGORY_LABELS, type AdminPackage, type PackageInput, type PackageViewStats } from "@/lib/api/admin-packages";
import * as telehealthApi from "@/lib/api/telehealth";
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
import { PackageForm } from "@/components/admin/packages/package-form";
import type { OrderedOption } from "@/components/admin/packages/ordered-multi-select";

/** Paket X — sağlık paketleri CRUD. Seed ile gelen taslaklar `isActive=false` olup "Taslak" rozetiyle listelenir. */
function packageTitle(p: AdminPackage): string {
  const t = p.translations ?? {};
  return t.en?.title || Object.values(t).find((x) => x.title)?.title || p.slug;
}

export default function AdminPackagesPage() {
  const [packages, setPackages] = useState<AdminPackage[] | null>(null);
  const [views, setViews] = useState<PackageViewStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPackage | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<AdminPackage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [specialtyOptions, setSpecialtyOptions] = useState<OrderedOption[]>([]);
  const [doctorOptions, setDoctorOptions] = useState<OrderedOption[]>([]);
  const locales = useTranslationLocales();

  const load = useCallback(async () => {
    try {
      setPackages(await packagesApi.listAdminPackages());
      setError(null);
      // Sayaç yüklenemezse liste yine görünür (sütun "—").
      packagesApi.getPackageViewStats().then(setViews).catch(() => setViews(null));
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
    // Seçenek listeleri başarısız olursa form yine açılır (yalnızca çoklu seçim boş kalır).
    telehealthApi
      .listAdminSpecialties()
      .then((rows) => setSpecialtyOptions(rows.map((s) => ({ id: s.id, label: s.name }))))
      .catch(() => setSpecialtyOptions([]));
    telehealthApi
      .listAdminDoctors()
      .then((page) => setDoctorOptions(page.items.map((d) => ({ id: d.id, label: d.displayName || d.fullName }))))
      .catch(() => setDoctorOptions([]));
  }, [load]);

  function openForm(pkg: AdminPackage | null) {
    setEditing(pkg);
    setServerErrors({});
    setFormOpen(true);
  }
  function closeForm() {
    setFormOpen(false);
    setEditing(null);
  }

  async function handleSubmit(body: PackageInput) {
    setSaving(true);
    setServerErrors({});
    try {
      if (editing) {
        await packagesApi.updateAdminPackage(editing.id, body);
        toast.success("Paket güncellendi.");
      } else {
        await packagesApi.createAdminPackage(body);
        toast.success("Paket eklendi.");
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
      await packagesApi.deleteAdminPackage(pendingDelete.id);
      toast.success("Paket silindi.");
      setPendingDelete(null);
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  const sorted = packages ? [...packages].sort((a, b) => a.sortOrder - b.sortOrder) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeading
        icon={Package}
        title="Sağlık paketleri"
        description="Sitedeki /packages sayfasında yayınlanan sağlık paketlerini yönetin. Taslak paketler sitede görünmez."
        actions={
          <Button type="button" onClick={() => openForm(null)}>
            Yeni paket
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

      {views && (
        <p className="text-sm text-foreground/70" data-testid="package-view-summary">
          Son {views.days} gün (anonim toplam, kişi bazında kayıt yok): paket listesi {views.list.toLocaleString("tr-TR")} görüntülenme · destinasyon bölümü{" "}
          {views.destinations.toLocaleString("tr-TR")} görüntülenme
        </p>
      )}

      {sorted === null ? (
        !error && (
          <div className="flex justify-center py-8">
            <Spinner className="h-6 w-6 text-primary" />
          </div>
        )
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Henüz paket yok"
          description="İlk sağlık paketinizi ekleyerek başlayın."
          action={
            <Button type="button" onClick={() => openForm(null)}>
              Yeni paket
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Paket</TableHead>
              <TableHead>Kategori</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead className="text-right">Görüntülenme ({views?.days ?? 90} gün)</TableHead>
              <TableHead className="text-right">Talep</TableHead>
              <TableHead className="text-right">Sıra</TableHead>
              <TableHead className="text-right">İşlemler</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <span className="font-medium text-foreground">{packageTitle(p)}</span>
                  <p className="text-xs text-foreground/50" dir="ltr">
                    /{p.slug}
                  </p>
                </TableCell>
                <TableCell>{PACKAGE_CATEGORY_LABELS[p.category] ?? p.category}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1">
                    {p.isActive ? <Badge tone="success">Aktif</Badge> : <Badge tone="warning">Taslak</Badge>}
                    {p.isFeatured && (
                      <Badge tone="primary">
                        <Star className="mr-1 h-3 w-3" aria-hidden="true" />
                        Öne çıkan
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-right">{views ? (views.packages[p.slug] ?? 0).toLocaleString("tr-TR") : "—"}</TableCell>
                <TableCell className="text-right">{p.inquiryCount ?? 0}</TableCell>
                <TableCell className="text-right">{p.sortOrder}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" aria-label={`"${packageTitle(p)}" paketini düzenle`} onClick={() => openForm(p)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" aria-label={`"${packageTitle(p)}" paketini sil`} onClick={() => setPendingDelete(p)}>
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
        <PackageForm
          key={editing?.id ?? "new"}
          pkg={editing}
          locales={locales}
          specialtyOptions={specialtyOptions}
          doctorOptions={doctorOptions}
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
        title="Paketi sil"
        description={
          pendingDelete
            ? `"${packageTitle(pendingDelete)}" paketini silmek istediğinize emin misiniz?${pendingDelete.inquiryCount ? ` Bu pakete ${pendingDelete.inquiryCount} talep bağlı.` : ""}`
            : undefined
        }
        confirmText="Sil"
        tone="danger"
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
