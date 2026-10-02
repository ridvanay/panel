"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { ABOUT_ICONS } from "@/components/site/about/about-icons";
import { Eyebrow } from "@/components/site/about/eyebrow";
import { aboutContainerClass } from "@/components/site/about/about-buttons";
import { formatSiteString } from "@/lib/i18n/site-dictionaries";
import type { AboutIconKey } from "@/lib/about-page";
import type { HomeJourneyContent } from "@/lib/home-page";
import { cn } from "@/lib/utils";

/** Adımlar arası döngüsel vurgu aralığı (ms) — `prefers-reduced-motion` açıkken hiç çalışmaz. */
const ACTIVE_STEP_INTERVAL_MS = 3200;
/** Şematik küre — yarıçap/merkez `viewBox="0 0 340 340"` koordinat sisteminde. */
const GLOBE_VIEW = 340;
const GLOBE_CENTER = { x: 170, y: 170 };
const GLOBE_RADIUS = 136;
/** İstanbul — merkeze yakın, sağ-üst çeyrekte sabit nokta (coğrafi hassasiyet hedeflenmiyor, şematik). */
const ISTANBUL_POINT = { x: 193, y: 148 };

function iconGlyph(key: AboutIconKey, className: string) {
  const Icon = ABOUT_ICONS[key];
  return <Icon className={className} aria-hidden="true" />;
}

/** Küre yüzeyindeki noktalı doku — deterministik (satır/sütun taraması, modül yüklenince bir kez hesaplanır). */
function buildGlobeDots(): { x: number; y: number }[] {
  const dots: { x: number; y: number }[] = [];
  for (let y = 10; y <= GLOBE_VIEW - 10; y += 13) {
    for (let x = 10; x <= GLOBE_VIEW - 10; x += 13) {
      const dx = x - GLOBE_CENTER.x;
      const dy = y - GLOBE_CENTER.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= GLOBE_RADIUS && distance >= GLOBE_RADIUS * 0.08) dots.push({ x, y });
    }
  }
  return dots;
}
const GLOBE_DOTS = buildGlobeDots();

/**
 * Transcendental (`Math.cos`/`sin`/`hypot` vb.) sonuçları sabit 3 ondalığa yuvarlar.
 * SSR (Node) ve CSR (Chromium) V8 build'leri bu fonksiyonlarda son-bit farklı sonuç
 * üretebildiğinden (örn. `68.9285555896728` vs `68.92855558967281`), yuvarlama olmadan
 * SVG/inline-style string'leri sunucu ve istemci arasında eşleşmeyip hydration mismatch'e yol açar.
 * Tüm hesaplanmış koordinat/yüzde/path sayıları render'a yazılmadan önce bu fonksiyondan geçmeli.
 */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Ülke sayısına göre küre çevresinde (İstanbul'un bulunduğu sağ-üst çeyrek hariç) eşit aralıklı nokta. */
function countryPoint(index: number, total: number): { x: number; y: number } {
  const startDeg = 95;
  const sweepDeg = 250;
  const angleDeg = total <= 1 ? startDeg + sweepDeg / 2 : startDeg + (index * sweepDeg) / (total - 1);
  const angle = (angleDeg * Math.PI) / 180;
  const radius = GLOBE_RADIUS * 0.82;
  return { x: round(GLOBE_CENTER.x + radius * Math.cos(angle)), y: round(GLOBE_CENTER.y + radius * Math.sin(angle)) };
}

/**
 * İki nokta arasında, bağlantı yönüne dik hafif bir kavisle giden uçuş rotası (quadratic Bezier).
 * Uzunluk `Math.sqrt(dx * dx + dy * dy)` ile hesaplanır — matematiksel olarak `Math.hypot`'a eşdeğer,
 * ancak `+`/`-`/`*`/`sqrt` IEEE754 tarafından "doğru yuvarlanmış" sonuç üretmesi ZORUNLU tutulan
 * operasyonlardır (hypot için bu garanti yoktur). `from`/`to` zaten `countryPoint()` üzerinden
 * yuvarlanmış (bit-eşit) geldiğinden, bu seçim SSR/CSR arasında ek bir sapma kaynağını komple ortadan
 * kaldırır; nihai kontrol noktası yine de savunma amaçlı `round()`'dan geçer.
 */
function flightPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const bend = Math.min(36, length * 0.3);
  const cx = round(mx + nx * bend);
  const cy = round(my + ny * bend);
  return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
}

