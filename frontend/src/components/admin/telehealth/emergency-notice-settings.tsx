"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Info, RotateCcw, Siren } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { EmergencyNoticeSettings, UpdateEmergencyNoticeRequest } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { telehealthStrings as enTelehealthStrings } from "@/lib/i18n/site-dictionaries/en/telehealth";
import { telehealthStrings as trTelehealthStrings } from "@/lib/i18n/site-dictionaries/tr/telehealth";
import {
  EMERGENCY_NOTICE_FULL_MAX,
  EMERGENCY_NOTICE_SUMMARY_MAX,
  validateEmergencyNoticeText,
} from "@/lib/emergency-notice";

/**
 * Admin → TeleHealth ayarları → "Acil durum uyarısı" kartı (`PATCH /admin/telehealth/settings/emergency-notice`).
 * YALNIZCA ADMIN değiştirebilir (backend de 403 döner); diğer roller kartı salt-okunur görür.
 * Anahtar yalnızca `/doctors*` ve `/specialties*` sayfalarındaki şeridi kontrol eder — görüşme
 * ekranındaki şerit ve doktor detay sayfasındaki kart her zaman gösterilir. EN metinler "emergency",
 * TR metinler "acil" kelimesini içermek zorundadır (backend de 422 döner). Metinler boş
 * bırakılamaz; "Varsayılana dön" o dilin özel metnini siler (sözlük varsayılanı).
 */

type NoticeLocale = "tr" | "en";

const NOTICE_LOCALES: { code: NoticeLocale; label: string; defaults: { summary: string; full: string } }[] = [
  {
    code: "tr",
    label: "Türkçe",
    defaults: { summary: trTelehealthStrings.emergencyNoticeSummary, full: trTelehealthStrings.emergencyNoticeFull },
  },
  {
    code: "en",
    label: "English",
    defaults: { summary: enTelehealthStrings.emergencyNoticeSummary, full: enTelehealthStrings.emergencyNoticeFull },
  },
];

type TextKind = "summary" | "full";
type TextForm = Record<NoticeLocale, Record<TextKind, string>>;

function effectiveTexts(settings: EmergencyNoticeSettings): TextForm {
  const form = {} as TextForm;
  for (const locale of NOTICE_LOCALES) {
    form[locale.code] = {
      summary: settings.summary[locale.code] ?? locale.defaults.summary,
      full: settings.full[locale.code] ?? locale.defaults.full,
    };
  }
  return form;
}

