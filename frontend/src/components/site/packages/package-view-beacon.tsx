"use client";

import { useEffect, useRef } from "react";
import { reportPackageView } from "@/lib/api/packages";

/** Sayfa açılınca anonim sayacı bir kez artırır (kişi/oturum kimliği yok). Görsel çıktı yok. */
export function PackageViewBeacon({ kind, slug }: { kind: "list" | "package"; slug?: string }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    reportPackageView(kind, slug);
  }, [kind, slug]);
  return null;
}
