"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useModules } from "@/context/modules-context";
import { listProductCategories } from "@/lib/api/products";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ProductCategory } from "@/lib/api/types";
import type { FeaturedProductsBlock } from "@/lib/page-builder/types";

/**
 * §Faz 4 Site Şablonu — bu blok, `products` modülü pasifken de EKLENEBİLİR (şablon SADECE
 * ÖNERİ niteliğinde), yalnızca aşağıdaki uyarı gösterilir; blok herhangi bir modülü otomatik
 * açmaz/kapatmaz.
 */
export function FeaturedProductsBlockEditor({
  block,
  onChange,
}: {
  block: FeaturedProductsBlock;
  onChange: (block: FeaturedProductsBlock) => void;
}) {
  const { isModuleEnabled } = useModules();
  const [categories, setCategories] = useState<ProductCategory[]>([]);

  useEffect(() => {
    (async () => {
      try {
        setCategories(await listProductCategories());
      } catch {
        setCategories([]);
      }
    })();
  }, []);

  return (
    <div className="space-y-3">
      {!isModuleEnabled("products") && (
        <div className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Ürünler modülü pasif — bu blok public sitede görünmeyecek, <code>/admin/modules</code>&apos;ten
            etkinleştirebilirsiniz.
          </span>
        </div>
      )}

      <Field id={`${block.id}-heading`} label="Başlık" hint="Boş bırakılırsa başlık gösterilmez.">
        {(inputProps) => (
          <Input
            {...inputProps}
            value={block.data.heading ?? ""}
            onChange={(e) => onChange({ ...block, data: { ...block.data, heading: e.target.value } })}
          />
        )}
      </Field>

      <Field id={`${block.id}-limit`} label="Ürün sayısı" required>
        {(inputProps) => (
          <Input
            {...inputProps}
            type="number"
            min={1}
            max={12}
            value={block.data.limit}
            onChange={(e) => {
              const value = Number(e.target.value);
              const clamped = Number.isFinite(value) ? Math.min(12, Math.max(1, Math.round(value))) : 1;
              onChange({ ...block, data: { ...block.data, limit: clamped } });
            }}
          />
        )}
      </Field>

      <Field id={`${block.id}-category`} label="Kategori" hint="Seçilmezse tüm kategorilerden ürün gösterilir.">
        {(inputProps) => (
          <Select
            {...inputProps}
            value={block.data.categoryId ?? ""}
            onChange={(e) =>
              onChange({ ...block, data: { ...block.data, categoryId: e.target.value || undefined } })
            }
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
    </div>
  );
}
