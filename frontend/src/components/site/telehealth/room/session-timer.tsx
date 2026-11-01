"use client";

import { useEffect, useState } from "react";
import { useConnectionState } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import { Clock, X } from "lucide-react";
import { useConsultationStrings } from "@/lib/i18n/use-consultation-strings";

export const ENDING_SOON_MS = 5 * 60_000;

/** Saniyede bir güncellenen istemci saati. Yalnızca odada (katılımdan sonra, istemcide) kullanılır → hidrasyon uyuşmazlığı yok. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Görüşme süresi sayacı: ilk kez `Connected` olunan andan itibaren (istemci saati). `startRef` oda token ile yeniden
 * kurulsa da yaşayan üst bileşendedir (`startedAt` orada tutulur) → yeniden bağlanmada sayaç sıfırlanmaz.
 */
export function SessionTimer({ startedAt, onStart }: { startedAt: number | null; onStart: (at: number) => void }) {
  const { t } = useConsultationStrings();
  const state = useConnectionState();
  const now = useNow();

  useEffect(() => {
    if (state === ConnectionState.Connected && startedAt === null) onStart(Date.now());
  }, [state, startedAt, onStart]);

  if (startedAt === null) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
      <span
        role="timer"
        aria-label={t.elapsedLabel}
        title={t.elapsedLabel}
        data-testid="session-timer"
        className="inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-xs font-medium tabular-nums text-white backdrop-blur-md"
      >
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        <span dir="ltr">{formatElapsed(now - startedAt)}</span>
      </span>
    </div>
  );
}

/**
 * Randevu bitişine 5 dakika kala küçük, kapatılabilir BİLGİ uyarısı. Görüşmeyi kesmez, odaya dokunmaz. Bitiş zamanı mevcut
 * randevu verisinden gelir. Kapatılınca bu görüşme boyunca bir daha gösterilmez.
 */
export function EndingSoonNotice({ endsAt }: { endsAt: string }) {
  const { t, fmt } = useConsultationStrings();
  const now = useNow();
  const [dismissed, setDismissed] = useState(false);
  const end = new Date(endsAt).getTime();
  const remaining = end - now;
  if (dismissed || Number.isNaN(end) || remaining <= 0 || remaining > ENDING_SOON_MS) return null;
  const minutes = Math.max(1, Math.ceil(remaining / 60_000));
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="ending-soon-notice"
      className="pointer-events-auto flex max-w-md items-center gap-2 rounded-[var(--site-radius)] bg-black/75 py-1 ps-3 pe-1 text-sm font-medium text-white shadow-lg backdrop-blur-md"
    >
      <span className="min-w-0 flex-1">{fmt(t.endingSoonNotice, { minutes })}</span>
      <button
        type="button"
        aria-label={t.dismiss}
        title={t.dismiss}
        onClick={() => setDismissed(true)}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
