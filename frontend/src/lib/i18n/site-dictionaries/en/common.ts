/**
 * `.claude/architect-scope-i18n.md` §14.2/§14.4 — public site "chrome" dili, KAYNAK dil (`en`).
 * `common` namespace: birden fazla sayfa/bileşende tekrar eden, gerçekten jenerik metinler.
 * Yeni bir anahtar eklemeden önce mevcut namespace'lerden birine sığıp sığmadığına bak (§14.4).
 */
export const commonStrings = {
  /** `product-breadcrumbs.tsx` — kırıntı yolunun ilk halkası. */
  home: "Home",
} as const;

export type CommonStrings = Record<keyof typeof commonStrings, string>;
