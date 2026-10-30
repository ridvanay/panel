"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Globe, Info } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { LanguageSupportSettings } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { nativeLanguageName } from "@/lib/language-support";
import { cn } from "@/lib/utils";

/** Sitenin 9 arayüz dili — destek dili olarak hızlı seçim; ek diller kodla eklenebilir. */
export const SUPPORT_LANGUAGE_CHOICES = ["en", "tr", "de", "es", "fr", "ar", "ru", "ro", "sr-latn"] as const;
const LOCALE_CODE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;
const HOURS_MAX = 120;

interface FormState {
  languages: string[];
  hours: Record<string, string>;
  interpreterIncluded: boolean;
}

function toForm(settings: LanguageSupportSettings): FormState {
  return { languages: [...settings.supportLanguages], hours: { ...settings.supportHours }, interpreterIncluded: settings.interpreterIncluded };
}

/**
 * Paket V — "Kendi dilinizde destek, ek ücret yok" ayarları. DOĞRULUK KURALI: yalnızca gerçekte destek
 * verilen diller seçilmeli; liste boşken sitede bölüm hiç görünmez. Tercüman cümlesi yalnızca anahtar
 * açıkken. Kaydetme yalnızca ADMIN (backend de zorlar).
 */
export function LanguageSupportSettingsCard({
  settings,
  canEdit,
  onSaved,
}: {
  settings: LanguageSupportSettings;
  canEdit: boolean;
  onSaved: (settings: LanguageSupportSettings) => void;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(settings));
  const [extraCode, setExtraCode] = useState("");
  const [extraError, setExtraError] = useState<string | null>(null);
  const [hoursTab, setHoursTab] = useState<string>(SUPPORT_LANGUAGE_CHOICES[0]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty = JSON.stringify(toForm(settings)) !== JSON.stringify(form);
  const extraLanguages = form.languages.filter((c) => !(SUPPORT_LANGUAGE_CHOICES as readonly string[]).includes(c));
  const hoursTabs = [...SUPPORT_LANGUAGE_CHOICES];
  const hoursTooLong = Object.entries(form.hours).find(([, v]) => v.trim().length > HOURS_MAX);

  function toggleLanguage(code: string, checked: boolean) {
    setForm((prev) => ({ ...prev, languages: checked ? [...prev.languages, code] : prev.languages.filter((c) => c !== code) }));
  }

  function addExtra() {
    const code = extraCode.trim().toLowerCase();
    if (!LOCALE_CODE_RE.test(code)) {
      setExtraError("Geçerli bir dil kodu girin (ör. it, nl, fa).");
      return;
    }
    setExtraError(null);
    setExtraCode("");
    if (!form.languages.includes(code)) setForm((prev) => ({ ...prev, languages: [...prev.languages, code] }));
  }

  async function save() {
    if (hoursTooLong) {
      setSaveError(`Destek saatleri en fazla ${HOURS_MAX} karakter olabilir (${hoursTooLong[0].toUpperCase()}).`);
      return;
    }
    setSaving(true);
    setSaveError(null);
    // Boş bırakılan saat metni silinir (`null`); diğerleri kırpılarak gönderilir.
    const supportHours: Record<string, string | null> = {};
    for (const code of new Set([...Object.keys(settings.supportHours), ...Object.keys(form.hours)])) {
      const value = form.hours[code]?.trim() ?? "";
      supportHours[code] = value ? value : null;
    }
    try {
      const updated = await telehealthApi.updateLanguageSupportSettings({
        supportLanguages: form.languages,
        supportHours,
        interpreterIncluded: form.interpreterIncluded,
      });
      const next = updated.languageSupport ?? { supportLanguages: [], supportHours: {}, interpreterIncluded: false };
      onSaved(next);
      setForm(toForm(next));
      toast.success("Destek dili ayarları kaydedildi.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-5" data-testid="language-support-settings">
      <div className="flex items-start gap-3">
        <Globe className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <h2 className="admin-h2">Kendi dilinizde destek</h2>
          <p className="mt-0.5 admin-text-secondary">
            Anasayfa bandı, doktor profili/randevu rozeti ve footer satırı. Yalnızca gerçekten destek verilen dilleri seçin; liste boşken
            bölüm sitede hiç görünmez.
          </p>
        </div>
      </div>

      {!canEdit && (
        <Alert variant="info">
          <span className="flex items-center gap-2">
            <Info className="h-4 w-4 shrink-0" />
            Bu ayarları yalnızca Yönetici (ADMIN) değiştirebilir.
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

      <fieldset className="space-y-2" disabled={!canEdit}>
        <legend className="text-sm font-medium text-foreground">Destek verilen diller</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SUPPORT_LANGUAGE_CHOICES.map((code) => (
            <label key={code} className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm">
              <input type="checkbox" checked={form.languages.includes(code)} onChange={(e) => toggleLanguage(code, e.target.checked)} />
              <span lang={code}>{nativeLanguageName(code)}</span>
              <span className="text-xs text-foreground/50">{code}</span>
            </label>
          ))}
        </div>
        {extraLanguages.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {extraLanguages.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => toggleLanguage(code, false)}
                className="rounded-full border border-border px-3 py-1 text-xs"
                aria-label={`${nativeLanguageName(code)} dilini kaldır`}
              >
                {nativeLanguageName(code)} ({code}) ×
              </button>
            ))}
          </div>
        )}
        <div className="flex items-start gap-2">
          <Input
            aria-label="Ek dil kodu"
            placeholder="Ek dil kodu (ör. it)"
            value={extraCode}
            onChange={(e) => setExtraCode(e.target.value)}
            className="max-w-48"
          />
          <Button type="button" variant="outline" onClick={addExtra}>
            Ekle
          </Button>
        </div>
        {extraError && <p className="text-xs text-danger">{extraError}</p>}
      </fieldset>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Destek saatleri (dil başına, opsiyonel)</p>
        <div role="tablist" aria-label="Destek saatleri dili" className="flex flex-wrap gap-1">
          {hoursTabs.map((code) => (
            <button
              key={code}
              type="button"
              role="tab"
              aria-selected={hoursTab === code}
              onClick={() => setHoursTab(code)}
              className={cn("rounded-md px-2.5 py-1 text-xs font-medium", hoursTab === code ? "bg-primary text-primary-foreground" : "bg-surface-muted text-foreground/70")}
            >
              {code.toUpperCase()}
              {form.hours[code]?.trim() ? " •" : ""}
            </button>
          ))}
        </div>
        <Input
          role="tabpanel"
          aria-label={`Destek saatleri (${hoursTab.toUpperCase()})`}
          placeholder="ör. Mon–Sat 09:00–21:00 (GMT+3)"
          maxLength={HOURS_MAX}
          disabled={!canEdit}
          value={form.hours[hoursTab] ?? ""}
          onChange={(e) => setForm((prev) => ({ ...prev, hours: { ...prev.hours, [hoursTab]: e.target.value } }))}
        />
        <p className="text-xs text-foreground/50">Bir dilde metin yoksa İngilizce metin gösterilir; o da yoksa saat satırı görünmez.</p>
      </div>

      <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
        <span className="text-sm">
          <span className="font-medium text-foreground">Görüşmelerde ücretsiz tercüman desteği</span>
          <span className="block text-xs text-foreground/60">Açıkken sitede &quot;tercüman desteği ücretsizdir&quot; cümlesi gösterilir.</span>
        </span>
        <Switch
          checked={form.interpreterIncluded}
          disabled={!canEdit}
          onCheckedChange={(checked: boolean) => setForm((prev) => ({ ...prev, interpreterIncluded: checked }))}
          aria-label="Görüşmelerde ücretsiz tercüman desteği"
        />
      </label>

      <div className="flex justify-end">
        <Button type="button" loading={saving} disabled={!canEdit || !dirty} onClick={() => void save()}>
          Kaydet
        </Button>
      </div>
    </Card>
  );
}
