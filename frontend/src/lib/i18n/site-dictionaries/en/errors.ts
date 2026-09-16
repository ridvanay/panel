/** `.claude/architect-scope-i18n.md` §14.5 madde 12 — `(site)/not-found.tsx`. */
export const errorStrings = {
  notFoundTitle: "Page Not Found",
  notFoundMessage: "The page you are looking for may have been moved or removed.",
  notFoundButtonLabel: "Back to Home",
} as const;

export type ErrorStrings = Record<keyof typeof errorStrings, string>;
