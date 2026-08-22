"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { RevealDelay, RevealDuration, RevealEffect } from "@/lib/page-builder/types";

/**
 * Giriş Animasyonu (Scroll Reveal) — public render katmanı. `index.tsx::BlockRenderer` seviyesinde
 * uygulanır (orkestratör talimatı — 23 ayrı blok dosyasına DOKUNULMAZ). SSR/hydration güvenli:
 * başlangıç state'i `visible=false` (sunucu/istemci ilk render eşleşir), `useEffect` İÇİNDE
 * `IntersectionObserver` kurulur — `threshold: 0.15`, görünür olunca `unobserve` edilir (TEK
 * seferlik giriş animasyonu, tekrar tekrar TETİKLENMEZ). `prefers-reduced-motion` CSS ile
 * (`globals.css::.pb-reveal-*`) ele alınır — JS'de AYRICA kontrol EDİLMEZ (görev tanımı, daha
 * basit çözüm).
 *
 * `style` prop'u (opsiyonel) — bir konteyner çocuğu `flex: <widthFr> 1 0%` taşıyorsa (bkz.
 * `container-block.tsx::ContainerBlockView`), o değer BU sarmalayıcıya da AYNEN devredilir;
 * aksi halde asıl flex item bu `div` olur ve konteynerin kendi iç `flex` stili (artık bir
 * flex-context'i olmayan bir kutunun İÇİNDE) anlamsızlaşır, `row` yönlü ebeveynlerdeki genişlik
 * oranı bozulur. `display: contents` KASITLI OLARAK KULLANILMAZ — `opacity`/`transform` tabanlı
 * bir giriş animasyonu, kutusu olmayan (`display: contents`) bir elemanda HİÇ UYGULANMAZ.
 *
 * `durationMs` (opsiyonel, `?? 600`) — `delayMs` ile AYNI desende `style.transitionDuration`
 * olarak uygulanır (bkz. `globals.css::.pb-reveal-*` — süre artık CSS'te SABİT DEĞİL).
 * `once` (opsiyonel, `?? true`) — `false` ise `IntersectionObserver` görünür olunca `unobserve`
 * ETMEZ; görünürlükten çıkınca `visible=false`e geri döner (element tekrar görünür olduğunda
 * animasyon TEKRAR tetiklenebilir). `true`/`undefined` ise mevcut TEK-SEFERLİK davranış (`unobserve`
 * + bir daha asla sıfırlanmaz) AYNEN korunur.
 */
export function ScrollReveal({
  effect,
  delayMs,
  durationMs,
  once,
  style,
  children,
}: {
  effect: RevealEffect;
  delayMs: RevealDelay;
  durationMs?: RevealDuration;
  once?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const repeatable = once === false;

  useEffect(() => {
    if (effect === "none") return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            if (!repeatable) observer.unobserve(entry.target);
          } else if (repeatable) {
            setVisible(false);
          }
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [effect, repeatable]);

  if (effect === "none") return <>{children}</>;

  return (
    <div
      ref={ref}
      className={cn(`pb-reveal-${effect}`, visible && "pb-revealed")}
      style={{ ...style, transitionDelay: `${delayMs}ms`, transitionDuration: `${durationMs ?? 600}ms` }}
    >
      {children}
    </div>
  );
}
