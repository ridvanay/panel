"use client";

import { useEffect, useState } from "react";
import { listCategories, listTags } from "@/lib/api/blog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { BlogCategory, BlogTag } from "@/lib/api/types";
import { LATEST_POSTS_MAX_LIMIT, type LatestPostsBlock } from "@/lib/page-builder/types";

export function LatestPostsBlockEditor({
  block,
  onChange,
  simple = false,
}: {
  block: LatestPostsBlock;
  onChange: (block: LatestPostsBlock) => void;
  /** §2.5 tablo B — şablon modunda kategori/etiket filtresi kilitlidir. */
  simple?: boolean;
}) {
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [tags, setTags] = useState<BlogTag[]>([]);

  // `simple` iken kategori/etiket `Select`leri hiç render edilmez (aşağıda) — gereksiz istek
  // atmamak için veri de çekilmez.
  useEffect(() => {
    if (simple) return;
    (async () => {
      try {
        setCategories(await listCategories());
      } catch {
        setCategories([]);
      }
    })();
  }, [simple]);

  useEffect(() => {
    if (simple) return;
    (async () => {
      try {
        setTags(await listTags());
      } catch {
        setTags([]);
      }
    })();
  }, [simple]);

  return (
    <div className="space-y-3">
      <Field id={`${block.id}-heading`} label="Başlık" hint="Boş bırakılırsa başlık gösterilmez.">
        {(inputProps) => (
          <Input
            {...inputProps}
            value={block.data.heading ?? ""}
            onChange={(e) => onChange({ ...block, data: { ...block.data, heading: e.target.value } })}
          />
        )}
      </Field>

      <Field id={`${block.id}-limit`} label="Yazı sayısı" required>
        {(inputProps) => (
          <Input
            {...inputProps}
            type="number"
            min={1}
            max={LATEST_POSTS_MAX_LIMIT}
            value={block.data.limit}
            onChange={(e) => {
              const value = Number(e.target.value);
              const clamped = Number.isFinite(value) ? Math.min(LATEST_POSTS_MAX_LIMIT, Math.max(1, Math.round(value))) : 1;
              onChange({ ...block, data: { ...block.data, limit: clamped } });
            }}
          />
        )}
      </Field>

      {!simple && (
        <>
          <Field id={`${block.id}-category`} label="Kategori" hint="Seçilmezse tüm kategorilerden yazı gösterilir.">
            {(inputProps) => (
              <Select
                {...inputProps}
                value={block.data.categoryId ?? ""}
                onChange={(e) => onChange({ ...block, data: { ...block.data, categoryId: e.target.value || undefined } })}
              >
                <option value="">Tüm kategoriler</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field id={`${block.id}-tag`} label="Etiket" hint="Seçilmezse tüm etiketlerden yazı gösterilir.">
            {(inputProps) => (
              <Select
                {...inputProps}
                value={block.data.tagId ?? ""}
                onChange={(e) => onChange({ ...block, data: { ...block.data, tagId: e.target.value || undefined } })}
              >
                <option value="">Tüm etiketler</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </>
      )}
    </div>
  );
}
