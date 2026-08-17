"use client";

import { useId, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import * as blogApi from "@/lib/api/blog";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { BlogTag } from "@/lib/api/types";
import { cn } from "@/lib/utils";

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

interface TagSelectProps {
  /** Görünür `<label>` metni — kategoriyle "aynı UX mantığı" istendi, placeholder etiket YERİNE GEÇMEZ. */
  label?: string;
  /** Bilinen TÜM etiketler (öneri kaynağı + oluşturmadan önce yerel slug eşleşmesi). */
  availableTags: BlogTag[];
  selectedIds: string[];
  /** TAM SET semantiğiyle çağrılır — bkz. §10.14.4. */
  onChange: (tagIds: string[]) => void;
  /** Yeni etiket oluşturulduğunda `availableTags`'i güncellemek için (yerel liste, refetch YOK). */
  onTagCreated: (tag: BlogTag) => void;
  disabled?: boolean;
  /** EDITOR altı roller (VIEWER) için satır-içi oluşturma tetikleyicisi RENDER EDİLMEZ. */
  canCreate?: boolean;
}

/**
 * §10.14.5 — TEK bileşen, hem tam editörde hem Hızlı Düzenle'de kullanılır. `<select multiple>`
 * KULLANILMAZ (mobilde kullanılamaz, seçili öğeler görünür kalmaz) — chip listesi +
 * arama/ekleme kutusu deseni.
 */
export function TagSelect({
  label = "Etiketler",
  availableTags,
  selectedIds,
  onChange,
  onTagCreated,
  disabled = false,
  canCreate = true,
}: TagSelectProps) {
  const baseId = useId();
  const inputId = `tag-select-input-${baseId}`;
  const listLabelId = `tag-select-list-label-${baseId}`;

  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const selectedTags = useMemo(
    () => selectedIds.map((id) => availableTags.find((t) => t.id === id)).filter((t): t is BlogTag => Boolean(t)),
    [selectedIds, availableTags]
  );

  const trimmedQuery = query.trim();

  const suggestions = useMemo(() => {
    if (!trimmedQuery) return [];
    const lower = trimmedQuery.toLowerCase();
    return availableTags.filter((t) => !selectedIds.includes(t.id) && t.name.toLowerCase().includes(lower)).slice(0, 8);
  }, [availableTags, trimmedQuery, selectedIds]);

  const exactMatch = availableTags.find((t) => t.name.toLowerCase() === trimmedQuery.toLowerCase());
  const showCreateOption = canCreate && trimmedQuery.length > 0 && !exactMatch;

  function selectTag(tag: BlogTag) {
    if (selectedIds.includes(tag.id)) return;
    onChange([...selectedIds, tag.id]);
    setQuery("");
    setCreateError(null);
    setAnnouncement(`${tag.name} etiketi eklendi.`);
  }

  function removeTag(tag: BlogTag) {
    onChange(selectedIds.filter((id) => id !== tag.id));
    setAnnouncement(`${tag.name} etiketi kaldırıldı.`);
  }

  async function handleCreate() {
    if (!trimmedQuery) return;
    // §10.14.5 madde 3: POST'tan ÖNCE yerel listede slug eşleşmesi ara — varsa istek hiç gönderilmez.
    const targetSlug = slugify(trimmedQuery);
    const existing = availableTags.find((t) => t.slug === targetSlug || t.name.toLowerCase() === trimmedQuery.toLowerCase());
    if (existing) {
      selectTag(existing);
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const tag = await blogApi.createTag({ name: trimmedQuery });
      onTagCreated(tag);
      selectTag(tag);
    } catch (err) {
      // 409 CONFLICT hata olarak GÖSTERİLMEZ — yarış durumu, var olan kayıt seçilir.
      if (err instanceof ApiClientError && err.status === 409) {
        setAnnouncement("Bu etiket zaten vardı, seçildi.");
        setQuery("");
      } else {
        setCreateError(friendlyErrorMessage(err));
      }
    } finally {
      setCreating(false);
    }
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (suggestions.length > 0) {
        selectTag(suggestions[0]);
      } else if (showCreateOption) {
        void handleCreate();
      }
    }
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-xs font-medium text-foreground/60" id={listLabelId}>
        {label}
      </label>

      {selectedTags.length > 0 && (
        <ul role="list" aria-labelledby={listLabelId} className="flex flex-wrap items-center gap-1.5">
          {selectedTags.map((tag) => (
            <li key={tag.id}>
              <span className="inline-flex items-center gap-1">
                <Badge tone="neutral" size="sm">
                  {tag.name}
                </Badge>
                <button
                  type="button"
                  aria-label={`${tag.name} etiketini kaldır`}
                  disabled={disabled}
                  onClick={() => removeTag(tag)}
                  className="rounded-full text-foreground/50 transition-colors hover:text-danger disabled:pointer-events-none disabled:opacity-50"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <Input
          id={inputId}
          value={query}
          disabled={disabled}
          placeholder="Etiket ara veya ekle..."
          onChange={(e) => {
            setQuery(e.target.value);
            setCreateError(null);
          }}
          onKeyDown={handleInputKeyDown}
        />
        {(suggestions.length > 0 || showCreateOption) && (
          <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-md">
            {suggestions.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => selectTag(tag)}
              >
                {tag.name}
              </button>
            ))}
            {showCreateOption && (
              <button
                type="button"
                disabled={creating}
                className={cn(
                  "flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm text-primary hover:bg-muted disabled:opacity-50",
                  suggestions.length > 0 && "border-t border-border"
                )}
                onClick={() => void handleCreate()}
              >
                <Plus className="h-3.5 w-3.5" />
                {creating ? "Oluşturuluyor…" : `"${trimmedQuery}" için yeni etiket oluştur`}
              </button>
            )}
          </div>
        )}
      </div>

      {createError && (
        <p role="alert" className="text-xs text-danger">
          {createError}
        </p>
      )}

      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
