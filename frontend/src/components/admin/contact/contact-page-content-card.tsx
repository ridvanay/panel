"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Globe, Plus, Trash2 } from "lucide-react";
import * as contactApi from "@/lib/api/contact";
import { ApiClientError } from "@/lib/api/error";
import type { ContactPageContent, ContactPageLocale, ContactPageLocaleContent, Media } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { MediaSelectField } from "@/components/admin/media/media-select-field";
import { SegmentedToggle } from "@/components/admin/page-builder/blocks/segmented-toggle";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const LOCALES: { code: ContactPageLocale; label: string }[] = [
  { code: "tr", label: "Türkçe" },
  { code: "en", label: "English" },
];
const MAX_HOURS_ROWS = 10;

const EMPTY_LOCALE: ContactPageLocaleContent = {
  title: "",
  intro: "",
  phone: "",
  whatsapp: "",
  email: "",
  address: "",
  hours: [],
  responseTime: "",
};

function normalize(content: ContactPageContent): ContactPageContent {
  return {
    locales: { tr: { ...EMPTY_LOCALE, ...content.locales.tr }, en: { ...EMPTY_LOCALE, ...content.locales.en } },
    mapImageMediaId: content.mapImageMediaId ?? null,
    mapUrl: content.mapUrl ?? "",
  };
}

/** `MediaSelectField` bir `Media` bekler; kayıtta yalnızca id + URL var — önizleme için asgari nesne. */
function mediaFromUrl(id: string | null, url: string | null): Media | null {
  if (!id || !url) return null;
  return { id, url, filename: "", mimeType: "", sizeBytes: 0, altText: null, width: null, height: null, folderId: null, createdAt: "" } as Media;
}

/**
 * Admin → İletişim → "İletişim sayfası" (`/contact`). Dil başına (TR/EN) başlık, giriş metni,
 * telefon, WhatsApp, e-posta, adres, çalışma saatleri ve yanıt süresi; ortak harita görseli ve
 * Google Haritalar bağlantısı. Boş bırakılan metin alanları sitede sözlük varsayılanını, boş
 * iletişim kanalları hiç gösterilmez. Harita bilinçli olarak iframe DEĞİL (üçüncü taraf çerez yok).
 */