/** SVG koordinatını `GLOBE_VIEW` tabanında yüzdeye çevirir (inline `left`/`top` için), yuvarlanmış. */
function toPercent(coordinate: number): number {
  return round((coordinate / GLOBE_VIEW) * 100);
}

/**
 * "From Across the World to Istanbul" — TrustStrip'in hemen altında, uzmanlıklar bölümünden önce.
 * Koyu zemin (`--site-primary`'nin çok koyu tonu); solda adım listesi (döngüsel aktif vurgu), sağda
 * SVG dünya küresi + ülkelerden İstanbul'a çizilen uçuş rotaları. `prefers-reduced-motion` açıkken
 * (framer-motion `useReducedMotion` — `window.matchMedia` sarmalayıcısı) döngü ve çizim animasyonu
 * tamamen kapanır; adımlar/rotalar doğrudan son haliyle görünür, ilk adım sabit vurgulu kalır.
 *
 * Paylaşılan bileşen — hem `home-page` şablonunun (`home-page-view.tsx`) sabit bölümü hem
 * page-builder `journey-map` bloğu (`site/blocks/journey-map-block.tsx`) BU bileşeni kullanır,
 * koda ikinci bir kopyası YOKTUR. `journey` prop'u `HomeJourneyContent` (paylaşılan şekil,
 * `enabled` TAŞIMAZ — o çağıranın sorumluluğudur) kabul eder.
 */
