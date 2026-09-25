/** `.claude/architect-scope-i18n.md` §14.5 madde 12 — `(site)/not-found.tsx`; `temporary*` → `[lang]/error.tsx`. */
export const errorStrings = {
  notFoundTitle: "Page Not Found",
  notFoundMessage: "The page you are looking for may have been moved or removed.",
  notFoundButtonLabel: "Back to Home",
  temporaryErrorTitle: "This page couldn't load right now",
  temporaryErrorMessage: "This is usually temporary. Please try again in a few seconds.",
  temporaryErrorRetryLabel: "Try again",
} as const;

export type ErrorStrings = Record<keyof typeof errorStrings, string>;
