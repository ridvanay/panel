"use client";

import { useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as crmApi from "@/lib/api/crm";
import type { CrmSettings } from "@/lib/api/crm";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { SearchConsoleSetupSteps } from "@/components/admin/crm/search-console-setup";
import { formatDateTime } from "@/components/admin/crm/crm-ui";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";

/**
 * Paket N4 — CRM Ayarları → Google Search Console. Servis hesabı JSON'u dosyadan okunur ve tek seferde
 * sunucuya gönderilir; sunucu ŞİFRELİ saklar ve bir daha geri döndürmez (ekranda yalnızca maskeli e-posta).
 */
export function SearchConsoleCard({ settings }: { settings: CrmSettings }) {
  const queryClient = useQueryClient();
  const sc = settings.searchConsole;
  const [propertyUrl, setPropertyUrl] = useState(sc.propertyUrl ?? "");
  const [credentials, setCredentials] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const refresh = (next?: CrmSettings) => {
    if (next) queryClient.setQueryData(["crm-settings"], next);
    else void queryClient.invalidateQueries({ queryKey: ["crm-settings"] });
  };

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 20_000) {
      toast.error("Dosya çok büyük — servis hesabı JSON anahtarını seçin.");
      return;
    }
    setCredentials(await file.text());
    setFileName(file.name);
  }

  async function connect() {
    if (!credentials) return;
    setBusy(true);
    setErrors({});
    try {
      const next = await crmApi.connectSearchConsole({ propertyUrl: propertyUrl.trim(), credentialsJson: credentials });
      setCredentials(null);
      setFileName(null);
      refresh(next);
      toast.success("Search Console bağlandı. İlk senkron için “Şimdi güncelle”ye basabilirsiniz.");
    } catch (err) {
      setErrors(fieldErrorsFrom(err));
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      refresh();
      toast.success(success);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4" id="search-console">
      <h2 className="admin-h2">Google Search Console</h2>
      {sc.connected ? (
        <div className="space-y-2 text-sm">
          <p>
            Bağlı mülk: <strong dir="ltr">{sc.propertyUrl}</strong> · Servis hesabı <span dir="ltr">{sc.clientEmailMasked}</span>
          </p>
          <p className="text-foreground/70">
            Son senkron: {formatDateTime(sc.lastSyncAt)}
            {sc.initialSyncDone ? "" : " · ilk 90 günlük senkron bekliyor"}
          </p>
          {sc.lastSyncError && <Alert variant="warning">Son senkron hatası: {sc.lastSyncError}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void run(crmApi.syncSearchConsole, "Senkron tamamlandı.")}>
              Şimdi güncelle
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(crmApi.disconnectSearchConsole, "Search Console bağlantısı kaldırıldı.")}>
              Bağlantıyı kaldır
            </Button>
          </div>
        </div>
      ) : (
        <>
          <SearchConsoleSetupSteps />
          <Field id="sc-property" label="Mülk adresi" error={errors.propertyUrl} hint="sc-domain:alanadi.com ya da https://alanadi.com/">
            {(p) => <Input {...p} dir="ltr" value={propertyUrl} onChange={(e) => setPropertyUrl(e.target.value)} />}
          </Field>
          <Field id="sc-json" label="Servis hesabı JSON anahtarı" error={errors.credentialsJson}>
            {(p) => <Input {...p} type="file" accept="application/json,.json" onChange={(e) => void onFile(e)} />}
          </Field>
          {fileName && <p className="text-xs text-foreground/60">Seçilen dosya: {fileName} (henüz gönderilmedi)</p>}
          <Button type="button" disabled={busy || !credentials || !propertyUrl.trim()} onClick={() => void connect()}>
            Bağla
          </Button>
        </>
      )}
    </Card>
  );
}
