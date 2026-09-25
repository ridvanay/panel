"use client";

import { useMemo } from "react";
import { Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import { IconSelect, ItemToolbar, SectionCard, moveInList } from "@/components/admin/page-builder/about-template-form";
import { newId } from "@/lib/page-builder/registry";
import type { AboutCta } from "@/lib/about-page";
import {
  HOME_MAX_DOCTORS,
  HOME_MAX_STEPS,
  HOME_MAX_TRUST_ITEMS,
  HOME_MIN_DOCTORS,
  HOME_MIN_STEPS,
  HOME_MIN_TRUST_ITEMS,
  HOME_SPECIALTY_COLUMNS,
  buildDefaultHomeContent,
  type HomeItem,
  type HomePageContent,
  type HomeSpecialtyColumns,
} from "@/lib/home-page";
import { homeStrings as enHomeStrings } from "@/lib/i18n/site-dictionaries/en/home";
import { homeStrings as trHomeStrings } from "@/lib/i18n/site-dictionaries/tr/home";

interface HomeTemplateFormProps {
  value: HomePageContent;
  onChange: (next: HomePageContent) => void;
  /** Placeholder olarak gösterilecek sözlük varsayılanlarının dili (`tr` → Türkçe, diğerleri → İngilizce). */
  localeCode: string;
  idPrefix?: string;
}

/**
 * "Anasayfa" şablonunun yapılandırılmış içerik formu — sayfa bu şablonu kullanıyorsa editör blok
 * tuvali YERİNE bunu gösterir (her rolde). Tasarım kodda sabittir; burada yalnızca içerik ve bölüm
 * görünürlüğü düzenlenir. Boş alan sitede sözlükteki varsayılan metinle gösterilir.
 */
export function HomeTemplateForm({ value, onChange, localeCode, idPrefix = "home" }: HomeTemplateFormProps) {
  const defaults = useMemo(() => buildDefaultHomeContent(localeCode === "tr" ? trHomeStrings : enHomeStrings), [localeCode]);
  const id = (key: string) => `${idPrefix}-${key}`;

  function patch<K extends keyof HomePageContent>(section: K, next: Partial<HomePageContent[K]>) {
    onChange({ ...value, [section]: { ...value[section], ...next } });
  }

  function textField(key: string, label: string, current: string, placeholder: string, apply: (text: string) => void, multiline = false) {
    return (
      <Field id={id(key)} label={label}>
        {(inputProps) =>
          multiline ? (
            <Textarea {...inputProps} rows={3} value={current} placeholder={placeholder} onChange={(e) => apply(e.target.value)} />
          ) : (
            <Input {...inputProps} value={current} placeholder={placeholder} onChange={(e) => apply(e.target.value)} />
          )
        }
      </Field>
    );
  }

  function ctaFields(key: string, label: string, current: AboutCta, placeholder: AboutCta, apply: (cta: AboutCta) => void) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {textField(`${key}-label`, `${label} — metin`, current.label, placeholder.label, (text) => apply({ ...current, label: text }))}
        {textField(`${key}-href`, `${label} — bağlantı`, current.href, placeholder.href, (text) => apply({ ...current, href: text }))}
      </div>
    );
  }

  function itemList(
    section: "trust" | "how",
    items: HomeItem[],
    min: number,
    max: number,
    labelPrefix: string,
    apply: (items: HomeItem[]) => void
  ) {
    return (
      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={item.id} className="space-y-3 rounded-lg border border-border/60 p-3">
            <ItemToolbar
              label={`${labelPrefix} ${index + 1}`}
              index={index}
              count={items.length}
              onMove={(direction) => apply(moveInList(items, index, direction))}
              onRemove={() => {
                if (items.length > min) apply(items.filter((i) => i.id !== item.id));
              }}
            />
            <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_1fr]">
              <IconSelect
                id={id(`${section}-${item.id}-icon`)}
                value={item.icon}
                onChange={(icon) => apply(items.map((i) => (i.id === item.id ? { ...i, icon } : i)))}
              />
              {textField(`${section}-${item.id}-title`, "Başlık", item.title, "Başlık", (t) =>
                apply(items.map((i) => (i.id === item.id ? { ...i, title: t } : i)))
              )}
            </div>
            {textField(`${section}-${item.id}-text`, "Metin", item.text, "Kısa açıklama", (t) =>
              apply(items.map((i) => (i.id === item.id ? { ...i, text: t } : i)))
            )}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={items.length >= max}
            onClick={() => apply([...items, { id: newId(), icon: "BadgeCheck", title: "", text: "" }])}
          >
            <Plus className="h-3.5 w-3.5" />
            {labelPrefix} ekle
          </Button>
          <span className="text-xs text-foreground/60">
            {min}–{max} arası. {items.length <= min ? `En az ${min} gerekli; silinemez.` : ""}
          </span>
        </div>
      </div>
    );
  }

  const { hero, trust, specialties, how, doctors, closing } = value;

  return (
    <div className="space-y-6">
      <p className="admin-text-secondary">
        Bölümlerin sırası sabittir; her birini &quot;Bölümü göster&quot; anahtarıyla gizleyebilirsiniz. Boş bıraktığınız
        alanlar sitede gri renkte görünen varsayılan metinle gösterilir. Bağlantılar <code>/doctors</code> gibi site içi bir
        yol, <code>#how</code> gibi sayfa içi bir çapa veya <code>https://</code> ile başlayan bir adres olabilir.
      </p>

      <SectionCard title="Giriş (Hero)" toggle={{ id: id("hero-enabled"), checked: hero.enabled, onChange: (enabled) => patch("hero", { enabled }) }}>
        <div className="grid gap-4 sm:grid-cols-2">
          {textField("hero-eyebrow", "Üst etiket", hero.eyebrow, defaults.hero.eyebrow, (t) => patch("hero", { eyebrow: t }))}
          {textField("hero-title", "Başlık", hero.title, defaults.hero.title, (t) => patch("hero", { title: t }))}
        </div>
        {textField("hero-body", "Açıklama", hero.body, defaults.hero.body, (t) => patch("hero", { body: t }), true)}
        {ctaFields("hero-primary", "Birinci buton", hero.primaryCta, defaults.hero.primaryCta, (c) => patch("hero", { primaryCta: c }))}
        {ctaFields("hero-secondary", "İkinci buton", hero.secondaryCta, defaults.hero.secondaryCta, (c) => patch("hero", { secondaryCta: c }))}
        <div className="grid gap-4 sm:grid-cols-2">
          <ImageUploadField id={id("hero-image")} label="Görsel" value={hero.imageUrl} onChange={(url) => patch("hero", { imageUrl: url })} />
          {textField("hero-image-alt", "Görsel alternatif metni", hero.imageAlt, "Görseli kısaca tanımlayın", (t) => patch("hero", { imageAlt: t }))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {textField("hero-card-title", "Görsel üstü kart — başlık", hero.cardTitle, defaults.hero.cardTitle, (t) => patch("hero", { cardTitle: t }))}
          {textField("hero-card-text", "Görsel üstü kart — alt metin", hero.cardText, defaults.hero.cardText, (t) => patch("hero", { cardText: t }))}
        </div>
      </SectionCard>

      <SectionCard
        title="Güven şeridi"
        description="1–4 madde; masaüstünde yan yana gösterilir."
        toggle={{ id: id("trust-enabled"), checked: trust.enabled, onChange: (enabled) => patch("trust", { enabled }) }}
      >
        {itemList("trust", trust.items, HOME_MIN_TRUST_ITEMS, HOME_MAX_TRUST_ITEMS, "Madde", (items) => patch("trust", { items }))}
      </SectionCard>

      <SectionCard
        title="Uzmanlıklar"
        description="Kartlar Tele-Sağlık → Uzmanlıklar'daki aktif uzmanlıklardan, oradaki sırayla otomatik gelir."
        toggle={{ id: id("specialties-enabled"), checked: specialties.enabled, onChange: (enabled) => patch("specialties", { enabled }) }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {textField("specialties-eyebrow", "Üst etiket", specialties.eyebrow, defaults.specialties.eyebrow, (t) => patch("specialties", { eyebrow: t }))}
          {textField("specialties-title", "Başlık", specialties.title, defaults.specialties.title, (t) => patch("specialties", { title: t }))}
          {textField("specialties-view-all", "“Tümünü gör” bağlantı metni", specialties.viewAllLabel, defaults.specialties.viewAllLabel, (t) =>
            patch("specialties", { viewAllLabel: t })
          )}
          <Field id={id("specialties-columns")} label="Masaüstü kolon sayısı" hint="Mobilde 2, tablette 3 kolon sabittir.">
            {(inputProps) => (
              <Select
                {...inputProps}
                value={String(specialties.columns)}
                onChange={(e) => patch("specialties", { columns: Number(e.target.value) as HomeSpecialtyColumns })}
              >
                {HOME_SPECIALTY_COLUMNS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        title="Nasıl çalışır"
        description="2–4 adım; masaüstünde adımlar arasında kesikli çizgi. Hero'daki #how bağlantısı bu bölüme kaydırır."
        toggle={{ id: id("how-enabled"), checked: how.enabled, onChange: (enabled) => patch("how", { enabled }) }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {textField("how-eyebrow", "Üst etiket", how.eyebrow, defaults.how.eyebrow, (t) => patch("how", { eyebrow: t }))}
          {textField("how-title", "Başlık", how.title, defaults.how.title, (t) => patch("how", { title: t }))}
        </div>
        {itemList("how", how.steps, HOME_MIN_STEPS, HOME_MAX_STEPS, "Adım", (steps) => patch("how", { steps }))}
      </SectionCard>

      <SectionCard
        title="Doktorlar"
        description="Tele-Sağlık → Doktorlar'daki aktif doktorlar, oradaki sırayla."
        toggle={{ id: id("doctors-enabled"), checked: doctors.enabled, onChange: (enabled) => patch("doctors", { enabled }) }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {textField("doctors-eyebrow", "Üst etiket", doctors.eyebrow, defaults.doctors.eyebrow, (t) => patch("doctors", { eyebrow: t }))}
          {textField("doctors-title", "Başlık", doctors.title, defaults.doctors.title, (t) => patch("doctors", { title: t }))}
          {textField("doctors-cta", "Buton metni", doctors.ctaLabel, defaults.doctors.ctaLabel, (t) => patch("doctors", { ctaLabel: t }))}
          <Field id={id("doctors-count")} label="Gösterilecek doktor sayısı" hint={`${HOME_MIN_DOCTORS}–${HOME_MAX_DOCTORS}`}>
            {(inputProps) => (
              <Input
                {...inputProps}
                type="number"
                min={HOME_MIN_DOCTORS}
                max={HOME_MAX_DOCTORS}
                value={doctors.count}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  if (Number.isFinite(n)) patch("doctors", { count: Math.min(HOME_MAX_DOCTORS, Math.max(HOME_MIN_DOCTORS, n)) });
                }}
              />
            )}
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        title="Kapanış bandı"
        description="Altında TeleHealth ayarlarındaki acil durum uyarısının özet metni her zaman gösterilir."
        toggle={{ id: id("closing-enabled"), checked: closing.enabled, onChange: (enabled) => patch("closing", { enabled }) }}
      >
        {textField("closing-title", "Başlık", closing.title, defaults.closing.title, (t) => patch("closing", { title: t }))}
        {ctaFields("closing-primary", "Birinci buton", closing.primaryCta, defaults.closing.primaryCta, (c) => patch("closing", { primaryCta: c }))}
        {ctaFields("closing-secondary", "İkinci buton", closing.secondaryCta, defaults.closing.secondaryCta, (c) => patch("closing", { secondaryCta: c }))}
      </SectionCard>
    </div>
  );
}
