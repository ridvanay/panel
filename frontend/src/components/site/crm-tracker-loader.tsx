"use client";

import { useEffect } from "react";
import { API_BASE_URL } from "@/lib/env";
import {
  applyOptOutFromUrl,
  CONSENT_CHANGED_EVENT,
  isOptedOut,
  isStaffDevice,
  readConsent,
} from "@/lib/crm/consent";
import type { CrmPublicConfig } from "@/lib/api/server-crm";

/**
 * Paket N1 — takip modülü yükleyicisi. Takip modülü (`lib/crm/tracker.ts`) ancak ŞU KOŞULLARIN HEPSİ
 * sağlanırsa dinamik `import()` ile indirilir ve başlatılır: admin takibi açmış, ziyaretçi ANALİTİK
 * onayı vermiş, cihaz `?crm_optout=1` ile hariç tutulmamış, (ayar kapalıysa) personel cihazı değil.
 * Aksi halde hiçbir dosya indirilmez, istek gitmez, depolamaya takip anahtarı yazılmaz. Onay geri
 * alınırsa modül durdurulur.
 */
export function CrmTrackerLoader({ config }: { config: CrmPublicConfig | null }) {
  useEffect(() => {
    applyOptOutFromUrl(window.location.search);
    if (!config?.trackingEnabled) return;
    let cancelled = false;

    const evaluate = () => {
      const consent = readConsent();
      const allowed = Boolean(consent?.analytics) && !isOptedOut() && (config.trackStaff || !isStaffDevice());
      if (!allowed) {
        void import("@/lib/crm/tracker").then((m) => m.stopTracker()).catch(() => {});
        return;
      }
      void import("@/lib/crm/tracker")
        .then((m) => {
          if (cancelled) return;
          m.startTracker({
            apiBase: API_BASE_URL,
            consentVersion: consent!.v,
            marketing: consent!.marketing,
            whatsappRef: config.whatsappRef,
            excludedPaths: config.excludedPaths,
            heartbeatSeconds: config.heartbeatSeconds,
          });
        })
        .catch(() => {});
    };

    // Onay hiç verilmemişse modül İNDİRİLMEZ (stop çağrısı bile modülü yüklemesin diye ilk kontrol ayrı).
    if (readConsent()?.analytics) evaluate();
    const onChange = () => evaluate();
    window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
    };
  }, [config]);

  return null;
}
