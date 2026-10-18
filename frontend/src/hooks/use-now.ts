"use client";

import { useEffect, useState } from "react";

/**
 * Belirli aralıklarla (varsayılan dakikada bir) güncellenen "şu an" (ms). Katılım penceresi
 * sayfa açıkken kapandığında "Katıl" butonunun kendiliğinden kaybolması için kullanılır.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
