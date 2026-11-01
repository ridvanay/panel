"use client";

import { useEffect, useRef } from "react";
import { reportPackageView } from "@/lib/api/packages";

/**
 * "Top destinations" bölümü görünür olunca anonim sayacı sayfa başına bir kez artırır (kişi/oturum kimliği yok).
 * Bölüm `data-crm-ignore` — CRM'de kişi bazında hiçbir tıklama/görüntülenme kaydedilmez.
 */
export function DestinationsViewBeacon() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          reportPackageView("destinations");
        }
      },
      { threshold: 0.25 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <span ref={ref} hidden aria-hidden="true" />;
}
