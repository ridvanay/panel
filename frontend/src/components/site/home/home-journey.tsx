"use client";

import { useEffect, useId, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { Eyebrow } from "@/components/site/about/eyebrow";
import { aboutContainerClass } from "@/components/site/about/about-buttons";
import { formatSiteString } from "@/lib/i18n/site-dictionaries";
import type { HomeJourneyContent } from "@/lib/home-page";
import { cn } from "@/lib/utils";
import { GLOBE_DOTS } from "./globe-dots";

/** journey-v2 turu (2026-10-03) — küre artık GERÇEK kıtalı (bkz. `globe-dots.ts` + bu dosyanın
 *  kendi ortografik projeksiyonu), kompakt bir sol kolon (~560px masaüstü yükseklik hedefi).
 *  Önceki şematik "düz daire" küre TAMAMEN değiştirildi. Veri modeli (`HomeJourneyContent`)
 *  DEĞİŞMEDİ — bu bileşen hem `home-page` şablonu hem `journey-map` bloğu tarafından PAYLAŞILIR,
 *  kod kopyalanmadı (önceki turdaki AYNI ilke). */

/** Adımlar arası döngüsel vurgu aralığı — journey-v2 görev dosyası §"Sol kolon" (2.5s). */
const ACTIVE_STEP_INTERVAL_MS = 2500;
/** Küre SVG koordinat sistemi — `GLOBE_VIEW`/`GLOBE_CENTER`/`GLOBE_RADIUS` yalnızca İÇ ölçek
 *  birimidir, nihai piksel boyutu CSS konteyneri (`aspect-square max-w-[480px]`) belirler. */
const GLOBE_VIEW = 300;
export const GLOBE_CENTER = { x: 150, y: 150 };
export const GLOBE_RADIUS = 122;

/** `frontend/scripts/generate-globe-dots.mjs` İLE BİREBİR AYNI merkez — değiştirilirse
 *  `globe-dots.ts` YENİDEN ÜRETİLMELİDİR (ikisi senkron olmak zorunda). */
const CENTER_LON = 25;
const CENTER_LAT = 32;
/** Ön/arka yarım küre eşiği — `generate-globe-dots.mjs` İLE AYNI değer. */
const FRONT_HEMISPHERE_MARGIN = 0.03;

/**
 * Transcendental (`Math.cos`/`sin`) sonuçlarını sabit 3 ondalığa yuvarlar — SSR (Node) ve CSR
 * (Chromium) V8 build'leri arasındaki son-bit farkını (bkz. önceki turun hydration dersi)
 * render'a yazılmadan önce emer. `Math.hypot` (IEEE754 "doğru yuvarlama" garantisi OLMAYAN
 * tek fonksiyon) bu dosyada HİÇ kullanılmaz — uzunluk hesapları her zaman `Math.sqrt(a*a+b*b)`
 * ile yapılır (GARANTİLİ doğru yuvarlanmış sonuç).
 */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Ortografik (orthographic) projeksiyon — `d3-geo::geoOrthographic().rotate([-CENTER_LON,
 * -CENTER_LAT]).scale(1)` ile SAYISAL OLARAK DOĞRULANMIŞTIR (bkz. `generate-globe-dots.mjs`
 * dosya başı yorumu) — bu runtime fonksiyonu AYNI merkezle ÇAĞRILAN ülke noktalarının
 * `globe-dots.ts`'teki kara kütlesiyle doğru hizalanmasını garanti eder. `y` EKRAN/d3
 * konvansiyonuyla AYNI yönde (kuzey = daha KÜÇÜK/negatif y = ekranda yukarı).
 * Döndürülen `x`/`y` birim çember üzerindedir (yarıçap≈1, GLOBE_RADIUS'a göre ölçeklenmemiş).
 */
export function projectLonLat(lon: number, lat: number): { x: number; y: number; cosC: number } {
  const toRad = Math.PI / 180;
  const phi0 = CENTER_LAT * toRad;
  const phi = lat * toRad;
  const dLambda = (lon - CENTER_LON) * toRad;
  const sinPhi0 = Math.sin(phi0);
  const cosPhi0 = Math.cos(phi0);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const cosDLambda = Math.cos(dLambda);
  const cosC = sinPhi0 * sinPhi + cosPhi0 * cosPhi * cosDLambda;
  const x = cosPhi * Math.sin(dLambda);
  const y = sinPhi0 * cosPhi * cosDLambda - cosPhi0 * sinPhi;
  return { x: round(x), y: round(y), cosC: round(cosC) };
}

/**
 * journey-v2 görev dosyası §"Küre" — 6 varsayılan ülkenin GERÇEK boylam/enlemi (EN + TR
 * etiket yazımı, normalize edilmiş anahtar: küçük harf + trim). Admin panelden eklenen,
 * bu listede OLMAYAN bir ülke (ör. yeni bir admin girdisi) `schematicPoint`'e (altta) düşer —
 * hiçbir zaman render'dan TAMAMEN KAYBOLMAZ, sadece coğrafi hassasiyeti olmaz.
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
 *  çeyrek hariç, küre çevresinde eşit aralıklı. Yalnızca FALLBACK — asla birincil yol DEĞİL. */
function schematicPoint(index: number, total: number): Point {
  const startDeg = 95;
  const sweepDeg = 250;
  const angleDeg = total <= 1 ? startDeg + sweepDeg / 2 : startDeg + (index * sweepDeg) / (total - 1);
  const angle = (angleDeg * Math.PI) / 180;
  const radius = GLOBE_RADIUS * 0.82;
  return { x: round(GLOBE_CENTER.x + radius * Math.cos(angle)), y: round(GLOBE_CENTER.y + radius * Math.sin(angle)) };
}

/**
 * Bir ülke etiketinin küre üzerindeki NİHAİ konumu (GLOBE_CENTER'a göre MUTLAK SVG koordinatı).
 * Ön yarım küredeyse (`cosC > eşik`) gerçek projeksiyon konumu; ARKA yarım küredeyse (ör. ABD)
 * yön vektörü (x,y) NORMALİZE EDİLİP kürenin KENARINA "clamp" edilir — bu yön açısı (bearing)
 * arka/ön ayrımından BAĞIMSIZ olarak her zaman doğrudur (ortografik projeksiyonun bilinen bir
 * özelliği), bu yüzden "ABD solda, kenarın dışında" görünümü coğrafi olarak TUTARLI kalır
 * (referanstaki "Amerika" gibi — görev dosyası §"Küre").
 */
export function resolveCountryPosition(label: string, index: number, total: number): { point: Point; onRim: boolean } {
  const coords = COUNTRY_COORDINATES[label.trim().toLowerCase()];
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
 *  birbiriyle/çizgilerle ÇAKIŞMAMASI için (görev dosyası §"Ülke etiketleri"). Bilinmeyen bir
 *  ülke için `{ dx: 0, dy: -14 }` (noktanın hemen üstü) varsayılanı kullanılır. */
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

/** Noktaların limb (kenar) soluklaşması için 4 ayrık opaklık katmanı — binlerce <circle> YERİNE
 *  katman başına TEK <path> (performans, görev dosyası §"Performans"). Taban opaklık ~%55
 *  (görev dosyası), kenara doğru azalır. */
const DOT_FADE_BUCKETS = [
  { maxRadius: 0.4, opacity: 0.55 },
  { maxRadius: 0.7, opacity: 0.42 },
  { maxRadius: 0.9, opacity: 0.28 },
  { maxRadius: Infinity, opacity: 0.16 },
];

/** `GLOBE_DOTS` (bkz. dosya başı import, `globe-dots.ts`) zaten SABİT/yuvarlanmış sayılar
 *  taşıdığı için buradaki `Math.sqrt` (limb mesafesi) ve ölçekleme SSR/CSR arasında
 *  deterministiktir — girdi SABİT literal'ler, `Math.sqrt` IEEE754 garantili. Modül
 *  yüklenince BİR KEZ hesaplanır. */
function buildDotBucketPaths(): { d: string; opacity: number }[] {
  const segments: string[][] = DOT_FADE_BUCKETS.map(() => []);
  for (const [px, py] of GLOBE_DOTS) {
    const ux = px / 100;
    const uy = py / 100;
    const radius01 = Math.sqrt(ux * ux + uy * uy);
    const bucketIndex = DOT_FADE_BUCKETS.findIndex((b) => radius01 <= b.maxRadius);
    const x = round(GLOBE_CENTER.x + ux * GLOBE_RADIUS);
    const y = round(GLOBE_CENTER.y + uy * GLOBE_RADIUS);
    segments[bucketIndex === -1 ? DOT_FADE_BUCKETS.length - 1 : bucketIndex]!.push(`M${x} ${y}l0.01 0`);
  }
  return DOT_FADE_BUCKETS.map((bucket, i) => ({ d: segments[i]!.join(""), opacity: bucket.opacity }));
}
const DOT_BUCKET_PATHS = buildDotBucketPaths();

/**
 * İki nokta arasında YUKARI doğru kavis yapan quadratic Bezier — kontrol noktası düz çizginin
 * orta noktasının HEMEN ÜSTÜNDE (perpendicular-to-chord DEĞİL, dikey sabit kaldırma — her zaman
 * "yukarı" garantisi, görev dosyası §"Uçuş çizgileri"). Uzunluk `Math.sqrt` ile (hypot DEĞİL).
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

/** Quadratic Bezier'i `steps+1` eşit aralıklı `t` değerinde örnekler — "comet" noktasının
 *  framer-motion keyframe dizileriyle (cx/cy) çizgiyi TAKİP etmesi için (offset-path/
 *  animateMotion YERİNE — tarayıcı desteği/test kolaylığı). */
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

/** Sol kolon — kompakt 2×2 adım akışı (büyük kartlar YERİNE numara dairesi + tek satır başlık,
 *  görev dosyası §"Sol kolon"). Açıklama metni (`step.text`) GÖRSEL OLARAK gösterilmez, `title`
 *  niteliği + `sr-only` metin olarak erişilebilir kalır. */
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

/**
 * "From Across the World to Istanbul" (journey-v2, 2026-10-03) — kompakt sol kolon (eyebrow +
 * ≤2 satır başlık + ≤3 satır metin + 2×2 kompakt adım akışı) ve sağda GERÇEK kıtalı, nokta-
 * matrisli bir ortografik küre (merkez ~boylam 25°/enlem 32° — Avrupa/Orta Doğu/Rusya önde).
 * Ülke-İstanbul uçuş rotaları kavisli, parlayan bir "comet" ile sürekli akar; İstanbul beyaz
 * merkez nokta + 2 nabız halkası + dolu `--site-primary` "ISTANBUL" pill'i. `prefers-reduced-
 * motion` açıkken TÜM hareket (comet, nabız, float, stagger, döngüsel vurgu) kapanır — çizgiler
 * tam çizili, ilk adım sabit vurgulu görünür. Zemin `--site-accent`'in siyaha karışmış çok koyu
 * tonu (`color-mix`, SABİT HEX YOK).
 *
 * Paylaşılan bileşen — hem `home-page` şablonu hem `journey-map` bloğu BU bileşeni kullanır,
 * koda ikinci bir kopyası YOKTUR. `journey` prop'u `HomeJourneyContent` kabul eder.
 */
export function HomeJourney({ journey, stepLabel, istanbulLabel }: { journey: HomeJourneyContent; stepLabel: string; istanbulLabel: string }) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const inView = useInView(sectionRef, { once: true, amount: 0.2 });
  const reduceMotion = useReducedMotion();
  const glowId = useId().replace(/:/g, "");
  const steps = journey.steps;
  const countries = journey.countries;

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

                {/* Kara noktaları — gerçek kıtalar, 4 soluklaşma katmanı (bkz. DOT_BUCKET_PATHS yorumu). */}
                {DOT_BUCKET_PATHS.map((bucket, i) =>
                  bucket.d ? (
                    <path key={i} d={bucket.d} stroke="var(--site-primary)" strokeWidth={1.8} strokeLinecap="round" opacity={bucket.opacity} fill="none" />
                  ) : null
                )}

                {/* Uçuş rotaları — kavisli, uçlara doğru şeffaflaşan gradyan, sırayla (~0.4s) çizilir. */}
                {resolvedCountries.map(({ country, point }, index) => {
                  const { d } = flightPath(point, ISTANBUL_POINT);
                  return (
                    <motion.path
                      key={country.id}
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

                {/* "Comet" — çizgi çizildikten sonra İstanbul'a doğru sürekli akan parlak nokta. */}
                {!reduceMotion &&
                  resolvedCountries.map(({ country, point }, index) => {
                    const { control } = flightPath(point, ISTANBUL_POINT);
                    const { xs, ys } = sampleBezier(point, control, ISTANBUL_POINT, 10);
                    const drawDelay = 0.2 + index * 0.4;
                    return (
                      <motion.circle
                        key={country.id}
                        r={2}
                        fill="var(--site-primary)"
                        filter={`url(#journey-glow-${glowId})`}
                        initial={{ opacity: 0 }}
                        animate={
                          inView
                            ? { cx: xs, cy: ys, opacity: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0] }
                            : undefined
                        }
                        transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 0.5, delay: drawDelay + 1, ease: "linear" }}
                      />
                    );
                  })}

                {resolvedCountries.map(({ country, point }) => (
                  <circle key={country.id} cx={point.x} cy={point.y} r={2.6} fill="white" />
                ))}

                {/* İstanbul — nabız gibi atan 2 halka (reduced-motion'da statik). */}
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
            </GlobeFloat>

            {/* Ülke etiketleri — HTML (SVG'nin DIŞINDA), ekran okuyucuya normal metin olarak okunur. */}
            {resolvedCountries.map(({ country, point }) => {
              const offset = LABEL_OFFSETS[country.label.trim().toLowerCase()] ?? DEFAULT_LABEL_OFFSET;
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
        </div>

        {/* Sol kolon — kompakt metin + adım akışı. */}
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

          <StepFlow steps={steps} stepLabel={stepLabel} inView={inView} reduceMotion={reduceMotion ?? false} />
        </div>
      </div>
    </section>
  );
}

/** Küre çok yavaş (6-8s) yukarı-aşağı 4px "float" yapar — görev dosyası §"Hareket" (isteğe
 *  bağlı ince hareket). `prefers-reduced-motion` açıkken TAMAMEN statik. */
function GlobeFloat({ children, reduceMotion }: { children: React.ReactNode; reduceMotion: boolean | null }) {
  if (reduceMotion) return <>{children}</>;
  return (
    <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}>
      {children}
    </motion.div>
  );
}
