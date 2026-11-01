"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { CONSULTATION_DICTIONARIES, fmt } from "@/lib/i18n/use-consultation-strings";
import { resolveParticipantLabel, type LabelContext, type LabelParticipant } from "./participant-label";

/**
 * Paket AF (İş 1) — odadaki video kutularının ad etiketi bağlamı. Hasta/tercüman odası sağlayıcıyı kendi randevu/atama
 * verisiyle doldurur. Sağlayıcı yoksa (ör. izole bileşen testi) etiket rol adıdır; identity ASLA gösterilmez.
 */
const FALLBACK: LabelContext = {
  viewer: "patient",
  t: CONSULTATION_DICTIONARIES.tr!,
  fmt,
};

const ParticipantLabelContext = createContext<LabelContext>(FALLBACK);

export function ParticipantLabelProvider({ value, children }: { value: LabelContext; children: ReactNode }) {
  return <ParticipantLabelContext.Provider value={value}>{children}</ParticipantLabelContext.Provider>;
}

export function useLabelContext(): LabelContext {
  return useContext(ParticipantLabelContext);
}

/** `(participant) => görünen ad | null` — bağlam değişmedikçe aynı referans. */
export function useParticipantLabeler(): (p: LabelParticipant) => string | null {
  const ctx = useLabelContext();
  return useMemo(() => (p: LabelParticipant) => resolveParticipantLabel(p, ctx), [ctx]);
}
