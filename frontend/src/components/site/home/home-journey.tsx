"use client";

import { useEffect, useId, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { Eyebrow } from "@/components/site/about/eyebrow";
import { aboutContainerClass } from "@/components/site/about/about-buttons";
import { formatSiteString } from "@/lib/i18n/site-dictionaries";
import type { HomeJourneyContent } from "@/lib/home-page";
import { cn } from "@/lib/utils";
import { GLOBE_DOTS } from "./globe-dots";
import { rotate, frontFactor, greatCircleMidpoint, arcLift } from "./globe-math";

/** journey-v3 turu (2026-10-03) — küre artık SÜREKLİ DÖNER (batıdan doğuya, ~40s/tur,
 *  eksen eğimi sabit enlem 32°). journey-v2'nin durağan küresi, `prefers-reduced-motion`
 *  AÇIKKEN ve JS mount OLMADAN ÖNCE (SSR/hydration güvenliği için) hâlâ `StaticGlobe` olarak
 *  render edilir — BİREBİR aynı kod/görünüm (görev dosyası §"Başlangıç görünümü bugünküyle
 *  aynıdır"). Mount olduktan sonra (`!reduceMotion`), `RotatingGlobe`'a geçilir: kara noktaları
 *  `<canvas>`'ta (performans — binlerce SVG düğümü YASAK), çizgi/comet/İstanbul/etiketler SVG/
 *  HTML katmanında ama `ref` ile DOĞRUDAN mutasyon (React state YOK, her karede re-render YOK).
 *  Veri modeli (`HomeJourneyContent`) DEĞİŞMEDİ — bileşen hem `home-page` şablonu hem
 *  `journey-map` bloğu tarafından PAYLAŞILIR. */

/** Adımlar arası döngüsel vurgu aralığı — journey-v2 görev dosyası §"Sol kolon" (2.5s). */
const ACTIVE_STEP_INTERVAL_MS = 2500;
/** Küre SVG koordinat sistemi — `GLOBE_VIEW`/`GLOBE_CENTER`/`GLOBE_RADIUS` yalnızca İÇ ölçek
 *  birimidir, nihai piksel boyutu CSS konteyneri (`aspect-square max-w-[480px]`) belirler. */
const GLOBE_VIEW = 300;
export const GLOBE_CENTER = { x: 150, y: 150 };
export const GLOBE_RADIUS = 122;

/** Statik (journey-v2) görünümün başlangıç rotasyonu — `generate-globe-dots.mjs` İLE AYNI
 *  merkez enlemi (`CENTER_LAT`, eksen eğimi) kullanılır, rotasyon başladığında da DEĞİŞMEZ. */
const CENTER_LON = 25;
const CENTER_LAT = 32;
/** Ön/arka yarım küre eşiği — StaticGlobe'un sabit görünümü için (journey-v2 davranışı). */
const FRONT_HEMISPHERE_MARGIN = 0.03;
/** Bir tam tur süresi — görev dosyası §"Davranış": "~40 saniye". */
const ROTATION_PERIOD_MS = 40000;
const DEGREES_PER_MS = 360 / ROTATION_PERIOD_MS;
/** Fare üzerine gelince/çıkınca hız geçişi — görev dosyası §"Etkileşim": "~600ms ease".
 *  Üstel yumuşatma zaman sabiti (3×TAU ≈ 600ms'de %95 yakınsama). */
const SPEED_EASE_TAU_MS = 200;

/**
 * Transcendental (`Math.cos`/`sin`) sonuçlarını sabit 3 ondalığa yuvarlar — SSR (Node) ve CSR
 * (Chromium) V8 build'leri arasındaki son-bit farkını (bkz. önceki turun hydration dersi)
 * render'a yazılmadan önce emer. Yalnızca STATİK (bir kez hesaplanan) değerler için kullanılır —
 * `RotatingGlobe`'un her-kare hesapları client-only olduğundan (mount sonrası) hydration riski
 * YOKTUR, orada yuvarlama yapılmaz (performans, gereksiz).
 */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

/**
 * Ortografik (orthographic) projeksiyon, SABİT merkez (`CENTER_LON`/`CENTER_LAT`) — StaticGlobe
 * ve test'ler için. `globe-math.ts::rotate`'in bu sabit merkezle çağrılmış hali (journey-v2'nin
 * orijinal `projectLonLat` imzasıyla BİREBİR aynı davranış/API — mevcut testler değişmeden geçer).
 */
export function projectLonLat(lon: number, lat: number): { x: number; y: number; cosC: number } {
  const { x, y, cosC } = rotate(lon, lat, CENTER_LON, CENTER_LAT);
  return { x: round(x), y: round(y), cosC: round(cosC) };
}

/**
 * journey-v2 görev dosyası §"Küre" — 6 varsayılan ülkenin GERÇEK boylam/enlemi (EN + TR
 * etiket yazımı, normalize edilmiş anahtar: küçük harf + trim). Admin panelden eklenen,
 * bu listede OLMAYAN bir ülke (ör. yeni bir admin girdisi) StaticGlobe'da `schematicPoint`'e
 * düşer; RotatingGlobe'da (v3) basitlik için ATLANIR — bkz. `RotatingGlobe` yorumu.
 */
const COUNTRY_COORDINATES: Record<string, { lon: number; lat: number }> = {
  "united kingdom": { lon: -1.5, lat: 52.5 },
  "birleşik krallık": { lon: -1.5, lat: 52.5 },
  germany: { lon: 10.45, lat: 51.17 },
  almanya: { lon: 10.45, lat: 51.17 },
  russia: { lon: 37.6, lat: 55.75 },
  rusya: { lon: 37.6, lat: 55.75 },
  kazakhstan: { lon: 66.9, lat: 48.0 },
  kazakistan: { lon: 66.9, lat: 48.0 },
  "saudi arabia": { lon: 45.0, lat: 24.0 },
  "suudi arabistan": { lon: 45.0, lat: 24.0 },
  "united states": { lon: -95, lat: 38 },
  "amerika birleşik devletleri": { lon: -95, lat: 38 },
};

interface Point {
  x: number;
  y: number;
}

/** Bilinmeyen (haritası olmayan) bir ülke için ESKİ şematik yerleşim — İstanbul'un bulunduğu
 *  çeyrek hariç, küre çevresinde eşit aralıklı. Yalnızca StaticGlobe FALLBACK'i. */
function schematicPoint(index: number, total: number): Point {
  const startDeg = 95;
  const sweepDeg = 250;
  const angleDeg = total <= 1 ? startDeg + sweepDeg / 2 : startDeg + (index * sweepDeg) / (total - 1);
  const angle = (angleDeg * Math.PI) / 180;
  const radius = GLOBE_RADIUS * 0.82;
  return { x: round(GLOBE_CENTER.x + radius * Math.cos(angle)), y: round(GLOBE_CENTER.y + radius * Math.sin(angle)) };
}

/**
 * Bir ülke etiketinin StaticGlobe üzerindeki NİHAİ konumu (journey-v2 davranışı, DEĞİŞMEDİ —
 * "ABD clamp" mantığı yalnızca BURADA/reduced-motion'da kalır, görev dosyası §"Davranış":
 * "`prefers-reduced-motion`: Dönüş YOK. Bugünkü statik görünüm, ABD clamp'ı dahil, aynen
 * kalsın."). `RotatingGlobe` bu fonksiyonu KULLANMAZ — kendi (clamp'sız) mantığına bakın.
 */
export function resolveCountryPosition(label: string, index: number, total: number): { point: Point; onRim: boolean } {
  const coords = COUNTRY_COORDINATES[normalizeLabel(label)];
  if (!coords) return { point: schematicPoint(index, total), onRim: false };

  const { x, y, cosC } = projectLonLat(coords.lon, coords.lat);
  if (cosC > FRONT_HEMISPHERE_MARGIN) {
    return { point: { x: round(GLOBE_CENTER.x + x * GLOBE_RADIUS), y: round(GLOBE_CENTER.y + y * GLOBE_RADIUS) }, onRim: false };
  }
  const length = Math.sqrt(x * x + y * y) || 1;
  const rx = round(GLOBE_CENTER.x + (x / length) * GLOBE_RADIUS);
  const ry = round(GLOBE_CENTER.y + (y / length) * GLOBE_RADIUS);
  return { point: { x: rx, y: ry }, onRim: true };
}

export const ISTANBUL_POINT: Point = (() => {
  const { x, y } = projectLonLat(28.97, 41.01);
  return { x: round(GLOBE_CENTER.x + x * GLOBE_RADIUS), y: round(GLOBE_CENTER.y + y * GLOBE_RADIUS) };
})();

/** `countries.length`'e göre el ile ayarlanmış küçük nüans (dx/dy, SVG birimi) — etiketlerin
 *  birbiriyle/çizgilerle ÇAKIŞMAMASI için. Bilinmeyen bir ülke için `{ dx: 0, dy: -14 }`
 *  (noktanın hemen üstü) varsayılanı kullanılır. Hem StaticGlobe hem RotatingGlobe PAYLAŞIR. */
const LABEL_OFFSETS: Record<string, { dx: number; dy: number }> = {
  "united kingdom": { dx: -6, dy: -14 },
  "birleşik krallık": { dx: -6, dy: -14 },
  germany: { dx: 10, dy: -10 },
  almanya: { dx: 10, dy: -10 },
  russia: { dx: 6, dy: -14 },
  rusya: { dx: 6, dy: -14 },
  kazakhstan: { dx: 0, dy: 16 },
  kazakistan: { dx: 0, dy: 16 },
  "saudi arabia": { dx: 0, dy: 16 },
  "suudi arabistan": { dx: 0, dy: 16 },
  "united states": { dx: -4, dy: 0 },
  "amerika birleşik devletleri": { dx: -4, dy: 0 },
};
const DEFAULT_LABEL_OFFSET = { dx: 0, dy: -14 };

/** Noktaların limb (kenar) soluklaşması için 4 ayrık opaklık katmanı — StaticGlobe'un sabit
 *  görünümü İÇİN (journey-v2 davranışı, DEĞİŞMEDİ). RotatingGlobe artık bunun YERİNE `cosC`
 *  tabanlı `frontFactor` kullanır (bkz. `globe-math.ts` yorumu — aynı amaca hizmet eder, ama
 *  her kare yeniden hesaplanabilir ve arka-yüz gizlemeyle BİRLEŞİKTİR). */
const DOT_FADE_BUCKETS = [
  { maxRadius: 0.4, opacity: 0.55 },
  { maxRadius: 0.7, opacity: 0.42 },
  { maxRadius: 0.9, opacity: 0.28 },
  { maxRadius: Infinity, opacity: 0.16 },
];

/** `GLOBE_DOTS` artık boylam/enlem saklıyor (v3) — StaticGlobe'un sabit kare için BİR KEZ
 *  `projectLonLat` (sabit merkez) ile projekte edilir, arka yarım küre tamamen ATLANIR
 *  (journey-v2'nin ürettiği dosyadaki davranışla AYNI sonuç). Girdi sabit literal'ler olduğu
 *  için SSR/CSR arasında deterministiktir. Modül yüklenince BİR KEZ hesaplanır. */
function buildDotBucketPaths(): { d: string; opacity: number }[] {
  const segments: string[][] = DOT_FADE_BUCKETS.map(() => []);
  for (const [lon, lat] of GLOBE_DOTS) {
    const { x, y, cosC } = projectLonLat(lon, lat);
    if (cosC <= FRONT_HEMISPHERE_MARGIN) continue;
    const radius01 = Math.sqrt(x * x + y * y);
    const bucketIndex = DOT_FADE_BUCKETS.findIndex((b) => radius01 <= b.maxRadius);
    const px = round(GLOBE_CENTER.x + x * GLOBE_RADIUS);
    const py = round(GLOBE_CENTER.y + y * GLOBE_RADIUS);
    segments[bucketIndex === -1 ? DOT_FADE_BUCKETS.length - 1 : bucketIndex]!.push(`M${px} ${py}l0.01 0`);
  }
  return DOT_FADE_BUCKETS.map((bucket, i) => ({ d: segments[i]!.join(""), opacity: bucket.opacity }));
}
const DOT_BUCKET_PATHS = buildDotBucketPaths();

/**
 * İki nokta arasında YUKARI doğru kavis yapan quadratic Bezier — StaticGlobe İÇİN (journey-v2
 * davranışı, DEĞİŞMEDİ). RotatingGlobe kendi great-circle/slerp yay mantığını kullanır (bkz.
 * `globe-math.ts::greatCircleMidpoint`/`arcLift`).
 */
function flightPath(from: Point, to: Point): { d: string; control: Point } {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  const bend = Math.min(42, length * 0.38);
  const control = { x: round(mx), y: round(my - bend) };
  return { d: `M ${from.x} ${from.y} Q ${control.x} ${control.y} ${to.x} ${to.y}`, control };
}

/** Quadratic Bezier'i `steps+1` eşit aralıklı `t` değerinde örnekler — StaticGlobe'un "comet"
 *  noktasının framer-motion keyframe dizileriyle (cx/cy) çizgiyi TAKİP etmesi için. */
function sampleBezier(from: Point, control: Point, to: Point, steps: number): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * from.x + 2 * mt * t * control.x + t * t * to.x;
    const y = mt * mt * from.y + 2 * mt * t * control.y + t * t * to.y;
    xs.push(round(x));
    ys.push(round(y));
  }
  return { xs, ys };
}

