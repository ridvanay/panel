/**
 * `.claude/architect-scope-i18n.md` §14.5 madde 1 (uyumluluk önceliği) — `legal-document-notice.tsx`.
 * Metinler compliance-agent tarafından onaylanmış NİHAİ metinlerdir, birebir kullanılır.
 */
export const legalStrings = {
  /** §5.1 hukuki belge istisnası bildirimi gövdesi. */
  notAvailableInLocale:
    "This document is not currently available in your selected language. To avoid the risk of incomplete or inaccurate translation of legal content, this document is published only in its official language.",
  /** Varsayılan dildeki sürüme bağlantı veren buton metni — `{defaultLocaleLabel}` yer tutucusu. */
  viewInDefaultLocale: "View the {defaultLocaleLabel} version",
} as const;

export type LegalStrings = Record<keyof typeof legalStrings, string>;
