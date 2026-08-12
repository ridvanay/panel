"use client";

import { useSyncLocaleAlternates, type ContentKind } from "@/context/locale-alternates-context";
import type { ContentLocalization } from "@/lib/api/types";

/**
 * Server Component sayfaların (`[slug]`, `blog/[slug]`, `products/[slug]`, `portfolio/[slug]`)
 * gövdesine eklenir — kendisi hiçbir şey render ETMEZ, yalnızca `localizations`'ı header'ın dil
 * değiştiricisine yayınlar (bkz. `context/locale-alternates-context.tsx`).
 */
export function SyncLocaleAlternates({ kind, items }: { kind: ContentKind; items: ContentLocalization[] }) {
  useSyncLocaleAlternates(kind, items);
  return null;
}
