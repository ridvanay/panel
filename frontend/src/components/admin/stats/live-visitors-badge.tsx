"use client";

import { useEffect, useState } from "react";
import * as statsApi from "@/lib/api/stats";

const POLL_INTERVAL_MS = 5000;

/**
 * "Şu an sayfa görüntüleyen" rozeti — 5 saniyede bir `getLiveVisitors()` çeker.
 *
 * Dürüstlük notu: bilerek "Online kullanıcılar" gibi abartılı bir etiket KULLANMIYORUZ,
 * çünkü backend yalnızca son birkaç dakikada bir sayfa görüntüleme kaydı üretmiş
 * ziyaretçileri sayıyor — gerçek zamanlı bir "bağlı kullanıcı" bilgisi değil.
 *
 * Hata durumunda sessizce gizlenir: bu küçük bir widget, sayfayı bloklayan bir hata
 * göstermemeli.
 */
export function LiveVisitorsBadge() {
  const [count, setCount] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const result = await statsApi.getLiveVisitors();
        if (!cancelled) {
          setCount(result.count);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (failed || count === null) return null;

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-surface-muted px-3 py-1.5 text-xs font-medium text-foreground/70">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-success opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
      </span>
      {count.toLocaleString("tr-TR")} kişi şu an sayfa görüntülüyor
    </span>
  );
}
