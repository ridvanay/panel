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
/**
 * qa-agent bulgusu (2026-09-16) — `"home"`, ana sayfanın (`[lang]/page.tsx`) kendi `Page`
 * kaydından (`slug: "anasayfa"`) AYRI bir tür: bu sayfanın PREFİX'SİZ kanonik URL'i HER ZAMAN
 * `/` / `/tr`'dir, kaydın kendi slug'ı DEĞİL (`lib/seo.ts::isHomepage` İLE AYNI gerekçe) —
 * `"page"` (`[slug]/page.tsx`) İLE AYNI `contentKindBasePath` ("") ama `language-switcher.tsx`
 * hedef path'i slug'tan DEĞİL kök path'ten kurar.
 */
export type ContentKind = "page" | "home" | "blog" | "product" | "portfolio";

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
 * Görev (2026-09-16) — currency/locale format denetimi. `formatPriceFromCents`'in (`lib/format-
 * price.ts`) `locale` parametresi opsiyoneldir ve varsayılanı sabit `"tr-TR"`dir; bu, sepet/ödeme/
 * randevu özet gibi "use client" bileşenlerin AKTİF site diline BAKMAKSIZIN her zaman Türkçe
 * biçimlendirme üretmesine yol açıyordu. `LocaleAlternatesProvider` `(site)/layout.tsx`'te (TÜM
 * `[lang]/(site)/**` alt ağacını, `cart-drawer.tsx` gibi global mount noktaları DAHİL) sarmaladığı
 * için bu hook, `useParams()` ile HER bileşende AYRI AYRI `lang` okumak/prop olarak taşımak yerine
 * TEK bir kaynaktan (context) aktif İÇERİK dilini okumayı sağlar — `checkout/page.tsx`'in KENDİ
 * `useParams<{ lang }>()` deseninden FARKLI ama AYNI veriye (`activeLocale.code`) ulaşan, daha az
 * prop-drilling gerektiren bir yol. Context YOKSA (teorik olarak `(site)` dışı bir yüzeyde
 * kullanılırsa) `"tr"` — `server-locales.ts::FALLBACK_LOCALES` İLE AYNI son çare varsayılanı.
 */
export function useActiveLocaleCode(): string {
  const ctx = useContext(LocaleAlternatesContext);
  return ctx?.activeLocaleCode ?? "tr";
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
  // "page" | "home" — ikisi de kök-göreceli (Page rotası önek almaz).
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