export function EmergencyNoticeSettingsCard({
  settings,
  canEdit,
  onSaved,
}: {
  settings: EmergencyNoticeSettings;
  canEdit: boolean;
  onSaved: (settings: EmergencyNoticeSettings) => void;
}) {
  const [texts, setTexts] = useState<TextForm>(() => effectiveTexts(settings));
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [togglePending, setTogglePending] = useState(false);
  const [confirmDisableOpen, setConfirmDisableOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<NoticeLocale | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const baseline = effectiveTexts(settings);
  const dirty = JSON.stringify(baseline) !== JSON.stringify(texts);

  async function submit(patch: UpdateEmergencyNoticeRequest, successMessage: string): Promise<boolean> {
    setSaveError(null);
    try {
      const updated = await telehealthApi.updateEmergencyNoticeSettings(patch);
      const next = updated.emergencyNotice ?? { enabled: true, summary: {}, full: {} };
      onSaved(next);
      setTexts(effectiveTexts(next));
      toast.success(successMessage);
      return true;
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setSaveError(message);
      toast.error(message);
      return false;
    }
  }

  async function setEnabled(enabled: boolean) {
    setTogglePending(true);
    const ok = await submit({ enabled }, enabled ? "Acil durum uyarısı şeridi açıldı." : "Acil durum uyarısı şeridi kapatıldı.");
    setTogglePending(false);
    if (ok) setConfirmDisableOpen(false);
  }

  function handleToggle(next: boolean) {
    // Kapatmak hukuki/uyum sonucu olan bir işlem — onay iste. Açmak doğrudan.
    if (!next) {
      setConfirmDisableOpen(true);
      return;
    }
    void setEnabled(true);
  }

  async function handleSaveTexts() {
    const nextErrors: Record<string, string> = {};
    for (const locale of NOTICE_LOCALES) {
      for (const kind of ["summary", "full"] as const) {
        const error = validateEmergencyNoticeText(texts[locale.code][kind], kind, locale.code);
        if (error) nextErrors[`${locale.code}.${kind}`] = error;
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    // Yalnızca DEĞİŞEN alanlar gönderilir; varsayılanla aynı ve özel metni olmayan alan varsayılana bağlı kalır.
    const patch: UpdateEmergencyNoticeRequest = {};
    for (const locale of NOTICE_LOCALES) {
      for (const kind of ["summary", "full"] as const) {
        const value = texts[locale.code][kind].trim();
        if (value === baseline[locale.code][kind]) continue;
        const map = (patch[kind] ??= {});
        map[locale.code] = value;
      }
    }
    if (!patch.summary && !patch.full) return;

    setSaving(true);
    await submit(patch, "Acil durum uyarısı metinleri kaydedildi.");
    setSaving(false);
  }

  async function handleReset(code: NoticeLocale) {
    setSaving(true);
    const ok = await submit({ summary: { [code]: null }, full: { [code]: null } }, "Varsayılan metinlere dönüldü.");
    setSaving(false);
    if (ok) {
      setResetTarget(null);
      setErrors((prev) => ({ ...prev, [`${code}.summary`]: undefined, [`${code}.full`]: undefined }));
    }
  }

  function updateText(code: NoticeLocale, kind: TextKind, value: string) {
    setTexts((prev) => ({ ...prev, [code]: { ...prev[code], [kind]: value } }));
  }

  const resetLocale = NOTICE_LOCALES.find((l) => l.code === resetTarget);

  return (
    <Card className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
          <Siren className="h-4 w-4" />
        </span>
        <div>
          <h2 className="admin-h2">Acil Durum Uyarısı</h2>
          <p className="mt-0.5 admin-text-secondary">
            Doktor, uzmanlık ve görüşme sayfalarında header altında gösterilen uyarı şeridi ve metinleri. İngilizce
            metinler &quot;emergency&quot;, Türkçe metinler &quot;acil&quot; kelimesini içermelidir.
          </p>
        </div>
      </div>

      {!canEdit && (
        <Alert variant="info">
          <span className="flex items-center gap-2">
            <Info className="h-4 w-4 shrink-0" />
            Bu ayarları yalnızca Yönetici (ADMIN) rolü değiştirebilir.
          </span>
        </Alert>
      )}

      {saveError && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {saveError}
          </span>
        </Alert>
      )}

      <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
        <div className="space-y-1">
          <label htmlFor="emergency-notice-enabled" className="text-sm font-medium text-foreground">
            Acil durum uyarısını göster
          </label>
          <p id="emergency-notice-enabled-help" className="text-xs leading-relaxed text-foreground/60">
            Kapatırsanız doktorlar ve uzmanlıklar sayfalarındaki üst uyarı şeridi gizlenir. Görüşme ekranındaki
            şerit ve doktor detay sayfasında randevu formunun üstündeki uyarı kartı her zaman gösterilmeye devam eder.
          </p>
        </div>
        <Switch
          id="emergency-notice-enabled"
          aria-describedby="emergency-notice-enabled-help"
          checked={settings.enabled}
          disabled={!canEdit || togglePending}
          onCheckedChange={(next) => handleToggle(next)}
          className="mt-1"
        />
      </div>

      <div className="space-y-5">
        {NOTICE_LOCALES.map((locale) => {
          const hasOverride = settings.summary[locale.code] !== undefined || settings.full[locale.code] !== undefined;
          const summaryId = `emergency-notice-${locale.code}-summary`;
          const fullId = `emergency-notice-${locale.code}-full`;
          const summaryError = errors[`${locale.code}.summary`];
          const fullError = errors[`${locale.code}.full`];
          return (
            <fieldset key={locale.code} className="space-y-3 rounded-lg border border-border p-4">
              <legend className="px-1 text-sm font-semibold text-foreground">
                {locale.label}{" "}
                <span className="font-normal text-foreground/60">({hasOverride ? "özel metin" : "varsayılan metin"})</span>
              </legend>

              <div className="space-y-1.5">
                <label htmlFor={summaryId} className="text-sm font-medium text-foreground">
                  Özet (şeridin kapalı hâli)
                </label>
                <Input
                  id={summaryId}
                  value={texts[locale.code].summary}
                  maxLength={EMERGENCY_NOTICE_SUMMARY_MAX}
                  disabled={!canEdit || saving}
                  aria-invalid={summaryError ? true : undefined}
                  aria-describedby={`${summaryId}-count`}
                  onChange={(e) => updateText(locale.code, "summary", e.target.value)}
                />
                <div className="flex justify-between gap-2 text-xs">
                  <span className="text-danger">{summaryError}</span>
                  <span id={`${summaryId}-count`} className="shrink-0 text-foreground/60">
                    {texts[locale.code].summary.trim().length}/{EMERGENCY_NOTICE_SUMMARY_MAX}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor={fullId} className="text-sm font-medium text-foreground">
                  Tam metin (şeridin açık hâli ve doktor detay kartı)
                </label>
                <Textarea
                  id={fullId}
                  value={texts[locale.code].full}
                  maxLength={EMERGENCY_NOTICE_FULL_MAX}
                  rows={3}
                  disabled={!canEdit || saving}
                  aria-invalid={fullError ? true : undefined}
                  aria-describedby={`${fullId}-count`}
                  onChange={(e) => updateText(locale.code, "full", e.target.value)}
                />
                <div className="flex justify-between gap-2 text-xs">
                  <span className="text-danger">{fullError}</span>
                  <span id={`${fullId}-count`} className="shrink-0 text-foreground/60">
                    {texts[locale.code].full.trim().length}/{EMERGENCY_NOTICE_FULL_MAX}
                  </span>
                </div>
              </div>

              {canEdit && hasOverride && (
                <div className="flex justify-end">
                  <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => setResetTarget(locale.code)}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Varsayılana dön
                  </Button>
                </div>
              )}
            </fieldset>
          );
        })}
      </div>

      {canEdit && (
        <div className="flex justify-end">
          <Button type="button" loading={saving} disabled={!dirty} onClick={() => void handleSaveTexts()}>
            Metinleri Kaydet
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmDisableOpen}
        onOpenChange={setConfirmDisableOpen}
        title="Acil durum uyarısı şeridi kapatılsın mı?"
        description="Doktorlar ve uzmanlıklar sayfalarındaki üst uyarı şeridi ziyaretçilere gösterilmeyecek. Görüşme ekranındaki şerit ve doktor detay sayfasındaki uyarı kartı görünmeye devam eder. Bu değişiklik denetim kaydına yazılır; kapatmadan önce hukuki değerlendirme yapılması önerilir."
        confirmText="Şeridi Kapat"
        tone="warning"
        loading={togglePending}
        onConfirm={() => void setEnabled(false)}
      />

      {resetLocale && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setResetTarget(null)}
          title={`${resetLocale.label} metinleri varsayılana dönsün mü?`}
          description="Özel özet ve tam metin silinir; sitede varsayılan metinler gösterilir."
          confirmText="Varsayılana Dön"
          tone="warning"
          loading={saving}
          onConfirm={() => void handleReset(resetLocale.code)}
        />
      )}
    </Card>
  );
}
