"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import * as portfolioApi from "@/lib/api/portfolio";
import type { PortfolioCategory } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeading } from "@/components/admin/page-heading";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { AlertCircle, Check, Pencil, Tag, X } from "lucide-react";

// `portfolioApi.createPortfolioCategory` gövdesini yansıtan istemci tarafı zod şeması —
// bkz. admin/products/categories/page.tsx (BİREBİR aynı patern).
const createCategoryFormSchema = z.object({
  name: z.string().min(1, "Kategori adı gerekli."),
});

type CreateCategoryFormValues = z.infer<typeof createCategoryFormSchema>;

export default function AdminPortfolioCategoriesPage() {
  const [categories, setCategories] = useState<PortfolioCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PortfolioCategory | null>(null);

  const [createError, setCreateError] = useState<string | null>(null);
  const {
    register: registerCreate,
    handleSubmit: handleCreateFormSubmit,
    reset: resetCreateForm,
    formState: { errors: createErrors, isSubmitting: creating },
  } = useForm<CreateCategoryFormValues>({
    resolver: zodResolver(createCategoryFormSchema),
    defaultValues: { name: "" },
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCategories(await portfolioApi.listPortfolioCategories());
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function onCreateSubmit(values: CreateCategoryFormValues) {
    setCreateError(null);
    try {
      await portfolioApi.createPortfolioCategory({ name: values.name });
      toast.success("Kategori eklendi.");
      resetCreateForm();
      await load();
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setCreateError(message);
      toast.error(message);
    }
  }

  function startEdit(category: PortfolioCategory) {
    setEditingId(category.id);
    setEditName(category.name);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
  }

  async function handleUpdate(categoryId: string) {
    const trimmed = editName.trim();
    if (!trimmed) return;
    setSavingId(categoryId);
    try {
      await portfolioApi.updatePortfolioCategory(categoryId, { name: trimmed });
      toast.success("Kategori güncellendi.");
      setEditingId(null);
      setEditName("");
      await load();
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    const categoryId = pendingDelete.id;
    setDeletingId(categoryId);
    try {
      await portfolioApi.deletePortfolioCategory(categoryId);
      toast.success("Kategori silindi.");
      setPendingDelete(null);
      await load();
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeading icon={Tag} title="Kategoriler" description="Portföy kategorilerini yönetin." />

      {error && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </span>
        </Alert>
      )}

      {categories === null ? (
        <div className="flex justify-center py-8">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : categories.length === 0 ? (
        <EmptyState icon={Tag} title="Henüz kategori yok" description="Aşağıdan ilk kategorinizi ekleyin." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ad</TableHead>
              <TableHead className="text-right">İşlemler</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((category) => {
              const isEditing = editingId === category.id;
              return (
                <TableRow key={category.id}>
                  <TableCell className="font-medium text-foreground">
                    {isEditing ? (
                      <Input
                        aria-label="Kategori adı"
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleUpdate(category.id);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelEdit();
                          }
                        }}
                      />
                    ) : (
                      category.name
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {isEditing ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Kaydet"
                          loading={savingId === category.id}
                          onClick={() => handleUpdate(category.id)}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Vazgeç"
                          disabled={savingId === category.id}
                          onClick={cancelEdit}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`"${category.name}" kategorisini düzenle`}
                          onClick={() => startEdit(category)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setPendingDelete(category)}>
                          Sil
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Card>
        <h2 className="admin-h2">Yeni kategori</h2>
        {createError && (
          <Alert variant="error" className="mt-4">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {createError}
            </span>
          </Alert>
        )}
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={handleCreateFormSubmit(onCreateSubmit)}
          noValidate
        >
          <div className="flex-1">
            <Field id="category-name" label="Kategori adı" error={createErrors.name?.message} required>
              {(inputProps) => <Input {...inputProps} {...registerCreate("name")} />}
            </Field>
          </div>
          <Button type="submit" loading={creating}>
            Ekle
          </Button>
        </form>
      </Card>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Kategoriyi sil"
        description={pendingDelete ? `"${pendingDelete.name}" kategorisini silmek istediğinize emin misiniz?` : undefined}
        confirmText="Sil"
        destructive
        loading={deletingId === pendingDelete?.id}
        onConfirm={handleDelete}
      />
    </div>
  );
}
