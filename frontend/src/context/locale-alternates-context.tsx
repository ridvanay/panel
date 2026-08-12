"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ContentLocalization } from "@/lib/api/types";
import { withLocalePrefix } from "@/lib/i18n/site-path";

/**
 * Site header'daki dil değiştirici, aynı içeriğin başka dildeki karşılığına gitmelidir
 * (`.claude/architect-scope-i18n.md` §9 frontend-agent madde 4). Header `(site)/layout.tsx`'te
 * TEK SEFER render edilir ama içerik (dolayısıyla `localizations`) her sayfada FARKLIDIR —
 * bu context, bir alt sayfanın (`[slug]`, `blog/[slug]`, `products/[slug]`, `portfolio/[slug]`)
 * kendi `localizations`'ını header'a "yayınlamasını" sağlayan hafif bir köprüdür (App Router'da
 * layout'un alt sayfanın fetch ettiği veriye doğrudan erişimi YOKTUR).
 */
export type ContentKind = "page" | "blog" | "product" | "portfolio";

interface LocaleAlternates {
  kind: ContentKind;
  items: ContentLocalization[];
}

interface LocaleAlternatesContextValue {
  alternates: LocaleAlternates | null;
  setAlternates: (value: LocaleAlternates | null) => void;
  activeLocaleCode: string;
  defaultLocaleCode: string;
}

const LocaleAlternatesContext = createContext<LocaleAlternatesContextValue | null>(null);

export function LocaleAlternatesProvider({
  children,
  activeLocaleCode,
  defaultLocaleCode,
}: {
  children: ReactNode;
  activeLocaleCode: string;
  defaultLocaleCode: string;
}) {
  const [alternates, setAlternates] = useState<LocaleAlternates | null>(null);
  const value = useMemo(
    () => ({ alternates, setAlternates, activeLocaleCode, defaultLocaleCode }),
    [alternates, activeLocaleCode, defaultLocaleCode]
  );
  return <LocaleAlternatesContext.Provider value={value}>{children}</LocaleAlternatesContext.Provider>;
}

/** Sepet/ödeme gibi çeviri-bağımsız client sayfalarında site-içi bir yolu aktif dile öneklemek için. */
export function useLocalizePath(): (path: string) => string {
  const ctx = useContext(LocaleAlternatesContext);
  return useCallback(
    (path: string) => (ctx ? withLocalePrefix(path, ctx.activeLocaleCode, ctx.defaultLocaleCode) : path),
    [ctx]
  );
}

export function useLocaleAlternates(): LocaleAlternates | null {
  const ctx = useContext(LocaleAlternatesContext);
  return ctx?.alternates ?? null;
}

/**
 * Sayfa bazlı yayıncı — `[slug]`/`blog/[slug]`/`products/[slug]`/`portfolio/[slug]`
 * bileşenlerinin gövdesine eklenir. Unmount'ta context'i temizler ki bir sonraki (alternates'i
 * OLMAYAN) sayfada eski değer sızmasın (ör. liste sayfaları, sepet).
 */
export function useSyncLocaleAlternates(kind: ContentKind, items: ContentLocalization[]): void {
  const ctx = useContext(LocaleAlternatesContext);
  const setAlternates = ctx?.setAlternates;
  const stableItems = useMemo(() => items, [items]);

  useEffect(() => {
    setAlternates?.({ kind, items: stableItems });
    return () => setAlternates?.(null);
  }, [kind, stableItems, setAlternates]);
}

/** İçerik türünden site-içi slug öneki türetir — `withLocalePrefix` ile BİRLİKTE kullanılır. */
export function contentKindBasePath(kind: ContentKind): string {
  if (kind === "blog") return "/blog";
  if (kind === "product") return "/products";
  if (kind === "portfolio") return "/portfolio";
  return "";
}

export const useLocaleAlternatesSetter = () => {
  const ctx = useContext(LocaleAlternatesContext);
  return useCallback(
    (value: LocaleAlternates | null) => {
      ctx?.setAlternates(value);
    },
    [ctx]
  );
};