interface StepFlowProps {
  steps: HomeJourneyContent["steps"];
  stepLabel: string;
  inView: boolean;
  reduceMotion: boolean;
}

/** Sol kolon — kompakt 2×2 adım akışı. journey-v3'te DEĞİŞMEDİ (görev dosyası §"Kullanıcı
 *  geri bildirimi": "sol kolon... AYNEN kalacak"). */
function StepFlow({ steps, stepLabel, inView, reduceMotion }: StepFlowProps) {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    if (reduceMotion || !inView || steps.length <= 1) return;
    const id = setInterval(() => setActiveStep((current) => (current + 1) % steps.length), ACTIVE_STEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [reduceMotion, inView, steps.length]);

  return (
    <ol className="mt-6 grid grid-cols-2 gap-x-3 gap-y-3">
      {steps.map((step, index) => {
        const active = reduceMotion ? index === 0 : activeStep === index;
        const isRowEnd = index % 2 === 1;
        const nextInRow = !isRowEnd && index + 1 < steps.length;
        return (
          <li key={step.id} className="relative" title={step.text || undefined}>
            <motion.div
              initial={reduceMotion ? undefined : { opacity: 0, y: 10 }}
              animate={inView ? { opacity: 1, y: 0 } : undefined}
              transition={{ duration: 0.4, delay: reduceMotion ? 0 : index * 0.12, ease: "easeOut" }}
              className="flex items-center gap-2.5"
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors duration-500",
                  active ? "bg-[var(--site-primary)] text-white" : "bg-white/10 text-white/70"
                )}
                aria-hidden="true"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 text-sm font-semibold leading-snug text-white">
                {step.title}
                <span className="sr-only">
                  {" "}
                  — {formatSiteString(stepLabel, { number: index + 1 })}
                  {step.text ? `: ${step.text}` : ""}
                </span>
              </span>
              {nextInRow && (
                <motion.span
                  aria-hidden="true"
                  className="ml-auto hidden h-px w-5 shrink-0 bg-white/15 sm:block"
                  initial={false}
                  animate={{ backgroundColor: active ? "var(--site-primary)" : "rgba(255,255,255,0.15)" }}
                  transition={{ duration: 0.4 }}
                />
              )}
            </motion.div>
          </li>
        );
      })}
    </ol>
  );
}

