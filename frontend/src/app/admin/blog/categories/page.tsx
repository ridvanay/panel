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
import { AlertCircle, Tag } from "lucide-react";

export default function AdminBlogCategoriesPage() {
  const [categories, setCategories] = useState<BlogCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BlogCategory | null>(null);

  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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
            {categories.map((category) => (
              <TableRow key={category.id}>
                <TableCell className="font-medium text-foreground">{category.name}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setPendingDelete(category)}>
                    Sil
                  </Button>
                </TableCell>
              </TableRow>
            ))}
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
