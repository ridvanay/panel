"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Palette } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { EmergencyNoticeSettings, TelehealthThemeSettings, UpdateTelehealthThemeSettingsRequest } from "@/lib/api/types";
import { PageHeading } from "@/components/admin/page-heading";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { ColorField } from "@/components/admin/appearance/color-field";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";
import { useAuth } from "@/context/auth-context";
import { EmergencyNoticeSettingsCard } from "@/components/admin/telehealth/emergency-notice-settings";
import { DEFAULT_EMERGENCY_NOTICE_SETTINGS } from "@/lib/emergency-notice";

/**
 * Görev (2026-09-14) Görev 1 — "Arayüz & Tema Renkleri" sekmesi. `/admin/telehealth/overview`
 * (yükleme/hata deseni) + `/admin/appearance` (ColorField + canlı önizleme, `updateAppearance`
 * kaydetme deseni) İLE AYNI iskelet — YENİDEN İCAT edilmedi. `GET/PATCH /admin/telehealth/settings`
 * kontratı `.claude` görev notunda KESİNLEŞTİ: `PATCH` yalnızca ADMIN/MANAGER (EDITOR → 403,
 * backend zaten reddeder; bu sayfa panel kapısına ADMIN/MANAGER/EDITOR girebilir çünkü `GET`
 * `ROLES_PANEL`'dir — EDITOR sayfayı GÖRÜR ama sidebar girdisi `roles: ["ADMIN", "MANAGER"]`
 * olduğu için doğrudan URL dışında buraya gelmez; yine de "Kaydet" 403 verirse toast'ta
 * `friendlyErrorMessage` gösterilir, sayfa ÇÖKMEZ).
 */

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

type ThemeColorForm = Required<UpdateTelehealthThemeSettingsRequest>;
type ThemeColorKey = keyof ThemeColorForm;

/** Renk formu YALNIZCA 4 renk alanını taşır — `emergencyNotice` ayrı kartta, ayrı uç noktayla kaydedilir. */
function toColorForm(settings: TelehealthThemeSettings): ThemeColorForm {
  return {
    primaryColor: settings.primaryColor,
    secondaryColor: settings.secondaryColor,
    accentColor: settings.accentColor,
    calendarActiveBg: settings.calendarActiveBg,
  };
}

const COLOR_FIELD_DEFS: { key: ThemeColorKey; label: string }[] = [
  { key: "primaryColor", label: "Birincil Renk" },
  { key: "secondaryColor", label: "İkincil Renk" },
  { key: "accentColor", label: "Vurgu Rengi" },
  { key: "calendarActiveBg", label: "Takvim Seçili Gün Rengi" },
];

export default function AdminTelehealthSettingsPage() {
  const { user } = useAuth();
  const [theme, setTheme] = useState<ThemeColorForm | null>(null);
  const [form, setForm] = useState<ThemeColorForm | null>(null);
  const [emergencyNotice, setEmergencyNotice] = useState<EmergencyNoticeSettings>(DEFAULT_EMERGENCY_NOTICE_SETTINGS);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await telehealthApi.getTelehealthThemeSettings();
      setTheme(toColorForm(data));
      setForm(toColorForm(data));
      setEmergencyNotice(data.emergencyNotice ?? DEFAULT_EMERGENCY_NOTICE_SETTINGS);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  function updateField(key: ThemeColorKey, value: string) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSave() {
    if (!form) return;
    const invalidField = COLOR_FIELD_DEFS.find((def) => !HEX_REGEX.test(form[def.key]));
    if (invalidField) {
      setFieldErrors({ [invalidField.key]: "Geçerli bir hex renk kodu girin (#rrggbb)." });
      return;
    }
    setSaveError(null);
    setFieldErrors({});
    setSaving(true);
    try {
      const updated = await telehealthApi.updateTelehealthThemeSettings(form);
      setTheme(toColorForm(updated));
      setForm(toColorForm(updated));
      setEmergencyNotice(updated.emergencyNotice ?? DEFAULT_EMERGENCY_NOTICE_SETTINGS);
      toast.success("Tema renkleri kaydedildi.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setSaveError(message);
      setFieldErrors(fieldErrorsFrom(err));
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const dirty = theme !== null && form !== null && JSON.stringify(theme) !== JSON.stringify(form);

  if (loadError) {
    return (
      <div className="space-y-6">
        <PageHeading icon={Palette} title="Arayüz & Tema Renkleri" description="Randevu sihirbazının renklerini yönetin." />
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {loadError}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="space-y-6">
        <PageHeading icon={Palette} title="Arayüz & Tema Renkleri" description="Randevu sihirbazının renklerini yönetin." />
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeading
        icon={Palette}
        title="Arayüz & Tema Renkleri"
        description="Randevu sihirbazının (/doctors/[slug]) birincil/ikincil/vurgu renklerini ve takvim seçili gün rengini yönetin."
      />

      {saveError && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {saveError}
          </span>
        </Alert>
      )}

      <Card className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {COLOR_FIELD_DEFS.map((def) => (
            <div key={def.key}>
              <ColorField
                id={`telehealth-theme-${def.key}`}
                label={def.label}
                value={form[def.key]}
                onChange={(hex) => updateField(def.key, hex)}
              />
              {fieldErrors[def.key] && <p className="mt-1 text-xs text-danger">{fieldErrors[def.key]}</p>}
            </div>
          ))}
        </div>
      </Card>

      {/* Canlı Mini Önizleme — form state'inden DOĞRUDAN inline style, Tailwind/CSS değişken
          sistemine BAĞLANMAZ (izole, basit önizleme). Kaydet'e basmadan güncellenir. */}
      <Card className="space-y-4">
        <div>
          <h2 className="admin-h2">Canlı Mini Önizleme</h2>
          <p className="mt-0.5 admin-text-secondary">Kaydetmeden önce renklerin nasıl görüneceğini kontrol edin.</p>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground/60">Örnek Buton (Birincil Renk)</p>
            <button
              type="button"
              disabled
              className="cursor-default rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: form.primaryColor }}
            >
              Devam Et
            </button>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground/60">Takvim Günü (Seçili Gün Rengi)</p>
            <span
              className="flex h-10 w-10 items-center justify-center rounded-md text-sm font-semibold text-white"
              style={{ backgroundColor: form.calendarActiveBg }}
            >
              16
            </span>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground/60">Rozet (Vurgu Rengi)</p>
            <span
              className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold text-white"
              style={{ backgroundColor: form.accentColor }}
            >
              Yeni
            </span>
          </div>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="button" loading={saving} disabled={!dirty} onClick={() => void handleSave()}>
          Kaydet
        </Button>
      </div>

      <EmergencyNoticeSettingsCard
        key={JSON.stringify(emergencyNotice)}
        settings={emergencyNotice}
        canEdit={user?.role === "ADMIN"}
        onSaved={setEmergencyNotice}
      />
    </div>
  );
}