interface ResolvedCountry {
  country: HomeJourneyContent["countries"][number];
  point: Point;
  onRim: boolean;
}

/**
 * journey-v2'nin durağan küresi — BİREBİR DEĞİŞMEDİ. `HomeJourney` bunu (a) SSR'da, (b) client
 * mount OLMADAN ÖNCE (hydration güvenliği) ve (c) `prefers-reduced-motion` AÇIKKEN render eder
 * (görev dosyası §"Davranış": "Bugünkü statik görünüm, ABD clamp'ı dahil, aynen kalsın.").
 */
function StaticGlobe({
  resolvedCountries,
  istanbulLabel,
  glowId,
  inView,
  reduceMotion,
}: {
  resolvedCountries: ResolvedCountry[];
  istanbulLabel: string;
  glowId: string;
  inView: boolean;
  reduceMotion: boolean;
}) {
  return (
    <div className="relative h-full w-full">
      <svg viewBox={`0 0 ${GLOBE_VIEW} ${GLOBE_VIEW}`} className="relative h-full w-full" aria-hidden="true">
        <defs>
          <filter id={`journey-glow-${glowId}`} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="1.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {resolvedCountries.map(({ country, point }) => (
            <linearGradient
              key={country.id}
              id={`journey-line-${glowId}-${country.id}`}
              gradientUnits="userSpaceOnUse"
              x1={point.x}
              y1={point.y}
              x2={ISTANBUL_POINT.x}
              y2={ISTANBUL_POINT.y}
            >
              <stop offset="0%" stopColor="var(--site-primary)" stopOpacity={0.15} />
              <stop offset="50%" stopColor="var(--site-primary)" stopOpacity={0.95} />
              <stop offset="100%" stopColor="var(--site-primary)" stopOpacity={0.25} />
            </linearGradient>
          ))}
        </defs>

        <circle cx={GLOBE_CENTER.x} cy={GLOBE_CENTER.y} r={GLOBE_RADIUS} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={1} />

        {DOT_BUCKET_PATHS.map((bucket, i) =>
          bucket.d ? (
            <path key={i} d={bucket.d} stroke="var(--site-primary)" strokeWidth={1.8} strokeLinecap="round" opacity={bucket.opacity} fill="none" />
          ) : null
        )}

        {resolvedCountries.map(({ country, point }, index) => {
          const { d } = flightPath(point, ISTANBUL_POINT);
          return (
            <motion.path
              key={country.id}
              data-flight-line={country.id}
              d={d}
              fill="none"
              stroke={`url(#journey-line-${glowId}-${country.id})`}
              strokeWidth={1.6}
              strokeLinecap="round"
              initial={reduceMotion ? undefined : { pathLength: 0 }}
              animate={inView ? { pathLength: 1 } : undefined}
              transition={{ duration: 1, delay: reduceMotion ? 0 : 0.2 + index * 0.4, ease: "easeInOut" }}
            />
          );
        })}

        {!reduceMotion &&
          resolvedCountries.map(({ country, point }, index) => {
            const { control } = flightPath(point, ISTANBUL_POINT);
            const { xs, ys } = sampleBezier(point, control, ISTANBUL_POINT, 10);
            const drawDelay = 0.2 + index * 0.4;
            return (
              <motion.circle
                key={country.id}
                data-comet={country.id}
                r={2}
                fill="var(--site-primary)"
                filter={`url(#journey-glow-${glowId})`}
                initial={{ opacity: 0 }}
                animate={inView ? { cx: xs, cy: ys, opacity: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0] } : undefined}
                transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 0.5, delay: drawDelay + 1, ease: "linear" }}
              />
            );
          })}

        {resolvedCountries.map(({ country, point }) => (
          <circle key={country.id} cx={point.x} cy={point.y} r={2.6} fill="white" />
        ))}

        {!reduceMotion && (
          <>
            <motion.circle
              cx={ISTANBUL_POINT.x}
              cy={ISTANBUL_POINT.y}
              r={5}
              fill="none"
              stroke="var(--site-primary)"
              strokeWidth={1.5}
              initial={{ opacity: 0.6, scale: 1 }}
              animate={inView ? { opacity: [0.6, 0], scale: [1, 2.4] } : undefined}
              transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
              style={{ transformOrigin: `${ISTANBUL_POINT.x}px ${ISTANBUL_POINT.y}px` }}
            />
            <motion.circle
              cx={ISTANBUL_POINT.x}
              cy={ISTANBUL_POINT.y}
              r={5}
              fill="none"
              stroke="var(--site-primary)"
              strokeWidth={1.5}
              initial={{ opacity: 0.6, scale: 1 }}
              animate={inView ? { opacity: [0.6, 0], scale: [1, 2.4] } : undefined}
              transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: 1 }}
              style={{ transformOrigin: `${ISTANBUL_POINT.x}px ${ISTANBUL_POINT.y}px` }}
            />
          </>
        )}
        <circle cx={ISTANBUL_POINT.x} cy={ISTANBUL_POINT.y} r={4.5} fill="white" />
      </svg>

      {resolvedCountries.map(({ country, point }) => {
        const offset = LABEL_OFFSETS[normalizeLabel(country.label)] ?? DEFAULT_LABEL_OFFSET;
        const leftPct = round(((point.x + offset.dx) / GLOBE_VIEW) * 100);
        const topPct = round(((point.y + offset.dy) / GLOBE_VIEW) * 100);
        return (
          <span
            key={country.id}
            style={{ left: `${leftPct}%`, top: `${topPct}%` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-black/40 px-2 py-0.5 text-[9px] font-medium text-white ring-1 ring-white/15 backdrop-blur-sm sm:text-[10px]"
          >
            {country.label}
          </span>
        );
      })}
      <span
        style={{
          left: `${round((ISTANBUL_POINT.x / GLOBE_VIEW) * 100)}%`,
          top: `${round((ISTANBUL_POINT.y / GLOBE_VIEW) * 100)}%`,
        }}
        className="absolute -translate-x-1/2 translate-y-[12px] whitespace-nowrap rounded-full bg-[var(--site-primary)] px-2.5 py-0.5 text-[9px] font-bold tracking-wide shadow-lg sm:text-[10px]"
      >
        <span style={{ color: "color-mix(in oklch, var(--site-primary) 15%, black)" }}>{istanbulLabel.toUpperCase()}</span>
      </span>
    </div>
  );
}

