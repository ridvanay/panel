"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { FileDown, FileUp } from "lucide-react";
import * as crmApi from "@/lib/api/crm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CrmDateRange, defaultRange, type DateRangeValue } from "@/components/admin/crm/crm-ui";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

/**
 * Paket N4 — Talepler ekranındaki Google Ads dosya araçları (API bağlantısı YOK):
 * - "Ads CSV içe aktar": potansiyel müşteri formu CSV'si → talepler (tekrar içe aktarmada çift kayıt yok).
 * - "Ads dönüşüm dosyası": ödenen randevular + "Tedavi Oldu" talepleri, Google Ads çevrimdışı dönüşüm şablonunda.
 */
export function AdsTools({ onImported }: { onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [range, setRange] = useState<DateRangeValue>(defaultRange("30"));
  const [result, setResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 2_000_000) {
      toast.error("Dosya en fazla 2 MB olabilir.");
      return;
    }
    setBusy(true);
    try {
      const res = await crmApi.importAdsLeads(await file.text());
      setResult(res);
      toast.success(`${res.created} talep içe aktarıldı.`);
      onImported();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function exportConversions() {
    setBusy(true);
    try {
      await crmApi.downloadAdsConversions(range);
      toast.success("Dönüşüm dosyası indirildi (denetim kaydına yazıldı).");
      setExportOpen(false);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" tabIndex={-1} aria-label="Google Ads CSV dosyası" onChange={(e) => void onFile(e)} />
      <Button type="button" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
        <FileUp className="h-4 w-4" aria-hidden="true" /> Ads CSV içe aktar
      </Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => setExportOpen(true)}>
        <FileDown className="h-4 w-4" aria-hidden="true" /> Ads dönüşüm dosyası
      </Button>

      {result && (
        <div role="status" className="basis-full rounded-lg border border-border p-2 text-sm">
          {result.created} yeni talep, {result.skipped} satır atlandı (zaten vardı ya da eksikti).
          {result.errors.length > 0 && (
            <ul className="mt-1 list-disc ps-5 text-xs text-foreground/70">
              {result.errors.slice(0, 5).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Google Ads dönüşüm dosyası</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-foreground/70">
              Aralıkta ödenen randevular ve “Tedavi Oldu”ya geçen talepler, Google Ads “çevrimdışı dönüşüm içe aktarma” CSV biçiminde iner.
              Yalnızca pazarlama çerezine izin veren ziyaretçilerin reklam tıklama kimliği (gclid) bulunur.
            </p>
            <CrmDateRange value={range} onChange={setRange} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setExportOpen(false)}>
                Vazgeç
              </Button>
              <Button type="button" disabled={busy} onClick={() => void exportConversions()}>
                İndir
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