export function ContactPageContentCard() {
  const [content, setContent] = useState<ContactPageContent | null>(null);
  const [mapImage, setMapImage] = useState<Media | null>(null);
  const [activeLocale, setActiveLocale] = useState<ContactPageLocale>("tr");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await contactApi.getAdminContactPage();
      setContent(normalize(data.content));
      setMapImage(mediaFromUrl(data.content.mapImageMediaId, data.mapImageUrl));
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  if (loadError) {
    return (
      <Card>
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {loadError}
          </span>
        </Alert>
      </Card>
    );
  }
  if (!content) {
    return (
      <Card className="flex justify-center py-10">
        <Spinner className="h-5 w-5 text-primary" />
      </Card>
    );
  }

  const localeContent = content.locales[activeLocale] ?? EMPTY_LOCALE;
  const err = (path: string) => fieldErrors[`locales.${activeLocale}.${path}`];

  function patchLocale(patch: Partial<ContactPageLocaleContent>) {
    setContent((prev) =>
      prev ? { ...prev, locales: { ...prev.locales, [activeLocale]: { ...(prev.locales[activeLocale] ?? EMPTY_LOCALE), ...patch } } } : prev
    );
  }

  async function save() {
    if (!content) return;
    setSaving(true);
    setFieldErrors({});
    try {
      const updated = await contactApi.updateAdminContactPage({ ...content, mapImageMediaId: mapImage?.id ?? null });
      setContent(normalize(updated.content));
      setMapImage(mediaFromUrl(updated.content.mapImageMediaId, updated.mapImageUrl));
      toast.success("İletişim sayfası kaydedildi.");
    } catch (error) {
      if (error instanceof ApiClientError && error.details) {
        setFieldErrors(Object.fromEntries(Object.entries(error.details).map(([key, messages]) => [key, messages[0] ?? ""])));
      }
      toast.error(friendlyErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const fid = (name: string) => `contact-page-${activeLocale}-${name}`;

  return (
    <Card className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Globe className="h-4 w-4" />
        </span>
        <div>
          <h2 className="admin-h2">İletişim sayfası (/contact)</h2>
          <p className="mt-0.5 admin-text-secondary">
            Sayfa metinleri ve iletişim bilgileri dil başına ayrı düzenlenir. Boş metin alanlarında sitenin varsayılan metni,
            boş iletişim kanallarında (telefon, WhatsApp, e-posta, adres) hiçbir şey gösterilmez. Gizlilik bağlantısı aşağıdaki
            &quot;Aydınlatma metni sayfası&quot; seçiminden gelir.
          </p>
        </div>
      </div>

      <SegmentedToggle value={activeLocale} options={LOCALES.map((l) => ({ value: l.code, label: l.label }))} onChange={setActiveLocale} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field id={fid("title")} label="Başlık" hint="Boşsa: “Contact us” / “Bize ulaşın”." error={err("title")}>
            {(p) => <Input {...p} maxLength={120} value={localeContent.title} onChange={(e) => patchLocale({ title: e.target.value })} />}
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field id={fid("intro")} label="Alt metin" error={err("intro")}>
            {(p) => <Textarea {...p} rows={2} maxLength={300} value={localeContent.intro} onChange={(e) => patchLocale({ intro: e.target.value })} />}
          </Field>
        </div>
        <Field id={fid("phone")} label="Telefon" hint="Ülke koduyla, ör. +90 212 000 00 00" error={err("phone")}>
          {(p) => <Input {...p} type="tel" maxLength={30} value={localeContent.phone} onChange={(e) => patchLocale({ phone: e.target.value })} />}
        </Field>
        <Field id={fid("whatsapp")} label="WhatsApp numarası" hint="Ülke koduyla, ör. +90 555 000 00 00" error={err("whatsapp")}>
          {(p) => <Input {...p} type="tel" maxLength={20} value={localeContent.whatsapp} onChange={(e) => patchLocale({ whatsapp: e.target.value })} />}
        </Field>
        <Field id={fid("email")} label="E-posta" error={err("email")}>
          {(p) => <Input {...p} type="email" maxLength={254} value={localeContent.email} onChange={(e) => patchLocale({ email: e.target.value })} />}
        </Field>
        <Field id={fid("responseTime")} label="Yanıt süresi metni" hint="Gönder düğmesinin yanında. Boşsa varsayılan metin." error={err("responseTime")}>
          {(p) => (
            <Input {...p} maxLength={160} value={localeContent.responseTime} onChange={(e) => patchLocale({ responseTime: e.target.value })} />
          )}
        </Field>
        <div className="sm:col-span-2">
          <Field id={fid("address")} label="Adres" error={err("address")}>
            {(p) => <Textarea {...p} rows={2} maxLength={300} value={localeContent.address} onChange={(e) => patchLocale({ address: e.target.value })} />}
          </Field>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Çalışma saatleri</p>
        {localeContent.hours.length === 0 && <p className="text-xs text-foreground/60">Satır yoksa &quot;Çalışma saatleri&quot; kartı gösterilmez.</p>}
        {localeContent.hours.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              className="flex-1"
              aria-label={`Satır ${index + 1}: gün(ler)`}
              maxLength={60}
              placeholder="Pazartesi – Cuma"
              value={row.label}
              onChange={(e) => patchLocale({ hours: localeContent.hours.map((h, i) => (i === index ? { ...h, label: e.target.value } : h)) })}
            />
            <Input
              className="flex-1"
              aria-label={`Satır ${index + 1}: saat`}
              maxLength={60}
              placeholder="09:00 – 18:00"
              value={row.value}
              onChange={(e) => patchLocale({ hours: localeContent.hours.map((h, i) => (i === index ? { ...h, value: e.target.value } : h)) })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Satır ${index + 1}'i sil`}
              onClick={() => patchLocale({ hours: localeContent.hours.filter((_, i) => i !== index) })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {err("hours") && <p className="text-xs text-danger">{err("hours")}</p>}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={localeContent.hours.length >= MAX_HOURS_ROWS}
          onClick={() => patchLocale({ hours: [...localeContent.hours, { label: "", value: "" }] })}
        >
          <Plus className="h-4 w-4" />
          Satır ekle
        </Button>
      </div>

      <div className="space-y-4 rounded-lg border border-border p-4">
        <p className="text-sm font-medium text-foreground">Harita (tüm diller)</p>
        <MediaSelectField
          id="contact-page-map-image"
          label="Harita görseli"
          value={mapImage}
          onChange={setMapImage}
          accept="image/png,image/jpeg,image/webp"
          hint="Statik harita ekran görüntüsü (PNG/JPG/WebP). Google Maps iframe'i kullanılmaz — ziyaretçiye üçüncü taraf çerez yüklenmez."
        />
        <Field
          id="contact-page-map-url"
          label="Google Haritalar bağlantısı"
          hint="“Google Haritalar'da aç” düğmesinin hedefi. Yalnızca https://www.google.com/maps/…, https://maps.google.com/… veya https://maps.app.goo.gl/… kabul edilir. Boşsa adres üzerinden arama bağlantısı üretilir."
          error={fieldErrors.mapUrl}
        >
          {(p) => (
            <Input
              {...p}
              type="url"
              maxLength={500}
              placeholder="https://maps.app.goo.gl/…"
              value={content.mapUrl}
              onChange={(e) => setContent((prev) => (prev ? { ...prev, mapUrl: e.target.value } : prev))}
            />
          )}
        </Field>
      </div>

      <div className="flex justify-end">
        <Button type="button" loading={saving} onClick={() => void save()}>
          İletişim Sayfasını Kaydet
        </Button>
      </div>
    </Card>
  );
}