/**
 * journey-v3 (2026-10-03) — SÜREKLİ DÖNEN küre. Yalnızca client'ta, mount sonrası ve
 * `!reduceMotion` iken render edilir (`HomeJourney` bkz.) — hydration riski YOKTUR. Kara
 * noktaları `<canvas>`'ta çizilir (görev dosyası §"Teknik yaklaşım": "3.000+ noktayı her
 * karede SVG düğümü olarak güncellemek YASAK"); çizgiler/comet'ler/İstanbul/etiketler SVG/HTML
 * katmanında ama `ref` ile DOĞRUDAN mutasyon — her karede React state güncellemesi YOKTUR.
 *
 * Basitleştirme (bilinçli, raporda belirtilir): haritası olmayan (bilinmeyen) bir ülke dönen
 * küre modunda ATLANIR (StaticGlobe'daki şematik yedek burada uygulanmaz) — admin varsayılan 6
 * ülkenin tamamı bilinen koordinatlara sahip olduğu için bu nadir bir admin-girdisi durumudur.
 * Ayrıca uçuş çizgisinin arka-yüzde kalan kısmı SEGMENT BAŞINA DEĞİL, çizginin TÜMÜ İÇİN tek bir
 * opaklık çarpanıyla (iki ucun `frontFactor`'ının minimumu) soluklaştırılır — per-vertex opaklık
 * gradyanı yerine bu basitleştirme, görsel sonucu büyük ölçüde korurken DOM/hesap karmaşıklığını
 * azaltır.
 */
