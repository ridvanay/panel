"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import type { AdminDestination, DestinationInput } from "@/lib/api/admin-packages";
import type { Locale, TextTranslations } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { MediaSelectField } from "@/components/admin/media/media-select-field";
import { CANONICAL_LOCALE_CODE, TranslationLocaleTabs } from "@/components/admin/translation-locale-tabs";
import {
  MAX_TOP_TREATMENTS,
  addTreatment,
  buildDestinationBody,
  destinationToForm,
  emptyDestinationForm,
  validateDestinationForm,
  type DestinationFormState,
  type DestinationLocaleForm,
} from "@/components/admin/packages/package-form-helpers";

const EMPTY_LOCALE: DestinationLocaleForm = { title: "", summary: "", highlights: "" };

/** Paket X — "Top destinations" düzenleme formu. En çok 3 tedavi; boş bırakılan rakamlar sitede gösterilmez. */
export function DestinationForm({
  destination,
  locales,
  saving,
  serverErrors,
  onSubmit,
  onCancel,
}: {
  destination: AdminDestination | null;
  locales: Locale[];
  saving: boolean;
  serverErrors?: Record<string, string>;
  onSubmit: (body: DestinationInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<DestinationFormState>(() => (destination ? destinationToForm(destination) : emptyDestinationForm()));
  const [contentLocale, setContentLocale] = useState(CANONICAL_LOCALE_CODE);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const allErrors = { ...serverErrors, ...errors };

  const loc = form.locales[contentLocale] ?? EMPTY_LOCALE;
  const canonical = form.locales[CANONICAL_LOCALE_CODE] ?? EMPTY_LOCALE;
  const isEn = contentLocale === CANONICAL_LOCALE_CODE;
  const suffix = isEn ? "" : ` (${contentLocale.toUpperCase()})`;

  const tabEntries = useMemo(() => {
    const translations: TextTranslations = {};
    for (const [code, l] of Object.entries(form.locales)) translations[code] = { title: l.title, summary: l.summary };
    return [{ translations, fields: ["title", "summary"] }];
  }, [form.locales]);

  function patch(p: Partial<DestinationFormState>) {
    setForm((f) => ({ ...f, ...p }));
  }
  function patchLocale(p: Partial<DestinationLocaleForm>) {
    setForm((f) => ({ ...f, locales: { ...f.locales, [contentLocale]: { ...(f.locales[contentLocale] ?? EMPTY_LOCALE), ...p } } }));
  }
  function patchTreatment(index: number, p: Partial<DestinationFormState["treatments"][number]>) {
    setForm((f) => ({ ...f, treatments: f.treatments.map((t, i) => (i === index ? { ...t, ...p } : t)) }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const found = validateDestinationForm(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      if (found.title) setContentLocale(CANONICAL_LOCALE_CODE);
      return;
    }
    onSubmit(buildDestinationBody(form));
  }

  return (
    <Card data-testid="destination-form">
      <div className="flex items-center justify-between">
        <h2 className="admin-h2">{destination ? "Destinasyonu düzenle" : "Yeni destinasyon"}</h2>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Formu kapat" onClick={onCancel}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit} noValidate>
        <div className="sm:col-span-2">
          <Alert variant="info">Bütün rakamlar sizin girdiğiniz gerçek verilerdir; boş bırakılan alanlar sitede gösterilmez.</Alert>
        </div>

        <Field id="dest-city" label="Şehir" required error={allErrors.city}>
          {(p) => <Input {...p} value={form.city} onChange={(e) => patch({ city: e.target.value })} placeholder="Istanbul" />}
        </Field>
        <Field id="dest-slug" label="Slug" required error={allErrors.slug}>
          {(p) => <Input {...p} value={form.slug} onChange={(e) => patch({ slug: e.target.value })} placeholder="istanbul" dir="ltr" />}
        </Field>

        <div className="sm:col-span-2">
          <MediaSelectField
            id="dest-cover"
            label="Kapak görseli"
            value={form.cover}
            onChange={(cover) => patch({ cover })}
            accept="image/png,image/jpeg,image/webp"
            hint="Yüklenen görsel otomatik WebP'ye dönüştürülür."
          />
        </div>

        <div className="sm:col-span-2">
          <TranslationLocaleTabs locales={locales} value={contentLocale} onValueChange={setContentLocale} entries={tabEntries} />
        </div>

        <div className="sm:col-span-2">
          <Field id={`dest-title-${contentLocale}`} label={`Başlık${suffix}`} required={isEn} error={isEn ? allErrors.title : undefined}>
            {(p) => <Input {...p} value={loc.title} onChange={(e) => patchLocale({ title: e.target.value })} placeholder={isEn ? undefined : canonical.title} maxLength={160} />}
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field id={`dest-summary-${contentLocale}`} label={`Özet${suffix}`}>
            {(p) => <Textarea {...p} rows={3} value={loc.summary} onChange={(e) => patchLocale({ summary: e.target.value })} placeholder={isEn ? undefined : canonical.summary} />}
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field id={`dest-highlights-${contentLocale}`} label={`Öne çıkanlar${suffix}`} hint="Her satıra bir madde.">
            {(p) => <Textarea {...p} rows={4} value={loc.highlights} onChange={(e) => patchLocale({ highlights: e.target.value })} />}
          </Field>
        </div>

        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="text-sm font-medium text-foreground">
            Öne çıkan tedaviler (en çok {MAX_TOP_TREATMENTS})
          </legend>
          {form.treatments.map((t, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_8rem_6rem_auto]">
              <Input
                aria-label={`Tedavi ${i + 1} adı${suffix}`}
                placeholder={isEn ? "Tedavi adı" : (form.treatments[i].label[CANONICAL_LOCALE_CODE] ?? "Tedavi adı")}
                value={t.label[contentLocale] ?? ""}
                onChange={(e) => patchTreatment(i, { label: { ...t.label, [contentLocale]: e.target.value } })}
              />
              <Input
                aria-label={`Tedavi ${i + 1} başlangıç fiyatı`}
                placeholder="Fiyat (ops.)"
                inputMode="decimal"
                value={t.priceFrom}
                onChange={(e) => patchTreatment(i, { priceFrom: e.target.value })}
              />
              <Input
                aria-label={`Tedavi ${i + 1} para birimi`}
                value={t.currency}
                maxLength={3}
                dir="ltr"
                onChange={(e) => patchTreatment(i, { currency: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Tedavi ${i + 1} kaldır`}
                onClick={() => patch({ treatments: form.treatments.filter((_, j) => j !== i) })}
              >
                Kaldır
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={form.treatments.length >= MAX_TOP_TREATMENTS}
            onClick={() => patch({ treatments: addTreatment(form.treatments) })}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            Tedavi ekle
          </Button>
          {form.treatments.length >= MAX_TOP_TREATMENTS && <p className="text-xs text-foreground/60">En çok {MAX_TOP_TREATMENTS} tedavi eklenebilir.</p>}
          {allErrors.treatments && (
            <p role="alert" className="text-xs text-danger">
              {allErrors.treatments}
            </p>
          )}
        </fieldset>

        <Field id="dest-patients" label="Geçen yıl hasta sayısı" hint="Boş bırakılırsa sitede hiç gösterilmez." error={allErrors.patientCount}>
          {(p) => <Input {...p} inputMode="numeric" value={form.patientCount} onChange={(e) => patch({ patientCount: e.target.value })} />}
        </Field>
        <Field id="dest-period" label="Veri dönemi etiketi" hint="Ör. 2025 · Ocak–Aralık">
          {(p) => <Input {...p} value={form.dataPeriodLabel} onChange={(e) => patch({ dataPeriodLabel: e.target.value })} />}
        </Field>

        <Field id="dest-sort" label="Sıra" hint="Küçük sayı önce gösterilir.">
          {(p) => <Input {...p} type="number" min={0} value={form.sortOrder} onChange={(e) => patch({ sortOrder: e.target.value })} />}
        </Field>

        <div className="space-y-2 sm:col-span-2">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm">
              <span className="font-medium text-foreground">Tedavi fiyatlarını göster</span>
              <span className="block text-xs text-foreground/60">Varsayılan kapalı. Açıkken yalnızca fiyatı girilmiş tedaviler fiyatla gösterilir.</span>
            </span>
            <Switch checked={form.showPrices} onCheckedChange={(v: boolean) => patch({ showPrices: v })} aria-label="Tedavi fiyatlarını göster" />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm">
              <span className="font-medium text-foreground">Aktif (yayında)</span>
              <span className="block text-xs text-foreground/60">Hiç aktif destinasyon yoksa sitede bölüm görünmez.</span>
            </span>
            <Switch checked={form.isActive} onCheckedChange={(v: boolean) => patch({ isActive: v })} aria-label="Destinasyon aktif mi" />
          </div>
        </div>

        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Vazgeç
          </Button>
          <Button type="submit" loading={saving}>
            {destination ? "Kaydet" : "Ekle"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
