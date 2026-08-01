"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import * as blogApi from "@/lib/api/blog";
import type { BlogCategory } from "@/lib/api/types";
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

export default function AdminBlogCategoriesPage() {
  const [categories, setCategories] = useState<BlogCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BlogCategory | null>(null);

  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCategories(await blogApi.listCategories());
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await blogApi.createCategory({ name });
      toast.success("Kategori eklendi.");
      setName("");
      await load();
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setCreateError(message);
      toast.error(message);
    } finally {
      setCreating(false);
    }
  }

  function startEdit(category: BlogCategory) {
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
      await blogApi.updateCategory(categoryId, { name: trimmed });
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
      await blogApi.deleteCategory(categoryId);
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
      <PageHeading icon={Tag} title="Kategoriler" description="Blog kategorilerini yönetin." />

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
        <h2 className="text-base font-semibold text-foreground">Yeni kategori</h2>
        {createError && (
          <Alert variant="error" className="mt-4">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {createError}
            </span>
          </Alert>
        )}
        <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={handleCreate} noValidate>
          <div className="flex-1">
            <Field id="category-name" label="Kategori adı" required>
              {(inputProps) => (
                <Input {...inputProps} required value={name} onChange={(e) => setName(e.target.value)} />
              )}
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
