import { isQaListenerParticipant } from "@/components/site/telehealth/qa-listener-notice";
import { isInterpreterParticipant } from "@/components/site/interpreter/interpreter-participant";

/** Paket C: dinleyici, Paket AA: tercüman "karşı taraf" SAYILMAZ. Modül düzeyinde (sabit referans). */
export function isCounterpart(p: { isLocal: boolean; identity: string; metadata?: string }): boolean {
  return !p.isLocal && !isQaListenerParticipant(p) && !isInterpreterParticipant(p);
}
