"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { DoctorProfile } from "@/lib/api/types";
import {
  ABOUT_ICON_KEYS,
  ABOUT_MAX_APPROACH_ITEMS,
  ABOUT_MAX_DOCTORS,
  ABOUT_MAX_TREATMENT_ITEMS,
  ABOUT_MIN_DOCTORS,
  buildDefaultAboutContent,
  type AboutCta,
  type AboutIconKey,
  type AboutPageContent,
} from "@/lib/about-page";
import { newId } from "@/lib/page-builder/registry";
import { aboutStrings as enAboutStrings } from "@/lib/i18n/site-dictionaries/en/about";
import { aboutStrings as trAboutStrings } from "@/lib/i18n/site-dictionaries/tr/about";
import { ABOUT_ICONS } from "@/components/site/about/about-icons";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

/** Admin'deki ikon seçicide gösterilen Türkçe adlar (değer = lucide bileşen adı, backend listesiyle aynı). */
const ICON_LABELS: Record<AboutIconKey, string> = {
  Scale: "Terazi (obezite)",
  Ribbon: "Kurdele (onkoloji)",
  Baby: "Bebek (tüp bebek)",
  Smile: "Gülümseme (diş)",
  Scissors: "Makas (saç ekimi)",
  Sparkles: "Parıltı (estetik)",
  Stethoscope: "Steteskop",
  ClipboardCheck: "Onaylı pano",
  Globe: "Dünya",
  HeartPulse: "Kalp atışı",
  Heart: "Kalp",
  Brain: "Beyin",
  Bone: "Kemik",
  Eye: "Göz",
  Activity: "Aktivite",
  ShieldCheck: "Onaylı kalkan",
  ShieldPlus: "Artılı kalkan",
  Syringe: "Şırınga",
  Pill: "İlaç",
  Microscope: "Mikroskop",
  Hospital: "Hastane",
  Users: "Kişiler",
  Handshake: "El sıkışma",
  Plane: "Uçak",
  MapPin: "Konum",
  Award: "Ödül",
  Clock: "Saat",
  MessageCircle: "Mesaj",
  Languages: "Diller",
  BadgeCheck: "Onay rozeti",
  Search: "Büyüteç (arama)",
  Calendar: "Takvim",
  Video: "Video kamera",
  Lock: "Kilit",
};

export function IconSelect({ id, value, onChange }: { id: string; value: AboutIconKey; onChange: (icon: AboutIconKey) => void }) {
  const Icon = ABOUT_ICONS[value];
  return (
    <Field id={id} label="İkon">
      {(inputProps) => (
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <Select {...inputProps} value={value} onChange={(e) => onChange(e.target.value as AboutIconKey)}>
            {ABOUT_ICON_KEYS.map((key) => (
              <option key={key} value={key}>
                {ICON_LABELS[key]}
              </option>
            ))}
          </Select>
        </div>
      )}
    </Field>
  );
}

export function SectionCard({
  title,
  description,
  toggle,
  children,
}: {
  title: string;
  description?: string;
  toggle?: { id: string; checked: boolean; onChange: (checked: boolean) => void };
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="admin-h3">{title}</h3>
          {description && <p className="mt-1 admin-text-secondary">{description}</p>}
        </div>
        {toggle && (
          <div className="flex shrink-0 items-center gap-2">
            <label htmlFor={toggle.id} className="text-sm text-foreground/70">
              Bölümü göster
            </label>
            <Switch id={toggle.id} checked={toggle.checked} onCheckedChange={toggle.onChange} />
          </div>
        )}
      </div>
      {(!toggle || toggle.checked) && children}
    </Card>
  );
}

