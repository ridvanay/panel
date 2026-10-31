"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Plus, X } from "lucide-react";
import type { AdminPackage, PackageInput } from "@/lib/api/admin-packages";
import { PACKAGE_CATEGORIES, PACKAGE_CATEGORY_LABELS, type PackageCategory } from "@/lib/api/admin-packages";
import type { Locale, TextTranslations } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { MediaSelectField } from "@/components/admin/media/media-select-field";
import { CANONICAL_LOCALE_CODE, TranslationLocaleTabs } from "@/components/admin/translation-locale-tabs";
import { OrderedMultiSelect, type OrderedOption } from "@/components/admin/packages/ordered-multi-select";
import {
  buildPackageBody,
  emptyPackageForm,
  emptyPackageLocale,
  packageToForm,
  validatePackageForm,
  type PackageFormState,
  type PackageLocaleForm,
} from "@/components/admin/packages/package-form-helpers";

/**
 * Paket X — sağlık paketi düzenleme formu. İstemci doğrulaması: slug biçimi, EN başlık ve
 * `showPrice` açıkken `priceFrom` zorunluluğu (sunucu da 422 döner). Gövde sözleşmeye birebir uyar
 * (bkz. `buildPackageBody`).
 */
export function PackageForm({
  pkg,
  locales,
  specialtyOptions,
  doctorOptions,
  saving,
  serverErrors,
  onSubmit,
  onCancel,
}: {
  pkg: AdminPackage | null;
  locales: Locale[];
  specialtyOptions: OrderedOption[];
  doctorOptions: OrderedOption[];
  saving: boolean;
  serverErrors?: Record<string, string>;
  onSubmit: (body: PackageInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<PackageFormState>(() => (pkg ? packageToForm(pkg) : emptyPackageForm()));
  const [contentLocale, setContentLocale] = useState(CANONICAL_LOCALE_CODE);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const allErrors = { ...serverErrors, ...errors };

  const loc: PackageLocaleForm = form.locales[contentLocale] ?? emptyPackageLocale();
  const canonical = form.locales[CANONICAL_LOCALE_CODE] ?? emptyPackageLocale();
  const isEn = contentLocale === CANONICAL_LOCALE_CODE;
  const suffix = isEn ? "" : ` (${contentLocale.toUpperCase()})`;

  const tabEntries = useMemo(() => {
    const translations: TextTranslations = {};
    for (const [code, l] of Object.entries(form.locales)) translations[code] = { title: l.title, summary: l.summary };
    return [{ translations, fields: ["title", "summary"] }];
  }, [form.locales]);

  function patch(p: Partial<PackageFormState>) {
    setForm((f) => ({ ...f, ...p }));
  }
  function patchLocale(p: Partial<PackageLocaleForm>) {
    setForm((f) => ({ ...f, locales: { ...f.locales, [contentLocale]: { ...(f.locales[contentLocale] ?? emptyPackageLocale()), ...p } } }));
  }
  function ph(field: keyof PackageLocaleForm): string | undefined {
    if (isEn) return undefined;
    const v = canonical[field];
    return typeof v === "string" ? v : undefined;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const found = validatePackageForm(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      if (found.title) setContentLocale(CANONICAL_LOCALE_CODE);
      return;
    }
    onSubmit(buildPackageBody(form));
  }

  return (
    <Card data-testid="package-form">
      <div className="flex items-center justify-between">
        <h2 className="admin-h2">{pkg ? "Paketi düzenle" : "Yeni paket"}</h2>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Formu kapat" onClick={onCancel}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit} noValidate>
        <Field id="pkg-slug" label="Slug" required error={allErrors.slug} hint="Sitede /packages/<slug> adresi olur.">
          {(p) => <Input {...p} value={form.slug} onChange={(e) => patch({ slug: e.target.value })} placeholder="executive-check-up" dir="ltr" />}
        </Field>

        <Field id="pkg-category" label="Kategori">
          {(p) => (
            <Select {...p} value={form.category} onChange={(e) => patch({ category: e.target.value as PackageCategory })}>
              {PACKAGE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {PACKAGE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="sm:col-span-2">
          <MediaSelectField
            id="pkg-cover"
            label="Kapak görseli"
            value={form.cover}
            onChange={(cover) => patch({ cover })}
            accept="image/png,image/jpeg,image/webp"
            hint="Yüklenen görsel otomatik WebP'ye dönüştürülür (Open Graph için JPEG kopyası da üretilir)."
          />
        </div>

        <div className="sm:col-span-2">
          <TranslationLocaleTabs locales={locales} value={contentLocale} onValueChange={setContentLocale} entries={tabEntries} />
        </div>

        <div className="sm:col-span-2">
          <Field id={`pkg-title-${contentLocale}`} label={`Başlık${suffix}`} required={isEn} error={isEn ? allErrors.title : undefined}>
            {(p) => <Input {...p} value={loc.title} onChange={(e) => patchLocale({ title: e.target.value })} placeholder={ph("title")} maxLength={160} />}
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field id={`pkg-summary-${contentLocale}`} label={`Özet${suffix}`}>
            {(p) => <Textarea {...p} rows={3} value={loc.summary} onChange={(e) => patchLocale({ summary: e.target.value })} placeholder={ph("summary")} />}
          </Field>
        </div>

        <Field id={`pkg-includes-${contentLocale}`} label={`Pakete dahil olanlar${suffix}`} hint="Her satıra bir madde.">
          {(p) => <Textarea {...p} rows={5} value={loc.includes} onChange={(e) => patchLocale({ includes: e.target.value })} />}
        </Field>
        <Field id={`pkg-notincluded-${contentLocale}`} label={`Dahil olmayanlar${suffix}`} hint="Her satıra bir madde.">
          {(p) => <Textarea {...p} rows={5} value={loc.notIncluded} onChange={(e) => patchLocale({ notIncluded: e.target.value })} />}
        </Field>

        <Field id={`pkg-duration-${contentLocale}`} label={`Süre${suffix}`} hint="Ör. 1 gün, 2 gece konaklama.">
          {(p) => <Input {...p} value={loc.duration} onChange={(e) => patchLocale({ duration: e.target.value })} placeholder={ph("duration")} />}
        </Field>
        <Field id={`pkg-idealfor-${contentLocale}`} label={`Kimler için uygun${suffix}`}>
          {(p) => <Input {...p} value={loc.idealFor} onChange={(e) => patchLocale({ idealFor: e.target.value })} placeholder={ph("idealFor")} />}
        </Field>

        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="text-sm font-medium text-foreground">Sık sorulan sorular{suffix}</legend>
          {loc.faq.map((item, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-border p-3">
              <Input
                aria-label={`Soru ${i + 1}${suffix}`}
                placeholder="Soru"
                value={item.question}
                onChange={(e) => patchLocale({ faq: loc.faq.map((f, j) => (j === i ? { ...f, question: e.target.value } : f)) })}
              />
              <Textarea
                aria-label={`Cevap ${i + 1}${suffix}`}
                placeholder="Cevap"
                rows={2}
                value={item.answer}
                onChange={(e) => patchLocale({ faq: loc.faq.map((f, j) => (j === i ? { ...f, answer: e.target.value } : f)) })}
              />
              <div className="flex justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => patchLocale({ faq: loc.faq.filter((_, j) => j !== i) })}>
                  Soruyu kaldır
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => patchLocale({ faq: [...loc.faq, { question: "", answer: "" }] })}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            Soru ekle
          </Button>
          <p className="text-xs text-foreground/60">Soru ya da cevabı boş bırakılan satırlar kaydedilmez.</p>
        </fieldset>

        <div className="space-y-3 rounded-lg border border-border p-3 sm:col-span-2">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm">
              <span className="font-medium text-foreground">Fiyatı sitede göster</span>
              <span className="block text-xs text-foreground/60">
                Fiyatlar yalnızca bilgi amaçlıdır; varsayılan kapalı. Gösterilirse sitede &quot;kesin fiyat tıbbi değerlendirmeden sonra&quot; notu çıkar.
              </span>
            </span>
            <Switch checked={form.showPrice} onCheckedChange={(v: boolean) => patch({ showPrice: v })} aria-label="Fiyatı sitede göster" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="pkg-price" label="Başlangıç fiyatı" required={form.showPrice} error={allErrors.priceFrom}>
              {(p) => <Input {...p} inputMode="decimal" value={form.priceFrom} onChange={(e) => patch({ priceFrom: e.target.value })} placeholder="1490" />}
            </Field>
            <Field id="pkg-currency" label="Para birimi" error={allErrors.currency}>
              {(p) => <Input {...p} value={form.currency} onChange={(e) => patch({ currency: e.target.value })} maxLength={3} dir="ltr" />}
            </Field>
          </div>
        </div>

        <OrderedMultiSelect
          id="pkg-specialties"
          label="İlgili uzmanlıklar"
          options={specialtyOptions}
          value={form.specialtyIds}
          onChange={(specialtyIds) => patch({ specialtyIds })}
          hint="Paket sayfasındaki sıra budur."
        />
        <OrderedMultiSelect
          id="pkg-doctors"
          label="İlgili hekimler"
          options={doctorOptions}
          value={form.doctorIds}
          onChange={(doctorIds) => patch({ doctorIds })}
          hint="Paket sayfasındaki sıra budur."
        />

        <Field id="pkg-sort" label="Sıra" hint="Küçük sayı önce gösterilir.">
          {(p) => <Input {...p} type="number" min={0} value={form.sortOrder} onChange={(e) => patch({ sortOrder: e.target.value })} />}
        </Field>

        <div className="space-y-2 sm:col-span-2">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm">
              <span className="font-medium text-foreground">Aktif (yayında)</span>
              <span className="block text-xs text-foreground/60">Kapalıyken paket taslaktır; sitede ve /packages/&lt;slug&gt; adresinde görünmez.</span>
            </span>
            <Switch checked={form.isActive} onCheckedChange={(v: boolean) => patch({ isActive: v })} aria-label="Paket aktif mi" />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm font-medium text-foreground">Öne çıkan</span>
            <Switch checked={form.isFeatured} onCheckedChange={(v: boolean) => patch({ isFeatured: v })} aria-label="Öne çıkan paket" />
          </div>
        </div>

        {pkg && (
          <div className="sm:col-span-2">
            {pkg.isActive && form.slug === pkg.slug ? (
              <a
                href={`/en/packages/${pkg.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-2 hover:underline"
              >
                Sitede önizle <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">(yeni sekmede açılır)</span>
              </a>
            ) : (
              <Alert variant="info">Önizleme bağlantısı yalnızca aktif (yayında) ve kaydedilmiş paketlerde çalışır; taslak paketler sitede 404 verir.</Alert>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Vazgeç
          </Button>
          <Button type="submit" loading={saving}>
            {pkg ? "Kaydet" : "Ekle"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