function RotatingGlobe({ countries, istanbulLabel }: { countries: HomeJourneyContent["countries"]; istanbulLabel: string }) {
  const glowId = useId().replace(/:/g, "");
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lineRefs = useRef(new Map<string, SVGPathElement>());
  const cometRefs = useRef(new Map<string, SVGCircleElement>());
  const dotRefs = useRef(new Map<string, SVGCircleElement>());
  const labelRefs = useRef(new Map<string, HTMLSpanElement>());
  const istanbulGroupRef = useRef<SVGGElement>(null);
  const istanbulLabelRef = useRef<HTMLSpanElement>(null);

  const known = countries
    .map((country, index) => ({ country, index, coords: COUNTRY_COORDINATES[normalizeLabel(country.label)] }))
    .filter((entry): entry is { country: HomeJourneyContent["countries"][number]; index: number; coords: { lon: number; lat: number } } =>
      Boolean(entry.coords)
    );

  useEffect(() => {
    const containerEl = containerRef.current;
    const canvasEl = canvasRef.current;
    if (!containerEl || !canvasEl) return;
    // Nested closures aşağıda `container`/`canvas`'ı YAKALAR — TS null-narrowing'i closure
    // sınırları arasında korumadığı için sabit (non-null) yerel isimlere atanır.
    const container = containerEl;
    const canvas = canvasEl;
    const ctx = canvas.getContext("2d");
    const dotColor = getComputedStyle(container).color || "rgba(74, 185, 225, 1)";

    let dpr = 1;
    let cssToView = 1; // canvas CSS-piksel -> GLOBE_VIEW birimi ölçeği
    let rotationLon = CENTER_LON;
    let speed = 1;
    let targetSpeed = 1;
    let drawResetTime: number | null = null;
    let istanbulWasFront = false;
    let lastTs: number | null = null;
    let rafId: number | null = null;
    let sectionVisible = false;

    function resizeCanvas() {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      cssToView = rect.width / GLOBE_VIEW;
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawDots() {
      if (!ctx) return;
      const widthCss = canvas.width / dpr;
      const heightCss = canvas.height / dpr;
      ctx.clearRect(0, 0, widthCss, heightCss);
      const skipOdd = window.innerWidth < 768;
      for (let i = 0; i < GLOBE_DOTS.length; i++) {
        if (skipOdd && i % 2 === 1) continue;
        const [lon, lat] = GLOBE_DOTS[i]!;
        const { x, y, cosC } = rotate(lon, lat, rotationLon, CENTER_LAT);
        const factor = frontFactor(cosC);
        if (factor <= 0) continue;
        const px = (GLOBE_CENTER.x + x * GLOBE_RADIUS) * cssToView;
        const py = (GLOBE_CENTER.y + y * GLOBE_RADIUS) * cssToView;
        ctx.globalAlpha = 0.55 * factor;
        ctx.fillStyle = dotColor;
        ctx.beginPath();
        ctx.arc(px, py, 1.1 * cssToView, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function updateOverlay(now: number) {
      const istanbul = rotate(28.97, 41.01, rotationLon, CENTER_LAT);
      const istanbulFactor = frontFactor(istanbul.cosC);
      const istanbulFront = istanbul.cosC > FRONT_HEMISPHERE_MARGIN;
      if (istanbulFront && !istanbulWasFront) drawResetTime = now;
      istanbulWasFront = istanbulFront;

      const ix = GLOBE_CENTER.x + istanbul.x * GLOBE_RADIUS;
      const iy = GLOBE_CENTER.y + istanbul.y * GLOBE_RADIUS;
      if (istanbulGroupRef.current) {
        istanbulGroupRef.current.setAttribute("transform", `translate(${ix - GLOBE_CENTER.x} ${iy - GLOBE_CENTER.y})`);
        istanbulGroupRef.current.style.opacity = String(istanbulFactor);
      }
      if (istanbulLabelRef.current) {
        istanbulLabelRef.current.style.left = `${(ix / GLOBE_VIEW) * 100}%`;
        istanbulLabelRef.current.style.top = `${(iy / GLOBE_VIEW) * 100}%`;
        istanbulLabelRef.current.style.opacity = String(istanbulFactor);
      }

      known.forEach(({ country, index, coords }) => {
        const p = rotate(coords.lon, coords.lat, rotationLon, CENTER_LAT);
        const factor = frontFactor(p.cosC);
        const px = GLOBE_CENTER.x + p.x * GLOBE_RADIUS;
        const py = GLOBE_CENTER.y + p.y * GLOBE_RADIUS;

        const dot = dotRefs.current.get(country.id);
        if (dot) {
          dot.setAttribute("cx", String(px));
          dot.setAttribute("cy", String(py));
          dot.style.opacity = String(factor);
        }
        const label = labelRefs.current.get(country.id);
        if (label) {
          const offset = LABEL_OFFSETS[normalizeLabel(country.label)] ?? DEFAULT_LABEL_OFFSET;
          label.style.left = `${((px + offset.dx) / GLOBE_VIEW) * 100}%`;
          label.style.top = `${((py + offset.dy) / GLOBE_VIEW) * 100}%`;
          label.style.opacity = String(factor);
        }

        const line = lineRefs.current.get(country.id);
        const comet = cometRefs.current.get(country.id);
        if (!line) return;

        const STEPS = 20;
        let d = "";
        for (let s = 0; s <= STEPS; s++) {
          const t = s / STEPS;
          const { lon, lat } = greatCircleMidpoint(coords.lon, coords.lat, 28.97, 41.01, t);
          const sp = rotate(lon, lat, rotationLon, CENTER_LAT);
          const lift = arcLift(t);
          const sx = GLOBE_CENTER.x + sp.x * GLOBE_RADIUS * lift;
          const sy = GLOBE_CENTER.y + sp.y * GLOBE_RADIUS * lift;
          d += s === 0 ? `M${sx} ${sy}` : `L${sx} ${sy}`;
        }
        line.setAttribute("d", d);

        const delay = index * 0.4;
        const elapsedSeconds = drawResetTime == null ? 0 : (now - drawResetTime) / 1000 - delay;
        const progress = istanbulFront ? Math.max(0, Math.min(1, elapsedSeconds)) : 0;
        const lineOpacity = Math.min(factor, istanbulFactor) * progress;
        line.style.strokeDashoffset = String(1 - progress);
        line.style.opacity = String(lineOpacity);

        if (comet) {
          const visible = istanbulFront && progress >= 1 && lineOpacity > 0.05;
          comet.style.opacity = visible ? "1" : "0";
          if (visible) {
            const cometT = ((now / 1500 + index * 0.3) % 1 + 1) % 1;
            const { lon, lat } = greatCircleMidpoint(coords.lon, coords.lat, 28.97, 41.01, cometT);
            const sp = rotate(lon, lat, rotationLon, CENTER_LAT);
            const lift = arcLift(cometT);
            comet.setAttribute("cx", String(GLOBE_CENTER.x + sp.x * GLOBE_RADIUS * lift));
            comet.setAttribute("cy", String(GLOBE_CENTER.y + sp.y * GLOBE_RADIUS * lift));
          }
        }
      });
    }

    function loop(ts: number) {
      rafId = null;
      if (!sectionVisible || document.visibilityState !== "visible") return;
      const dt = lastTs == null ? 16 : Math.min(ts - lastTs, 100);
      lastTs = ts;
      speed += (targetSpeed - speed) * (1 - Math.exp(-dt / SPEED_EASE_TAU_MS));
      rotationLon += DEGREES_PER_MS * dt * speed;
      drawDots();
      updateOverlay(ts);
      rafId = requestAnimationFrame(loop);
    }

    function start() {
      if (rafId != null) return;
      lastTs = null;
      rafId = requestAnimationFrame(loop);
    }
    function stop() {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    resizeCanvas();
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(resizeCanvas);
      resizeObserver.observe(container);
    }

    const io = new IntersectionObserver(
      (entries) => {
        sectionVisible = entries[0]?.isIntersecting ?? false;
        if (sectionVisible && document.visibilityState === "visible") start();
        else stop();
      },
      { threshold: 0.1 }
    );
    io.observe(container);

    function onVisibilityChange() {
      if (document.visibilityState === "visible" && sectionVisible) start();
      else stop();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    function onPointerEnter() {
      targetSpeed = 0;
    }
    function onPointerLeave() {
      targetSpeed = 1;
    }
    container.addEventListener("pointerenter", onPointerEnter);
    container.addEventListener("pointerleave", onPointerLeave);

    return () => {
      stop();
      resizeObserver?.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      container.removeEventListener("pointerenter", onPointerEnter);
      container.removeEventListener("pointerleave", onPointerLeave);
    };
    // `known`/`istanbulLabel` kasıtlı olarak dependency listesinde DEĞİL: ülke listesi bir
    // sayfa ömrü boyunca değişmez (admin içerik değişikliği her zaman tam sayfa yeniden yükler),
    // döngüyü her render'da yeniden kurmak performans kaybı olurdu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countries.length]);

  return (
    <div ref={containerRef} className="relative h-full w-full" style={{ color: "var(--site-primary)" }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      <svg viewBox={`0 0 ${GLOBE_VIEW} ${GLOBE_VIEW}`} className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <filter id={`journey-glow-${glowId}`} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="1.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx={GLOBE_CENTER.x} cy={GLOBE_CENTER.y} r={GLOBE_RADIUS} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={1} />

        {known.map(({ country }) => (
          <path
            key={country.id}
            ref={(el) => {
              if (el) lineRefs.current.set(country.id, el);
              else lineRefs.current.delete(country.id);
            }}
            data-flight-line={country.id}
            pathLength={1}
            style={{ strokeDasharray: "1", strokeDashoffset: "1", opacity: 0 }}
            fill="none"
            stroke="var(--site-primary)"
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        ))}

        {known.map(({ country }) => (
          <circle
            key={country.id}
            ref={(el) => {
              if (el) cometRefs.current.set(country.id, el);
              else cometRefs.current.delete(country.id);
            }}
            data-comet={country.id}
            r={2}
            fill="var(--site-primary)"
            filter={`url(#journey-glow-${glowId})`}
            style={{ opacity: 0 }}
          />
        ))}

        {known.map(({ country }) => (
          <circle
            key={country.id}
            ref={(el) => {
              if (el) dotRefs.current.set(country.id, el);
              else dotRefs.current.delete(country.id);
            }}
            r={2.6}
            fill="white"
            style={{ opacity: 0 }}
          />
        ))}

        <g ref={istanbulGroupRef} style={{ opacity: 0 }}>
          <motion.circle
            cx={GLOBE_CENTER.x}
            cy={GLOBE_CENTER.y}
            r={5}
            fill="none"
            stroke="var(--site-primary)"
            strokeWidth={1.5}
            initial={{ opacity: 0.6, scale: 1 }}
            animate={{ opacity: [0.6, 0], scale: [1, 2.4] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
            style={{ transformOrigin: `${GLOBE_CENTER.x}px ${GLOBE_CENTER.y}px` }}
          />
          <motion.circle
            cx={GLOBE_CENTER.x}
            cy={GLOBE_CENTER.y}
            r={5}
            fill="none"
            stroke="var(--site-primary)"
            strokeWidth={1.5}
            initial={{ opacity: 0.6, scale: 1 }}
            animate={{ opacity: [0.6, 0], scale: [1, 2.4] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: 1 }}
            style={{ transformOrigin: `${GLOBE_CENTER.x}px ${GLOBE_CENTER.y}px` }}
          />
          <circle cx={GLOBE_CENTER.x} cy={GLOBE_CENTER.y} r={4.5} fill="white" />
        </g>
      </svg>

      {known.map(({ country }) => (
        <span
          key={country.id}
          ref={(el) => {
            if (el) labelRefs.current.set(country.id, el);
            else labelRefs.current.delete(country.id);
          }}
          style={{ left: "50%", top: "50%", opacity: 0 }}
          className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-black/40 px-2 py-0.5 text-[9px] font-medium text-white ring-1 ring-white/15 backdrop-blur-sm sm:text-[10px]"
        >
          {country.label}
        </span>
      ))}
      <span
        ref={istanbulLabelRef}
        style={{ left: "50%", top: "50%", opacity: 0 }}
        className="absolute -translate-x-1/2 translate-y-[12px] whitespace-nowrap rounded-full bg-[var(--site-primary)] px-2.5 py-0.5 text-[9px] font-bold tracking-wide shadow-lg sm:text-[10px]"
      >
        <span style={{ color: "color-mix(in oklch, var(--site-primary) 15%, black)" }}>{istanbulLabel.toUpperCase()}</span>
      </span>
    </div>
  );
}

/**
 * "From Across the World to Istanbul" (journey-v3, 2026-10-03) — kompakt sol kolon (DEĞİŞMEDİ)
 * ve sağda GERÇEK kıtalı, SÜREKLİ DÖNEN bir ortografik küre (batıdan doğuya, ~40s/tur, eksen
 * eğimi sabit enlem 32°). Mount olmadan önce / `prefers-reduced-motion` AÇIKKEN journey-v2'nin
 * durağan görünümü (BİREBİR AYNI) render edilir — bkz. `StaticGlobe`. Mount sonrası ve hareket
 * açıkken `RotatingGlobe`'a geçilir. Zemin `--site-accent`'in siyaha karışmış çok koyu tonu
 * (`color-mix`, SABİT HEX YOK) — journey-v2'den DEĞİŞMEDİ.
 *
 * Paylaşılan bileşen — hem `home-page` şablonu hem `journey-map` bloğu BU bileşeni kullanır,
 * koda ikinci bir kopyası YOKTUR. `journey` prop'u `HomeJourneyContent` kabul eder.
 */
export function HomeJourney({ journey, stepLabel, istanbulLabel }: { journey: HomeJourneyContent; stepLabel: string; istanbulLabel: string }) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const inView = useInView(sectionRef, { once: true, amount: 0.2 });
  const rawReduceMotion = useReducedMotion();
  const glowId = useId().replace(/:/g, "");
  const steps = journey.steps;
  const countries = journey.countries;
  const [mounted, setMounted] = useState(false);

  // Kaçınılmaz SSR/hydration deseni (bkz. `theme-toggle.tsx`): sunucu asla "mounted" olamaz,
  // bu yüzden ilk client render'dan sonra bir kez senkron olarak işaretlenir.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  /**
   * KRİTİK hydration güvenliği: `useReducedMotion()` sunucuda HER ZAMAN `null` döner, ama
   * istemcinin İLK (hydration) render'ında — OS düzeyinde "reduce motion" AÇIK bir kullanıcıda —
   * `matchMedia` SENKRON olarak `true` çözümlenebilir (Playwright'ın `reducedMotion: "reduce"`
   * emülasyonuyla DOĞRULANDI: ham `reduceMotion` doğrudan JSX dallanmasında kullanılırsa "Hydration
   * failed" hatası verir — SSR `null`→falsy dalı render ederken client'ın hydration-pass'i
   * `true`→diğer dalı render eder). Çözüm: `mounted` olmadan ÖNCE (SSR + ilk client render)
   * `reduceMotion` HER ZAMAN `false` sayılır (her iki taraf da AYNI dalı render eder, mismatch
   * YOK) — gerçek OS tercihi yalnızca mount SONRASI, sıradan (hydration'dan BAĞIMSIZ) bir
   * re-render'da uygulanır. `StaticGlobe`/`GlobeFloat`/`StepFlow` ARTIK ham hook değerini DEĞİL,
   * bu "etkin" değeri alır.
   */
  const reduceMotion = mounted ? (rawReduceMotion ?? false) : false;

  /** Mount olmadan önce (SSR + hydration güvenli ilk kare) HER ZAMAN StaticGlobe — görev
   *  dosyası §"Davranış": "Başlangıç görünümü bugünküyle aynıdır... tasarım değişmiş gibi
   *  görünmemeli." `reduceMotion` açıkken kalıcı olarak StaticGlobe (clamp dahil, AYNEN). */
  const animated = mounted && reduceMotion === false;

  const resolvedCountries = countries.map((country, index) => ({
    country,
    ...resolveCountryPosition(country.label, index, countries.length),
  }));

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden bg-[color-mix(in_oklch,var(--site-accent)_32%,black)] text-white"
      aria-labelledby="home-journey-title"
    >
      <div
        className={cn(
          aboutContainerClass,
          "grid gap-8 py-10 sm:py-12 lg:grid-cols-[45%_55%] lg:items-center lg:gap-10 lg:py-11"
        )}
      >
        {/* Mobilde küre ÜSTTE (~300px), masaüstünde sağ kolon — görev dosyası §"Mobil". */}
        <div className="order-1 lg:order-2">
          <div className="relative mx-auto aspect-square w-full max-w-[220px] sm:max-w-[300px] lg:max-w-[460px]">
            {/* Kürenin arkasında hafif radyal ışıma. */}
            <div
              aria-hidden="true"
              className="absolute inset-[-12%] rounded-full opacity-60 blur-2xl"
              style={{ background: "radial-gradient(circle, color-mix(in oklch, var(--site-primary) 35%, transparent), transparent 70%)" }}
            />
            <GlobeFloat reduceMotion={reduceMotion}>
              {animated ? (
                <RotatingGlobe countries={countries} istanbulLabel={istanbulLabel} />
              ) : (
                <StaticGlobe
                  resolvedCountries={resolvedCountries}
                  istanbulLabel={istanbulLabel}
                  glowId={glowId}
                  inView={inView}
                  reduceMotion={reduceMotion}
                />
              )}
            </GlobeFloat>
          </div>
        </div>

        {/* Sol kolon — kompakt metin + adım akışı. journey-v3'te DEĞİŞMEDİ. */}
        <div className="order-2 lg:order-1">
          <Eyebrow className="text-white/70">{journey.eyebrow}</Eyebrow>
          <h2
            id="home-journey-title"
            className="about-serif mt-3 text-[26px] leading-[1.2] text-white [-webkit-box-orient:vertical] [display:-webkit-box] [-webkit-line-clamp:2] overflow-hidden sm:text-[30px] lg:text-[36px]"
          >
            {journey.title}
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/75 [-webkit-box-orient:vertical] [display:-webkit-box] [-webkit-line-clamp:3] overflow-hidden lg:text-base">
            {journey.body}
          </p>

          <StepFlow steps={steps} stepLabel={stepLabel} inView={inView} reduceMotion={reduceMotion} />
        </div>
      </div>
    </section>
  );
}

/** Küre çok yavaş (6-8s) yukarı-aşağı 4px "float" yapar — isteğe bağlı ince hareket,
 *  journey-v2'den DEĞİŞMEDİ. `prefers-reduced-motion` açıkken TAMAMEN statik. */
function GlobeFloat({ children, reduceMotion }: { children: React.ReactNode; reduceMotion: boolean }) {
  if (reduceMotion) return <>{children}</>;
  return (
    <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }} className="h-full w-full">
      {children}
    </motion.div>
  );
}