export function ItemToolbar({
  label,
  index,
  count,
  onMove,
  onRemove,
}: {
  label: string;
  index: number;
  count: number;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-foreground/50">{label}</span>
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Yukarı taşı" onClick={() => onMove(-1)} disabled={index === 0}>
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Aşağı taşı" onClick={() => onMove(1)} disabled={index === count - 1}>
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Sil" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function moveInList<T>(list: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

interface AboutTemplateFormProps {
  /** Aktif dilin DÜZENLENEBİLİR içeriği (boş alanlar `""` — bkz. `toEditableAboutContent`). */
  value: AboutPageContent;
  onChange: (next: AboutPageContent) => void;
  /** Placeholder olarak gösterilecek sözlük varsayılanlarının dili (`tr` → Türkçe, diğerleri → İngilizce). */
  localeCode: string;
  /** Form alanı `id`'lerinin dil sekmeleri arasında çakışmaması için. */
  idPrefix?: string;
}

/**
 * "Hakkımızda" şablonunun yapılandırılmış içerik formu — sayfa bu şablonu kullanıyorsa editör blok
 * tuvali YERİNE bunu gösterir (her rolde). Tasarım kodda sabittir; burada yalnızca içerik düzenlenir.
 * Boş bırakılan her alan sitede sözlükteki varsayılan metinle gösterilir (placeholder'da görünen metin).
 */
export function AboutTemplateForm({ value, onChange, localeCode, idPrefix = "about" }: AboutTemplateFormProps) {
  const defaults = useMemo(
    () => buildDefaultAboutContent(localeCode === "tr" ? trAboutStrings : enAboutStrings),
    [localeCode]
  );
  const [doctors, setDoctors] = useState<DoctorProfile[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    telehealthApi
      .listPublicDoctors({ limit: 100 })
      .then((page) => {
        if (!cancelled) setDoctors(page.items);
      })
      .catch(() => {
        // Tele-sağlık modülü kapalıysa/uç hata verirse seçici yalnızca "Seçilmedi"yi gösterir.
        if (!cancelled) setDoctors([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const id = (key: string) => `${idPrefix}-${key}`;

  function patch<K extends keyof AboutPageContent>(section: K, next: Partial<AboutPageContent[K]>) {
    onChange({ ...value, [section]: { ...value[section], ...next } });
  }

  function textField(key: string, label: string, current: string, placeholder: string, apply: (text: string) => void, multiline = false) {
    return (
      <Field id={id(key)} label={label}>
        {(inputProps) =>
          multiline ? (
            <Textarea {...inputProps} rows={4} value={current} placeholder={placeholder} onChange={(e) => apply(e.target.value)} />
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

  const { hero, treatments, approach, closing } = value;
  const doctorsSection = value.doctors;
  const founderMissing =
    doctorsSection.founderDoctorId !== null && doctors !== null && !doctors.some((d) => d.id === doctorsSection.founderDoctorId);

  return (
    <div className="space-y-6">
      <p className="admin-text-secondary">
        Boş bıraktığınız alanlar sitede gri renkte görünen varsayılan metinle gösterilir. Bağlantılar{" "}
        <code>/doctors</code> gibi site içi bir yol, <code>#doctors</code> gibi sayfa içi bir çapa veya{" "}
        <code>https://</code> ile başlayan bir adres olabilir; site içi yollar ziyaretçinin diline göre otomatik uyarlanır.
      </p>

      <SectionCard title="Giriş (Hero)">
        <div className="grid gap-4 sm:grid-cols-2">
          {textField("hero-eyebrow", "Üst etiket", hero.eyebrow, defaults.hero.eyebrow, (t) => patch("hero", { eyebrow: t }))}
          {textField("hero-title", "Başlık", hero.title, defaults.hero.title, (t) => patch("hero", { title: t }))}
        </div>
        {textField("hero-body", "Paragraf", hero.body, defaults.hero.body, (t) => patch("hero", { body: t }), true)}
        {ctaFields("hero-primary", "Birincil buton", hero.primaryCta, defaults.hero.primaryCta, (c) => patch("hero", { primaryCta: c }))}
        {ctaFields("hero-secondary", "İkincil bağlantı", hero.secondaryCta, defaults.hero.secondaryCta, (c) => patch("hero", { secondaryCta: c }))}
        <div className="grid gap-4 sm:grid-cols-2">
          <ImageUploadField id={id("hero-image")} label="Görsel" value={hero.imageUrl} onChange={(url) => patch("hero", { imageUrl: url })} />
          {textField("hero-image-alt", "Görsel alternatif metni", hero.imageAlt, "Görseli kısaca tanımlayın", (t) => patch("hero", { imageAlt: t }))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {textField("hero-location-title", "Konum kartı — başlık", hero.locationTitle, defaults.hero.locationTitle, (t) => patch("hero", { locationTitle: t }))}
          {textField(
            "hero-location-subtitle",
            "Konum kartı — alt metin",
            hero.locationSubtitle,
            defaults.hero.locationSubtitle,
            (t) => patch("hero", { locationSubtitle: t })
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Tedavi alanları"
        description={`En fazla ${ABOUT_MAX_TREATMENT_ITEMS} kart. Liste boş kalırsa varsayılan kartlar gösterilir.`}
        toggle={{ id: id("treatments-enabled"), checked: treatments.enabled, onChange: (enabled) => patch("treatments", { enabled }) }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {textField("treatments-eyebrow", "Üst etiket", treatments.eyebrow, defaults.treatments.eyebrow, (t) => patch("treatments", { eyebrow: t }))}
          {textField("treatments-title", "Başlık", treatments.title, defaults.treatments.title, (t) => patch("treatments", { title: t }))}
        </div>
        {textField("treatments-body", "Paragraf", treatments.body, defaults.treatments.body, (t) => patch("treatments", { body: t }), true)}

        <div className="space-y-3">
          {treatments.items.map((item, index) => (
            <div key={item.id} className="space-y-3 rounded-lg border border-border/60 p-3">
              <ItemToolbar
                label={`Kart ${index + 1}`}
                index={index}
                count={treatments.items.length}
                onMove={(direction) => patch("treatments", { items: moveInList(treatments.items, index, direction) })}
                onRemove={() => patch("treatments", { items: treatments.items.filter((i) => i.id !== item.id) })}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                {textField(`treatment-${item.id}-name`, "Alan adı", item.name, "Ör. Diş tedavileri", (t) =>
                  patch("treatments", { items: treatments.items.map((i) => (i.id === item.id ? { ...i, name: t } : i)) })
                )}
                <IconSelect
                  id={id(`treatment-${item.id}-icon`)}
                  value={item.icon}
                  onChange={(icon) => patch("treatments", { items: treatments.items.map((i) => (i.id === item.id ? { ...i, icon } : i)) })}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={treatments.items.length >= ABOUT_MAX_TREATMENT_ITEMS}
            onClick={() => patch("treatments", { items: [...treatments.items, { id: newId(), name: "", icon: "BadgeCheck" }] })}
          >
            <Plus className="h-3.5 w-3.5" />
            Kart ekle
          </Button>
          {treatments.items.length === 0 && (
            <Button type="button" variant="ghost" onClick={() => patch("treatments", { items: defaults.treatments.items.map((i) => ({ ...i, id: newId() })) })}>
              <RotateCcw className="h-3.5 w-3.5" />
              Varsayılan kartları düzenlemeye al
            </Button>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Why WM Health (Yaklaşımımız)"
        description={`En fazla ${ABOUT_MAX_APPROACH_ITEMS} madde. Numaralar (01, 02…) sıraya göre otomatik verilir. Liste boş kalırsa varsayılan maddeler gösterilir.`}
        toggle={{ id: id("approach-enabled"), checked: approach.enabled, onChange: (enabled) => patch("approach", { enabled }) }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {textField("approach-eyebrow", "Üst etiket", approach.eyebrow, defaults.approach.eyebrow, (t) => patch("approach", { eyebrow: t }))}
          {textField("approach-title", "Başlık", approach.title, defaults.approach.title, (t) => patch("approach", { title: t }))}
        </div>

        <div className="space-y-3">
          {approach.items.map((item, index) => (
            <div key={item.id} className="space-y-3 rounded-lg border border-border/60 p-3">
              <ItemToolbar
                label={`Madde ${String(index + 1).padStart(2, "0")}`}
                index={index}
                count={approach.items.length}
                onMove={(direction) => patch("approach", { items: moveInList(approach.items, index, direction) })}
                onRemove={() => patch("approach", { items: approach.items.filter((i) => i.id !== item.id) })}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                {textField(`approach-${item.id}-title`, "Başlık", item.title, "Madde başlığı", (t) =>
                  patch("approach", { items: approach.items.map((i) => (i.id === item.id ? { ...i, title: t } : i)) })
                )}
                <IconSelect
                  id={id(`approach-${item.id}-icon`)}
                  value={item.icon}
                  onChange={(icon) => patch("approach", { items: approach.items.map((i) => (i.id === item.id ? { ...i, icon } : i)) })}
                />
              </div>
              {textField(
                `approach-${item.id}-body`,
                "Metin",
                item.body,
                "Kısa açıklama",
                (t) => patch("approach", { items: approach.items.map((i) => (i.id === item.id ? { ...i, body: t } : i)) }),
                true
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={approach.items.length >= ABOUT_MAX_APPROACH_ITEMS}
            onClick={() => patch("approach", { items: [...approach.items, { id: newId(), title: "", body: "", icon: "BadgeCheck" }] })}
          >
            <Plus className="h-3.5 w-3.5" />
            Madde ekle
          </Button>
          {approach.items.length === 0 && (
            <Button type="button" variant="ghost" onClick={() => patch("approach", { items: defaults.approach.items.map((i) => ({ ...i, id: newId() })) })}>
              <RotateCcw className="h-3.5 w-3.5" />
              Varsayılan maddeleri düzenlemeye al
            </Button>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Doktorlar"
        description="Aktif doktorlar doktor listesindeki sırayla gösterilir; kurucu seçilirse her zaman ilk sırada ve etiketli görünür."
        toggle={{ id: id("doctors-enabled"), checked: doctorsSection.enabled, onChange: (enabled) => patch("doctors", { enabled }) }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {textField("doctors-eyebrow", "Üst etiket", doctorsSection.eyebrow, defaults.doctors.eyebrow, (t) => patch("doctors", { eyebrow: t }))}
          {textField("doctors-title", "Başlık", doctorsSection.title, defaults.doctors.title, (t) => patch("doctors", { title: t }))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {textField("doctors-cta", "Buton metni", doctorsSection.ctaLabel, defaults.doctors.ctaLabel, (t) => patch("doctors", { ctaLabel: t }))}
          <Field id={id("doctors-count")} label="Gösterilecek doktor sayısı">
            {(inputProps) => (
              <Select {...inputProps} value={String(doctorsSection.count)} onChange={(e) => patch("doctors", { count: Number(e.target.value) })}>
                {Array.from({ length: ABOUT_MAX_DOCTORS - ABOUT_MIN_DOCTORS + 1 }, (_, i) => ABOUT_MIN_DOCTORS + i).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id={id("doctors-founder")}
            label="Kurucu doktor"
            hint={founderMissing ? "Seçili doktor artık aktif değil — sitede kurucu etiketi gösterilmez." : "Boş bırakılabilir."}
          >
            {(inputProps) => (
              <Select
                {...inputProps}
                value={doctorsSection.founderDoctorId ?? ""}
                disabled={doctors === null}
                onChange={(e) => patch("doctors", { founderDoctorId: e.target.value || null })}
              >
                <option value="">Seçilmedi</option>
                {founderMissing && <option value={doctorsSection.founderDoctorId ?? ""}>(Aktif olmayan doktor)</option>}
                {(doctors ?? []).map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.title} {doctor.fullName}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {textField("doctors-founder-label", "Kurucu etiketi", doctorsSection.founderLabel, defaults.doctors.founderLabel, (t) =>
            patch("doctors", { founderLabel: t })
          )}
        </div>
      </SectionCard>

      <SectionCard title="Kapanış bandı">
        {textField("closing-title", "Başlık", closing.title, defaults.closing.title, (t) => patch("closing", { title: t }))}
        {ctaFields("closing-primary", "Birincil buton", closing.primaryCta, defaults.closing.primaryCta, (c) => patch("closing", { primaryCta: c }))}
        {ctaFields("closing-secondary", "İkincil buton", closing.secondaryCta, defaults.closing.secondaryCta, (c) => patch("closing", { secondaryCta: c }))}
      </SectionCard>
    </div>
  );
}
