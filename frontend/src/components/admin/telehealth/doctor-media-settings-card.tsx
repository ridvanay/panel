"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, ImageIcon, Info } from "lucide-react";
import * as showcaseApi from "@/lib/api/doctor-showcase";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DEFAULT_MAX_VIDEO_MB, validateMaxVideoMb } from "@/lib/video-upload";
import { Spinner } from "@/components/ui/spinner";

/**
 * Paket Y — "Önce/sonra görselleri" ayarı. Varsayılan KAPALI; hukuk onayı gelene kadar kapalı kalmalı.
 * `PUT` yalnızca ADMIN (MANAGER salt okunur; sunucu da zorlar).
 */
export function DoctorMediaSettingsCard({ canEdit }: { canEdit: boolean }) {
  const [saved, setSaved] = useState<boolean | null>(null);
  const [value, setValue] = useState(false);
  const [savedMaxMb, setSavedMaxMb] = useState(DEFAULT_MAX_VIDEO_MB);
  const [maxMbInput, setMaxMbInput] = useState(String(DEFAULT_MAX_VIDEO_MB));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await showcaseApi.getDoctorMediaSettings();
      setSaved(data.beforeAfterEnabled);
      setValue(data.beforeAfterEnabled);
      const mb = data.maxVideoUploadMb ?? DEFAULT_MAX_VIDEO_MB;
      setSavedMaxMb(mb);
      setMaxMbInput(String(mb));
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const maxMbNumber = maxMbInput.trim() === "" ? NaN : Number(maxMbInput);
  const maxMbError = validateMaxVideoMb(maxMbNumber);
  const dirty = saved !== null && (value !== saved || maxMbNumber !== savedMaxMb);

  async function save() {
    if (maxMbError) {
      setSaveError(maxMbError);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await showcaseApi.updateDoctorMediaSettings({ beforeAfterEnabled: value, maxVideoUploadMb: maxMbNumber });
      setSaved(updated.beforeAfterEnabled);
      setValue(updated.beforeAfterEnabled);
      const mb = updated.maxVideoUploadMb ?? maxMbNumber;
      setSavedMaxMb(mb);
      setMaxMbInput(String(mb));
      toast.success("Medya ayarları kaydedildi.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4" data-testid="doctor-media-settings">
      <div className="flex items-start gap-3">
        <ImageIcon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <h2 className="admin-h2">Önce/sonra görselleri ve video</h2>
          <p className="mt-0.5 admin-text-secondary">Hukuk onayı gelene kadar kapalı kalmalı; kapalıyken bu kategori sitede hiç görünmez.</p>
        </div>
      </div>

      {!canEdit && (
        <Alert variant="info">
          <span className="flex items-center gap-2">
            <Info className="h-4 w-4 shrink-0" />
            Bu ayarı yalnızca Yönetici (ADMIN) değiştirebilir.
          </span>
        </Alert>
      )}

      {loadError && (
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
      )}
      {saveError && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {saveError}
          </span>
        </Alert>
      )}

      {saved === null && !loadError ? (
        <div className="flex justify-center py-4">
          <Spinner className="h-5 w-5 text-primary" />
        </div>
      ) : saved !== null ? (
        <>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
            <span className="text-sm">
              <span className="font-medium text-foreground">Önce/sonra görsellerini sitede göster</span>
              <span className="block text-xs text-foreground/60">Her öğe ayrıca yayında olmalı ve hasta yazılı onayı işaretli olmalıdır.</span>
            </span>
            <Switch checked={value} disabled={!canEdit} onCheckedChange={(checked: boolean) => setValue(checked)} aria-label="Önce/sonra görsellerini sitede göster" />
          </div>
          <Field
            id="max-video-upload-mb"
            label="Azami video boyutu (MB)"
            error={maxMbError ?? undefined}
            hint="1–500 arası, varsayılan 100. Sunucudaki Nginx client_max_body_size değeriyle uyumlu olmalı; Nginx sınırı bu değerden küçükse büyük yüklemeler 413 ile reddedilir."
          >
            {(inputProps) => <Input {...inputProps} type="number" inputMode="numeric" min={1} max={500} step={1} className="w-32" disabled={!canEdit} value={maxMbInput} onChange={(e) => setMaxMbInput(e.target.value)} />}
          </Field>
          <div className="flex justify-end">
            <Button type="button" loading={saving} disabled={!canEdit || !dirty || maxMbError !== null} onClick={() => void save()}>
              Kaydet
            </Button>
          </div>
        </>
      ) : null}
    </Card>
  );
}
