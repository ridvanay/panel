/**
 * Paket AA — LiveKit odasında tercüman katılımcısını ayırt etme. Kimlik `interpreter:<profilId>:<bookingId>`,
 * metadata `{ role: "interpreter", language }` (backend `createInterpreterToken`; `canUpdateOwnMetadata:
 * false` olduğu için tercüman değiştiremez). Kalite dinleyicisi (`qa_listener`) ayrı bir roldür.
 */
export const INTERPRETER_IDENTITY_PREFIX = "interpreter:";

function readMetadata(metadata: string | undefined): { role?: unknown; language?: unknown } {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as { role?: unknown; language?: unknown }) : {};
  } catch {
    return {};
  }
}

export function isInterpreterParticipant(participant: { identity: string; metadata?: string }): boolean {
  return participant.identity.startsWith(INTERPRETER_IDENTITY_PREFIX) || readMetadata(participant.metadata).role === "interpreter";
}

/** Tercümanın görüşme dili (metadata); yoksa `null`. */
export function interpreterLanguageOf(participant: { metadata?: string }): string | null {
  const language = readMetadata(participant.metadata).language;
  return typeof language === "string" && language ? language : null;
}

/** Dilin kendi dilindeki adı ("ar" → "العربية"); tanınmazsa kodun büyük harfi. */
export function languageNativeName(code: string): string {
  const tag = code.toLowerCase() === "sr-latn" ? "sr-Latn" : code;
  try {
    const name = new Intl.DisplayNames([tag], { type: "language" }).of(tag);
    if (name && name.toLowerCase() !== code.toLowerCase()) return name;
  } catch {
    // tanınmayan etiket
  }
  return code.toUpperCase();
}
