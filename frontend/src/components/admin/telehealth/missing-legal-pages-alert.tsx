"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { fetchLegalPagesClient, resolveExplicitConsentPage, resolveKvkkConsentPage } from "@/lib/legal-pages";

/**
 * Paket A2 (2026-10-18) — randevu onay kutularının bağlandığı yasal metinlerden yayında olmayanlar
 * için admin uyarısı. Sitede bu durumda onay metni link OLMADAN gösterilir (kırık link yok); hasta
 * onayladığı metni okuyamadığı için bu sayfaların hukuk danışmanından alınıp girilmesi gerekir.
 * İçerik uydurulmaz, taslak sayfa da oluşturulmaz — yalnızca eksiklik bildirilir.
 */
const REQUIRED = [
  { key: "kvkk", label: "KVKK Aydınlatma Metni (randevu kimlik adımı onay kutusu)", resolve: resolveKvkkConsentPage },
  { key: "explicit", label: "Sağlık Verisi Açık Rıza Metni (randevu tıbbi belge adımı onay kutusu)", resolve: resolveExplicitConsentPage },
] as const;

export function MissingLegalPagesAlert() {
  const [missing, setMissing] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchLegalPagesClient().then((pages) => {
      if (cancelled) return;
      setMissing(REQUIRED.filter((doc) => doc.resolve(pages) === null).map((doc) => doc.label));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!missing || missing.length === 0) return null;

  return (
    <Alert variant="warning" data-testid="missing-legal-pages-alert">
      <div className="space-y-1.5">
        <p className="flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Randevu onay metinleri için yayında olmayan yasal sayfalar var
        </p>
        <ul className="list-disc space-y-0.5 pl-6">
          {missing.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
        <p className="text-xs">
          Hasta bu metinleri onay kutusundan açamıyor (metin link olmadan gösteriliyor). Metinleri hukuk danışmanınızdan alıp{" "}
          <Link href="/admin/pages/new" className="underline">
            yeni bir sayfa
          </Link>{" "}
          olarak girin, sayfa ayarlarında &quot;Hukuki belge&quot; seçeneğini işaretleyip yayınlayın.
        </p>
      </div>
    </Alert>
  );
}
