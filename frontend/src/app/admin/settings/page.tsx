"use client";

import { useCallback, useEffect, useState } from "react";
import * as settingsApi from "@/lib/api/settings";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

export default function AdminSettingsPage() {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const [siteName, setSiteName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");

  const load = useCallback(async () => {
    try {
      const settings = await settingsApi.getSettings();
      setSiteName(settings.siteName);
      setLogoUrl(settings.logoUrl ?? "");
      setLoaded(true);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function handleSave() {
    setSaveError(null);
    setSaved(false);
    setSaving(true);
    try {
      await settingsApi.updateSettings({ siteName, logoUrl: logoUrl || null });
      setSaved(true);
    } catch (err) {
      setSaveError(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return <Alert variant="error">{loadError}</Alert>;
  }

  if (!loaded) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Ayarlar</h1>
        <p className="mt-1 text-sm text-foreground/60">Sitenin adı ve logosu — public sitenin üst menüsünde görünür.</p>
      </div>

      {saveError && <Alert variant="error">{saveError}</Alert>}
      {saved && <Alert variant="success">Ayarlar kaydedildi.</Alert>}

      <Card className="space-y-4">
        <Field id="siteName" label="Site adı" required>
          {(inputProps) => (
            <Input {...inputProps} required value={siteName} onChange={(e) => setSiteName(e.target.value)} />
          )}
        </Field>

        <ImageUploadField id="logoUrl" label="Logo" value={logoUrl} onChange={setLogoUrl} />

        <Button loading={saving} onClick={handleSave}>
          Kaydet
        </Button>
      </Card>
    </div>
  );
}
