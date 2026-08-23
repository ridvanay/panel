"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import * as blogApi from "@/lib/api/blog";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { BlogCategory } from "@/lib/api/types";

/** Backend `slugify`'ın (bkz. `backend/src/lib/slug.ts`) istemci tarafı ön izleme eşdeğeri. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/ç/g, "c")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ı/g, "i")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface CategorySelectProps {
  id: string;
  label?: string;
  categories: BlogCategory[];
  /** `""` DEĞİL `null` — "Kategorisiz" seçimi. */
  value: string | null;
  onChange: (categoryId: string | null) => void;
  /** Yeni kategori oluşturulduğunda `categories`'i güncellemek için (yerel liste, refetch YOK). */
  onCategoryCreated: (category: BlogCategory) => void;
  disabled?: boolean;
  /** §10.21 — CUSTOMER/USER paneline giremediği için burada yalnızca ADMIN/MANAGER/EDITOR'e `true` gelir. */
  canCreate?: boolean;
}

/**
 * §10.14.5 madde 5 — Kategori dropdown'ı, Etiket'le AYNI satır-içi oluşturma mantığı
 * ("+ Yeni Kategori Oluştur", yeni bir modal AÇILMAZ).
 */
export function CategorySelect({
  id,
  label = "Kategori",
  categories,
  value,
  onChange,
  onCategoryCreated,
  disabled = false,
  canCreate = true,
}: CategorySelectProps) {
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openCreate() {
    setCreatingOpen(true);
    setName("");
    setError(null);
  }

  function cancelCreate() {
    setCreatingOpen(false);
    setName("");
    setError(null);
  }

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;

    // POST'tan ÖNCE yerel listede slug eşleşmesi ara — varsa istek hiç gönderilmez.
    const targetSlug = slugify(trimmed);
    const existing = categories.find((c) => c.slug === targetSlug || c.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      onChange(existing.id);
      setCreatingOpen(false);
      setName("");
      toast.info("Bu kategori zaten vardı, seçildi.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const category = await blogApi.createCategory({ name: trimmed });
      onCategoryCreated(category);
      onChange(category.id);
      setCreatingOpen(false);
      setName("");
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        toast.info("Bu kategori zaten vardı, seçildi.");
        setCreatingOpen(false);
        setName("");
      } else {
        setError(friendlyErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-foreground/60">
        {label}
      </label>
      <Select
        id={id}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Kategorisiz</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </Select>

      {canCreate &&
        (creatingOpen ? (
          <div className="flex items-center gap-1.5">
            <Input
              autoFocus
              aria-label="Yeni kategori adı"
              placeholder="Kategori adı"
              value={name}
              disabled={submitting}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreate();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelCreate();
                }
              }}
            />
            <Button type="button" size="sm" loading={submitting} onClick={() => void handleCreate()}>
              Oluştur
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={submitting} onClick={cancelCreate}>
              Vazgeç
            </Button>
          </div>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            onClick={openCreate}
          >
            <Plus className="h-3.5 w-3.5" />
            Yeni Kategori Oluştur
          </button>
        ))}

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
