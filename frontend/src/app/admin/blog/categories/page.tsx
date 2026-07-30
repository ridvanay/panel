"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import * as blogApi from "@/lib/api/blog";
import type { BlogCategory } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

export default function AdminBlogCategoriesPage() {
  const [categories, setCategories] = useState<BlogCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
      setName("");
      await load();
    } catch (err) {
      setCreateError(friendlyErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(categoryId: string) {
    if (!confirm("Bu kategoriyi silmek istediğinize emin misiniz?")) return;
    setDeletingId(categoryId);
    try {
      await blogApi.deleteCategory(categoryId);
      await load();
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Kategoriler</h1>
        <p className="mt-1 text-sm text-foreground/60">Blog kategorilerini yönetin.</p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {categories === null ? (
        <div className="flex justify-center py-8">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : (
        <ul className="space-y-2">
          {categories.length === 0 && (
            <li className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/60">
              Henüz kategori yok
            </li>
          )}
          {categories.map((category) => (
            <li key={category.id}>
              <Card className="flex items-center justify-between py-3">
                <span className="text-sm font-medium text-foreground">{category.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={deletingId === category.id}
                  onClick={() => handleDelete(category.id)}
                >
                  Sil
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <h2 className="text-base font-semibold text-foreground">Yeni kategori</h2>
        {createError && (
          <Alert variant="error" className="mt-4">
            {createError}
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
    </div>
  );
}
