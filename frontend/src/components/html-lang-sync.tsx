"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";

/**
 * `<html lang>` tam sayfa yüklemesinde `app/layout.tsx`'in okuduğu `x-active-locale` request
 * header'ından (proxy.ts'in yazdığı) DOĞRU gelir — ama Next.js layout'ları client-side
 * navigasyonda YENİDEN RENDER EDİLMEZ (bkz. `node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/layout.md` "Caveats" — "Layouts do not re-render on navigation"). Kök
 * layout `[lang]` segmentinin ÜSTÜNDE olduğu için bu, dil değiştiricideki `<Link>` gibi client-side
 * geçişlerde `<html lang>`'ın bir SONRAKİ tam sayfa yenilemesine kadar BAYAT kalması demektir
 * (WCAG 3.1.1 ihlali — qa-agent raporu).
 *
 * Çözüm: aynı dokümanın önerdiği gibi ("To access the current pathname... usePathname hook...
 * Client Components re-render during navigation") — `useParams()` navigasyon-duyarlı bir hook'tur
 * (bu kod tabanında `sidebar.tsx`/`breadcrumb.tsx` `usePathname()`'i AYNI amaçla zaten kullanıyor).
 * Bu Client Component `[lang]` route param'ını okuyup `document.documentElement.lang`'ı imperatif
 * olarak senkronize eder — SUNUCU render'ının YERİNE GEÇMEZ (ilk yüklemede zaten doğru gelir),
 * yalnızca sonraki client-side navigasyonları kapsar. `/admin`, `/login` vb. `[lang]` DIŞI
 * rotalarda `params.lang` YOKTUR — bu durumda hiçbir şey yapılmaz (mevcut sunucu değeri, "tr",
 * korunur; admin panelinin dili zaten URL'e değil `localStorage`'a bağlıdır, §7.4).
 */
export function HtmlLangSync() {
  const params = useParams<{ lang?: string }>();
  const lang = typeof params?.lang === "string" ? params.lang : undefined;

  useEffect(() => {
    if (!lang) return;
    if (document.documentElement.lang !== lang) {
      document.documentElement.lang = lang;
    }
  }, [lang]);

  return null;
}