export function HomeJourney({ journey, stepLabel, istanbulLabel }: { journey: HomeJourneyContent; stepLabel: string; istanbulLabel: string }) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const inView = useInView(sectionRef, { once: true, amount: 0.2 });
  const reduceMotion = useReducedMotion();
  const [activeStep, setActiveStep] = useState(0);
  const steps = journey.steps;
  const countries = journey.countries;

  useEffect(() => {
    if (reduceMotion || !inView || steps.length <= 1) return;
    const id = setInterval(() => setActiveStep((current) => (current + 1) % steps.length), ACTIVE_STEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [reduceMotion, inView, steps.length]);

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden bg-[color-mix(in_oklch,var(--site-primary)_38%,black)] text-white"
      aria-labelledby="home-journey-title"
    >
      <div className={cn(aboutContainerClass, "grid gap-12 py-16 lg:grid-cols-2 lg:items-center lg:gap-16 lg:py-28")}>
        <div>
          <Eyebrow className="text-white/70">{journey.eyebrow}</Eyebrow>
          <h2 id="home-journey-title" className="about-serif mt-5 text-[32px] leading-[1.15] text-white sm:text-4xl lg:text-[44px]">
            {journey.title}
          </h2>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-white/75 lg:text-lg">{journey.body}</p>

          <ol className="mt-10 space-y-0">
            {steps.map((step, index) => {
              const active = activeStep === index;
              return (
                <li key={step.id}>
                  <motion.div
                    initial={reduceMotion ? undefined : { opacity: 0, x: -20 }}
                    animate={inView ? { opacity: 1, x: 0 } : undefined}
                    transition={{ duration: 0.5, delay: reduceMotion ? 0 : index * 0.15, ease: "easeOut" }}
                    className={cn(
                      "flex items-start gap-4 rounded-2xl border p-4 transition-all duration-300",
                      active ? "border-[var(--about-accent)]/60 bg-white/10" : "border-white/10 bg-white/[0.03]"
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-300",
                        active ? "bg-[var(--about-accent)] text-white" : "bg-white/15 text-white/80"
                      )}
                    >
                      {iconGlyph(step.icon, "size-5")}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-white/55">
                        {formatSiteString(stepLabel, { number: index + 1 })}
                      </p>
                      <h3 className="mt-1 text-base font-semibold text-white sm:text-lg">{step.title}</h3>
                      {step.text && <p className="mt-1 text-sm leading-relaxed text-white/70">{step.text}</p>}
                    </div>
                  </motion.div>
                  {index < steps.length - 1 && (
                    <motion.div
                      aria-hidden="true"
                      className="ml-[1.875rem] h-5 w-px origin-top bg-white/15"
                      initial={reduceMotion ? undefined : { scaleY: 0 }}
                      animate={inView ? { scaleY: 1 } : undefined}
                      transition={{ duration: 0.3, delay: reduceMotion ? 0 : (index + 1) * 0.15, ease: "easeOut" }}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="relative mx-auto aspect-square w-full max-w-[440px]">
          <svg viewBox={`0 0 ${GLOBE_VIEW} ${GLOBE_VIEW}`} className="h-full w-full" aria-hidden="true">
            <circle cx={GLOBE_CENTER.x} cy={GLOBE_CENTER.y} r={GLOBE_RADIUS} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
            <ellipse
              cx={GLOBE_CENTER.x}
              cy={GLOBE_CENTER.y}
              rx={GLOBE_RADIUS * 0.45}
              ry={GLOBE_RADIUS}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1}
            />
            <ellipse
              cx={GLOBE_CENTER.x}
              cy={GLOBE_CENTER.y}
              rx={GLOBE_RADIUS}
              ry={GLOBE_RADIUS * 0.45}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1}
            />
            {GLOBE_DOTS.map((dot, i) => (
              <circle key={i} cx={dot.x} cy={dot.y} r={1.1} fill="rgba(255,255,255,0.22)" />
            ))}

            {countries.map((country, index) => {
              const point = countryPoint(index, countries.length);
              return (
                <motion.path
                  key={country.id}
                  d={flightPath(point, ISTANBUL_POINT)}
                  fill="none"
                  stroke="var(--about-accent)"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  initial={reduceMotion ? undefined : { pathLength: 0, opacity: 0.4 }}
                  animate={inView ? { pathLength: 1, opacity: 0.85 } : undefined}
                  transition={{ duration: 1.1, delay: reduceMotion ? 0 : 0.3 + index * 0.18, ease: "easeInOut" }}
                />
              );
            })}

            {countries.map((country, index) => {
              const point = countryPoint(index, countries.length);
              return <circle key={country.id} cx={point.x} cy={point.y} r={3} fill="white" />;
            })}

            {/* İstanbul — nabız gibi atan halka (reduced-motion'da statik tek halka). */}
            {!reduceMotion && (
              <motion.circle
                cx={ISTANBUL_POINT.x}
                cy={ISTANBUL_POINT.y}
                r={6}
                fill="none"
                stroke="var(--about-accent)"
                strokeWidth={2}
                initial={{ opacity: 0.7, scale: 1 }}
                animate={inView ? { opacity: [0.7, 0], scale: [1, 2.6] } : undefined}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
                style={{ transformOrigin: `${ISTANBUL_POINT.x}px ${ISTANBUL_POINT.y}px` }}
              />
            )}
            <circle cx={ISTANBUL_POINT.x} cy={ISTANBUL_POINT.y} r={6} fill="var(--about-accent)" />
          </svg>

          {/* Ülke etiketleri — HTML (SVG'nin DIŞINDA), ekran okuyucuya normal metin olarak okunur. */}
          {countries.map((country, index) => {
            const point = countryPoint(index, countries.length);
            return (
              <span
                key={country.id}
                style={{ left: `${toPercent(point.x)}%`, top: `${toPercent(point.y)}%` }}
                className="absolute -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/90 ring-1 ring-white/15 backdrop-blur-sm"
              >
                {country.label}
              </span>
            );
          })}
          <span
            style={{ left: `${toPercent(ISTANBUL_POINT.x)}%`, top: `${toPercent(ISTANBUL_POINT.y)}%` }}
            className="absolute -translate-x-1/2 translate-y-[14px] whitespace-nowrap rounded-full bg-[var(--about-accent)] px-3 py-1 text-[11px] font-bold text-white shadow-lg"
          >
            {istanbulLabel}
          </span>
        </div>
      </div>
    </section>
  );
}
