"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import * as telehealthApi from "@/lib/api/telehealth";
import type { Specialty } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeading } from "@/components/admin/page-heading";
import { IconPickerField } from "@/components/admin/page-builder/blocks/icon-picker";
import { resolveIcon } from "@/lib/page-builder/icon-options";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { AlertCircle, Pencil, Stethoscope, X } from "lucide-react";

/**
 * `.claude/architect-scope-telehealth-template.md` §5.1/§3.2 — uzmanlık CRUD, `icon-box`
 * bloğuyla AYNI lucide ikon sözlüğünü (`IconPickerField`) kullanır. Basit tek-satır düzenleme
 * yerine Dialog benzeri bir "düzenleme kartı" kullanılır çünkü ürün kategorisinden (yalnızca
 * `name`) FARKLI olarak burada icon/description/order/isActive de var (bkz. `telehealth.schemas.ts`).
 */
const specialtyFormSchema = z.object({
  name: z.string().min(1, "Uzmanlık adı gerekli.").max(80),
  slug: z.string().max(80).optional(),
  icon: z.string().min(1, "Bir ikon seçin."),
  description: z.string().max(500).optional(),
  order: z.coerce.number().int().min(0).optional(),
  isActive: z.boolean(),
});

type SpecialtyFormValues = z.infer<typeof specialtyFormSchema>;

const EMPTY_FORM: SpecialtyFormValues = { name: "", slug: "", icon: "", description: "", order: 0, isActive: true };

export default function AdminTelehealthSpecialtiesPage() {
  const [specialties, setSpecialties] = useState<Specialty[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Specialty | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<SpecialtyFormValues>({ resolver: zodResolver(specialtyFormSchema), defaultValues: EMPTY_FORM });

  const load = useCallback(async () => {
    try {
      setSpecialties(await telehealthApi.listAdminSpecialties());
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

  function openCreateForm() {
    setEditingId(null);
    reset(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEditForm(specialty: Specialty) {
    setEditingId(specialty.id);
    reset({
      name: specialty.name,
      slug: specialty.slug,
      icon: specialty.icon,
      description: specialty.description ?? "",
      order: specialty.order,
      isActive: specialty.isActive,
    });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
  }

  async function onSubmit(values: SpecialtyFormValues) {
    setSaving(true);
    try {
      const body = {
        name: values.name,
        slug: values.slug || undefined,
        icon: values.icon,
        description: values.description || null,
        order: values.order ?? 0,
        isActive: values.isActive,
      };
      if (editingId) {
        await telehealthApi.updateSpecialty(editingId, body);
        toast.success("Uzmanlık güncellendi.");
      } else {
        await telehealthApi.createSpecialty(body);
        toast.success("Uzmanlık eklendi.");
      }
      closeForm();
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeletingId(pendingDelete.id);
    try {
      await telehealthApi.deleteSpecialty(pendingDelete.id);
      toast.success("Uzmanlık silindi.");
      setPendingDelete(null);
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeading
        icon={Stethoscope}
        title="Uzmanlıklar"
        description="Tele-Sağlık modülündeki tıbbi uzmanlık alanlarını yönetin."
        actions={
          <Button type="button" onClick={openCreateForm}>
            Yeni Uzmanlık
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

      {specialties === null ? (
        <div className="flex justify-center py-8">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : specialties.length === 0 ? (
        <EmptyState
          icon={Stethoscope}
          title="Henüz uzmanlık yok"
          description="İlk uzmanlığınızı ekleyerek başlayın."
          action={
            <Button type="button" onClick={openCreateForm}>
              Yeni Uzmanlık
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>Ad</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead className="text-right">İşlemler</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {specialties.map((specialty) => {
              const Icon = resolveIcon(specialty.icon);
              return (
                <TableRow key={specialty.id}>
                  <TableCell>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium text-foreground">{specialty.name}</span>
                    <p className="text-xs text-foreground/50">/{specialty.slug}</p>
                  </TableCell>
                  <TableCell>
                    {specialty.isActive ? (
                      <span className="text-xs font-medium text-success">Aktif</span>
                    ) : (
                      <span className="text-xs font-medium text-foreground/40">Pasif</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`"${specialty.name}" uzmanlığını düzenle`}
                        onClick={() => openEditForm(specialty)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setPendingDelete(specialty)}>
                        Sil
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {formOpen && (
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="admin-h2">{editingId ? "Uzmanlığı düzenle" : "Yeni uzmanlık"}</h2>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Formu kapat" onClick={closeForm}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="sm:col-span-2">
              <Field id="specialty-name" label="Uzmanlık adı" error={errors.name?.message} required>
                {(inputProps) => <Input {...inputProps} {...register("name")} placeholder="Kardiyoloji" />}
              </Field>
            </div>

            <Field id="specialty-slug" label="Slug" hint="Boş bırakılırsa addan üretilir.">
              {(inputProps) => <Input {...inputProps} {...register("slug")} placeholder="kardiyoloji" />}
            </Field>

            <Field id="specialty-order" label="Sıra">
              {(inputProps) => <Input {...inputProps} type="number" min={0} {...register("order")} />}
            </Field>

            <div className="sm:col-span-2">
              <Controller
                control={control}
                name="icon"
                render={({ field }) => (
                  <IconPickerField id="specialty-icon" label="İkon" value={field.value} onChange={(v) => field.onChange(v ?? "")} />
                )}
              />
              {errors.icon && <p className="mt-1 text-xs text-danger">{errors.icon.message}</p>}
            </div>

            <div className="sm:col-span-2">
              <Field id="specialty-description" label="Açıklama" hint="Opsiyonel, en fazla 500 karakter.">
                {(inputProps) => <Textarea {...inputProps} rows={3} {...register("description")} />}
              </Field>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 sm:col-span-2">
              <div>
                <p className="text-sm font-medium text-foreground">Aktif</p>
                <p className="text-xs text-foreground/60">Pasif uzmanlıklar public listede/filtrede görünmez.</p>
              </div>
              <Controller
                control={control}
                name="isActive"
                render={({ field }) => (
                  <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Uzmanlık aktif mi" />
                )}
              />
            </div>

            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="outline" onClick={closeForm} disabled={saving}>
                Vazgeç
              </Button>
              <Button type="submit" loading={saving}>
                {editingId ? "Kaydet" : "Ekle"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Uzmanlığı sil"
        description={
          pendingDelete
            ? `"${pendingDelete.name}" uzmanlığını silmek istediğinize emin misiniz? Bu uzmanlığa bağlı doktorların uzmanlığı boşa düşer.`
            : undefined
        }
        confirmText="Sil"
        tone="danger"
        loading={deletingId === pendingDelete?.id}
        onConfirm={handleDelete}
      />
    </div>
  );
}
