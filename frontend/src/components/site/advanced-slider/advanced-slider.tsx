"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from "framer-motion";
import { getImageProps } from "next/image";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { toOptimizableMediaUrl } from "@/lib/env";
import { isOptimizableImageUrl } from "@/lib/image-hosts";
import type { PublicSlide, PublicSlider, SliderHeightMode, SliderImageFit, SliderNavigationTheme, SliderTransitionEffect } from "@/lib/sliders/types";
import { DEFAULT_CONTAINER_MAX_WIDTH, type BlockChrome } from "@/lib/page-builder/types";
import { SlideLayerView } from "./slide-layer";
import { usePointerSwipe } from "./use-pointer-swipe";
import { useResolvedLayers } from "./resolve-responsive";
import { orderLayersForStack, stackPaddingInlinePercent, useStackedSliderLayout } from "./stacked-layout";
import {
  SLIDER_MOBILE_MEDIA,
  SLIDER_TABLET_MEDIA,
  SLIDER_TABLET_OR_SMALLER_MEDIA,
  containAspectRatios,
  resolveSlideBackgrounds,
  scrimBackground,
  type DeviceBackground,
} from "./background";

/** §5.1 architect — eşik 50px VEYA hız > 0.4px/ms; `slide` track sürüklemesinde de AYNI eşik. */
const SWIPE_THRESHOLD_PX = 50;
const SWIPE_THRESHOLD_VELOCITY_PX_MS = 0.4;

function heightStyle(
  mode: SliderHeightMode,
  heightPx: number | null | undefined,
  aspectW: number,
  aspectH: number
): CSSProperties {
  switch (mode) {
    case "full-screen":
      // §5.2 architect — `100svh`, `100vh` DEĞİL (mobil tarayıcı çubuğu zıplaması).
      return { height: "100svh" };
    case "custom-px":
      return { height: `${heightPx ?? 600}px` };
    case "aspect-ratio":
    default:
      return { aspectRatio: `${aspectW} / ${aspectH}` };
  }
}

/** `!important` ZORUNLU — bu bildirimler kök elemanın KENDİ `style={desktopHeight}` satır-içi
 *  stiliyle AYNI elemanı hedefler; CSS cascade'inde satır-içi stil `!important` OLMAYAN her
 *  stylesheet kuralını (medya sorgusu/ID seçici fark etmez) HER ZAMAN yener. */
function cssDeclarations(style: CSSProperties): string {
  return Object.entries(style)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}: ${v} !important;`)
    .join(" ");
}

function hexToRgba(hex: string, opacityPercent: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(100, opacityPercent)) / 100})`;
}

const NAV_THEME_CLASS: Record<SliderNavigationTheme, { control: string; track: string; bulletInactive: string }> = {
  light: {
    control:
      "border-[var(--slider-nav-onlight-border)] bg-[var(--slider-nav-onlight-bg)] text-[var(--slider-nav-onlight-fg)] hover:bg-[var(--slider-nav-onlight-bg-hover)]",
    track: "bg-[var(--slider-nav-onlight-track-bg)]",
    bulletInactive: "bg-black/25",
  },
  dark: {
    control:
      "border-[var(--slider-nav-ondark-border)] bg-[var(--slider-nav-ondark-bg)] text-[var(--slider-nav-ondark-fg)] hover:bg-[var(--slider-nav-ondark-bg-hover)]",
    track: "bg-[var(--slider-nav-ondark-track-bg)]",
    bulletInactive: "bg-white/35",
  },
};

/**
 * `next/image` optimizasyonu (`getImageProps`) — host `remotePatterns` dışındaysa ham URL'e düşer
 * (`SafeImage` ile AYNI kural). Göreli `/uploads/...` yolu önce optimize edilebilir mutlak URL'e çevrilir.
 */
function backgroundImageProps(url: string, sizes: string, priority: boolean) {
  const src = toOptimizableMediaUrl(url);
  if (!isOptimizableImageUrl(src)) return { src: url, srcSet: undefined, sizes: undefined, style: undefined };
  // Cihaza göre farklı görsel olabildiği için `preload` DEĞİL `eager` + `fetchPriority` (Next docs: art direction).
  return getImageProps({ src, alt: "", fill: true, sizes, ...(priority ? { loading: "eager" as const, fetchPriority: "high" as const } : {}) }).props;
}

/**
 * Cihaza göre arka plan görseli — `<picture>` ile tarayıcı DOĞRU görseli ilk istekte seçer (JS
 * beklemez, SSR HTML'i doğrudur). Tablet görseli masaüstünden, mobil görseli tabletten farklıysa
 * `<source>` yazılır; odak noktası cihaz başına CSS değişkeniyle medya sorgusunda uygulanır.
 */
function SlideBackgroundPicture({
  slide,
  fit,
  sizes,
  priority,
}: {
  slide: PublicSlide;
  fit: SliderImageFit;
  sizes: string;
  priority: boolean;
}) {
  const { desktop, tablet, mobile } = resolveSlideBackgrounds(slide);
  if (!desktop) return null;
  const position = (bg: DeviceBackground | null) => `${bg?.x ?? desktop.x}% ${bg?.y ?? desktop.y}%`;
  const desktopProps = backgroundImageProps(desktop.media.url, sizes, priority);
  const tabletProps = tablet && tablet.media.url !== desktop.media.url ? backgroundImageProps(tablet.media.url, sizes, priority) : null;
  const mobileProps = mobile && mobile.media.url !== (tablet ?? desktop).media.url ? backgroundImageProps(mobile.media.url, sizes, priority) : null;

  return (
    <picture>
      {mobileProps && <source media={SLIDER_MOBILE_MEDIA} srcSet={mobileProps.srcSet ?? mobileProps.src} sizes={mobileProps.sizes} />}
      {tabletProps && <source media={SLIDER_TABLET_OR_SMALLER_MEDIA} srcSet={tabletProps.srcSet ?? tabletProps.src} sizes={tabletProps.sizes} />}
      {/* `getImageProps` çıktısı — <picture> içindeki kaynak seçimi için düz <img> ZORUNLU */}
      <img
        {...desktopProps}
        alt=""
        // Optimize edilemeyen host'ta (`getImageProps` atlanır) da ilk slayt öncelikli kalsın.
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        className={cn(
          "absolute inset-0 h-full w-full [object-position:var(--slide-bg-pos-d)] max-lg:[object-position:var(--slide-bg-pos-t)] max-md:[object-position:var(--slide-bg-pos-m)]",
          fit === "contain" ? "object-contain" : "object-cover"
        )}
        style={
          {
            ...desktopProps.style,
            "--slide-bg-pos-d": position(desktop),
            "--slide-bg-pos-t": position(tablet),
            "--slide-bg-pos-m": position(mobile),
          } as CSSProperties
        }
      />
    </picture>
  );
}

function SlideBackgroundView({
  slide,
  isActive,
  priority,
  reducedMotion,
  fit,
  sizes,
}: {
  slide: PublicSlide;
  isActive: boolean;
  priority: boolean;
  reducedMotion: boolean;
  fit: SliderImageFit;
  sizes: string;
}) {
  const kenBurns = slide.bgKenBurns && !reducedMotion;

  if (slide.bgType === "image" && slide.bgMedia) {
    return (
      <motion.div
        className="absolute inset-0 overflow-hidden"
        animate={kenBurns ? { scale: [1, 1.12, 1] } : undefined}
        transition={kenBurns ? { duration: 18, repeat: Infinity, ease: "linear" } : undefined}
      >
        <SlideBackgroundPicture slide={slide} fit={fit} sizes={sizes} priority={priority} />
      </motion.div>
    );
  }

  if (slide.bgType === "video") {
    const src = slide.bgMedia?.url ?? slide.bgVideoUrl ?? undefined;
    if (!src) return <div className="absolute inset-0 bg-black" />;
    return (
      <video
        className="absolute inset-0 h-full w-full object-cover"
        style={{ objectPosition: `${slide.bgPositionX}% ${slide.bgPositionY}%` }}
        muted
        playsInline
        loop
        preload="metadata"
        poster={slide.bgVideoPosterMedia?.url}
        autoPlay={isActive && !reducedMotion}
      >
        <source src={src} type="video/mp4" />
      </video>
    );
  }

  const from = slide.bgGradientFrom ?? "#111827";
  const to = slide.bgGradientTo ?? "#111827";
  return <div className="absolute inset-0" style={{ background: `linear-gradient(${slide.bgGradientAngle}deg, ${from}, ${to})` }} />;
}

function SlideOverlay({ slide }: { slide: PublicSlide }) {
  if (!slide.bgOverlayColor || !slide.bgOverlayOpacity) return null;
  return <div className="absolute inset-0" style={{ backgroundColor: hexToRgba(slide.bgOverlayColor, slide.bgOverlayOpacity) }} aria-hidden />;
}

/** Soldan okunabilirlik gradyanı — slayt ayarı, varsayılan KAPALI (eskiden görselli her slaytta sabitti). */
function SlideScrim({ slide }: { slide: PublicSlide }) {
  if (!slide.bgScrimEnabled || !slide.bgScrimOpacity) return null;
  return <div className="absolute inset-0" style={{ background: scrimBackground(slide.bgScrimOpacity) }} aria-hidden />;
}

/** Akış düzeninde (1280px altı) içeriğin üst/alt iç boşluğu; altta gezinme noktaları için ek pay. */
const STACK_PADDING_TOP_PX = 32;
const STACK_PADDING_BOTTOM_PX = 32;
const STACK_PADDING_BOTTOM_WITH_BULLETS_PX = 56;

function SlideStage({
  slide,
  index,
  active,
  total,
  sliderName,
  reducedMotion,
  stacked,
  reserveBottomPx,
  onStackContentHeight,
  fit,
  sizes,
}: {
  slide: PublicSlide;
  index: number;
  active: number;
  total: number;
  sliderName: string;
  reducedMotion: boolean;
  stacked: boolean;
  reserveBottomPx: number;
  fit: SliderImageFit;
  sizes: string;
  /** Akış düzeninde içerik yüksekliği (px) — kök, slider'ı en az bu kadar uzatır (kırpma olmaz). */
  onStackContentHeight: (heightPx: number) => void;
}) {
  const isActive = index === active;
  const resolvedLayers = useResolvedLayers(slide.layers);
  const stackedLayers = useMemo(() => (stacked ? orderLayersForStack(resolvedLayers) : []), [stacked, resolvedLayers]);
  const stackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stackRef.current;
    if (!stacked || !isActive || !el || typeof ResizeObserver === "undefined") return;
    const report = () => onStackContentHeight(el.offsetHeight);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [stacked, isActive, stackedLayers, onStackContentHeight]);

  return (
    <div
      role="group"
      aria-roledescription="slide"
      aria-label={`${index + 1} / ${total}`}
      aria-hidden={!isActive}
      inert={!isActive}
      className="relative h-full w-full"
    >
      <SlideBackgroundView slide={slide} isActive={isActive} priority={index === 0} reducedMotion={reducedMotion} fit={fit} sizes={sizes} />
      {slide.bgType === "image" && <SlideScrim slide={slide} />}
      <SlideOverlay slide={slide} />
      {slide.linkHref && (
        <a
          href={slide.linkHref}
          target={slide.linkNewTab ? "_blank" : undefined}
          rel={slide.linkNewTab ? "noopener noreferrer" : undefined}
          className="absolute inset-0 z-0"
          aria-label={sliderName}
          tabIndex={isActive ? 0 : -1}
        />
      )}
      <div className={cn("absolute inset-0 z-10", stacked && "flex flex-col")}>
        <AnimatePresence>
          {isActive &&
            (stacked ? (
              // 1280px altı — alt alta akış (bkz. `stacked-layout.ts`). `my-auto`: içerik kısaysa dikeyde
              // ortalanır; uzunsa kök slider bu yüksekliğe göre uzar (`onStackContentHeight`).
              <motion.div
                key={`layers-${slide.id}`}
                ref={stackRef}
                initial={false}
                className="relative my-auto flex w-full flex-col gap-3 md:gap-4"
                style={{
                  // Sol boşluk tasarımdaki sol kenarı korur; sağda yalnızca küçük bir pay (en fazla %4)
                  // bırakılır ki dar ekranda satırlar gereksiz yere kırılmasın.
                  paddingLeft: `${stackPaddingInlinePercent(stackedLayers)}%`,
                  paddingRight: `${Math.min(4, stackPaddingInlinePercent(stackedLayers))}%`,
                  paddingTop: STACK_PADDING_TOP_PX,
                  paddingBottom: reserveBottomPx,
                }}
              >
                {stackedLayers.map((layer, li) => (
                  <SlideLayerView key={layer.id} layer={layer} layerIndex={li} reducedMotion={reducedMotion} stacked />
                ))}
              </motion.div>
            ) : (
              // Gizli katmanlar da render edilir — cihaz görünürlüğü CSS medya sorgusuyla uygulanır
              // (`slide-layer.tsx::layerVisibilityClasses`), böylece SSR HTML'i JS beklemeden doğrudur.
              <motion.div key={`layers-${slide.id}`} className="absolute inset-0" initial={false}>
                {resolvedLayers.map((layer, li) => (
                  <SlideLayerView key={layer.id} layer={layer} layerIndex={li} reducedMotion={reducedMotion} />
                ))}
              </motion.div>
            ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

interface CrossfadeMotionProps {
  animate: Record<string, number>;
  transition: Record<string, unknown>;
  style: CSSProperties;
}

function crossfadeMotionProps(
  effect: Exclude<SliderTransitionEffect, "slide">,
  index: number,
  active: number,
  durationSec: number
): CrossfadeMotionProps {
  const isActive = index === active;
  const baseStyle: CSSProperties = { pointerEvents: isActive ? "auto" : "none" };
  const transition = { duration: durationSec, ease: "easeInOut" as const };

  if (effect === "fade") {
    return { animate: { opacity: isActive ? 1 : 0 }, transition, style: baseStyle };
  }
  if (effect === "zoom") {
    return { animate: { opacity: isActive ? 1 : 0, scale: isActive ? 1 : 1.08 }, transition, style: baseStyle };
  }
  // cube — CSS 3D (perspective + rotateY), Swiper'sız (architect §5.1/§4.4 notu).
  const delta = index - active;
  const rotateY = delta === 0 ? 0 : delta > 0 ? 90 : -90;
  return {
    animate: { rotateY, opacity: Math.abs(delta) <= 1 ? 1 : 0 },
    transition,
    style: { ...baseStyle, transformOrigin: delta > 0 ? "left center" : "right center", backfaceVisibility: "hidden" },
  };
}

/**
 * Gelişmiş Slider / Hero Studio — ön yüz render motoru (§5 architect kararı). Swiper.js
 * KULLANILMAZ; framer-motion + kendi pointer-swipe hook'umuz. Sıfır CLS: dış kutu yüksekliği
 * bu bileşenin İLK render'ında (SSR HTML'inde) satır içi stil ile belirlenir, JS ile
 * ÖLÇÜLMEZ (bkz. §5.2).
 */
export function AdvancedSlider({ slider, chrome = "page" }: { slider: PublicSlider; chrome?: BlockChrome }) {
  const rawId = useId();
  const rootId = `adv-slider-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const slides = slider.slides;

  const reducedMotionRaw = useReducedMotion();
  const reducedMotion = !!reducedMotionRaw;

  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(slider.autoplay);
  const [inView, setInView] = useState(true);
  const [docHidden, setDocHidden] = useState(false);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const trackWrapRef = useRef<HTMLDivElement>(null);

  // 1280px altı akış düzeni (bkz. `stacked-layout.ts`) — slider en az içerik kadar yüksek olur
  // (içerik kısaysa oran/sabit yükseklik korunur). Slaytlar arasında zıplama olmasın diye görülen
  // EN YÜKSEK değer tutulur; genişlik sınıfı değişince sıfırlanır. ≥1280px'te `minHeight` HİÇ uygulanmaz.
  // "Görselin tamamını göster" modunda katmanlar GÖRSELE göre konumlanır (kutu görselin oranında,
  // yüzde konumlar görselin aynı noktasına düşer) — alt alta akış görseldeki metnin üstüne bindirirdi.
  const imageFit: SliderImageFit = slider.imageFit ?? "cover";
  const stackedViewport = useStackedSliderLayout();
  const stacked = stackedViewport && imageFit !== "contain";
  const [stackMinHeight, setStackMinHeight] = useState(0);
  const [stackedPrev, setStackedPrev] = useState(stacked);
  if (stackedPrev !== stacked) {
    setStackedPrev(stacked);
    setStackMinHeight(0);
  }
  const handleStackContentHeight = useCallback((heightPx: number) => {
    setStackMinHeight((prev) => (heightPx > prev ? heightPx : prev));
  }, []);
  const stackReserveBottomPx = slider.showBullets && slides.length > 1 ? STACK_PADDING_BOTTOM_WITH_BULLETS_PX : STACK_PADDING_BOTTOM_PX;

  // "Görselin tamamını göster": oran İLK slaytın cihaz görselinden (SSR'da satır içi + medya sorgulu
  // <style>; JS ölçümü YOK → CLS 0). Boyut bilinmeyen cihazda slider'ın yükseklik ayarına düşülür.
  const containRatios = useMemo(() => (imageFit === "contain" ? containAspectRatios(slides[0]) : null), [imageFit, slides]);
  const desktopHeight = useMemo<CSSProperties>(
    () =>
      containRatios?.desktop
        ? { aspectRatio: containRatios.desktop }
        : heightStyle(slider.heightMode, slider.heightPx, slider.aspectRatioWidth, slider.aspectRatioHeight),
    [containRatios, slider.heightMode, slider.heightPx, slider.aspectRatioWidth, slider.aspectRatioHeight]
  );
  const containDeviceCss = useMemo(() => {
    if (!containRatios) return "";
    const rules: string[] = [];
    if (containRatios.tablet && containRatios.tablet !== containRatios.desktop) {
      rules.push(`@media ${SLIDER_TABLET_MEDIA} { #${rootId} { ${cssDeclarations({ aspectRatio: containRatios.tablet, height: "auto" })} } }`);
    }
    if (containRatios.mobile && containRatios.mobile !== containRatios.desktop) {
      rules.push(`@media ${SLIDER_MOBILE_MEDIA} { #${rootId} { ${cssDeclarations({ aspectRatio: containRatios.mobile, height: "auto" })} } }`);
    }
    return rules.join(" ");
  }, [containRatios, rootId]);
  const mobileOverrideNeeded = slider.mobileHeightMode != null && !containRatios?.mobile;
  const mobileHeight = useMemo(
    () =>
      mobileOverrideNeeded
        ? heightStyle(
            slider.mobileHeightMode!,
            slider.mobileHeightPx,
            slider.mobileAspectRatioWidth ?? slider.aspectRatioWidth,
            slider.mobileAspectRatioHeight ?? slider.aspectRatioHeight
          )
        : null,
    [mobileOverrideNeeded, slider]
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.2 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function onVisibility() {
      setDocHidden(document.hidden);
    }
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    const el = trackWrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setTrackWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const next = useCallback(() => {
    setActive((a) => {
      if (a >= slides.length - 1) return slider.loop ? 0 : a;
      return a + 1;
    });
  }, [slides.length, slider.loop]);

  const prev = useCallback(() => {
    setActive((a) => {
      if (a <= 0) return slider.loop ? slides.length - 1 : a;
      return a - 1;
    });
  }, [slides.length, slider.loop]);

  const currentSlide = slides[active];
  const effectiveDuration = currentSlide?.durationMs ?? slider.intervalMs;
  const effectiveAutoplay =
    slider.autoplay && playing && !reducedMotion && inView && !docHidden && !hoverPaused && slides.length > 1;

  useEffect(() => {
    if (!effectiveAutoplay) return;
    if (!slider.loop && active === slides.length - 1) return;
    const timer = setTimeout(next, effectiveDuration);
    return () => clearTimeout(timer);
  }, [effectiveAutoplay, effectiveDuration, active, next, slider.loop, slides.length]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      prev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      next();
    }
  }

  function handleTrackDragEnd(_event: unknown, info: PanInfo) {
    const dx = info.offset.x;
    const velocity = Math.abs(info.velocity.x) / 1000; // px/s -> px/ms
    if (Math.abs(dx) > SWIPE_THRESHOLD_PX || velocity > SWIPE_THRESHOLD_VELOCITY_PX_MS) {
      if (dx < 0) next();
      else prev();
    }
  }

  const swipeHandlers = usePointerSwipe({
    onSwipeLeft: next,
    onSwipeRight: prev,
    enabled: slider.transitionEffect !== "slide",
    thresholdPx: SWIPE_THRESHOLD_PX,
    thresholdVelocity: SWIPE_THRESHOLD_VELOCITY_PX_MS,
  });

  const navTheme = NAV_THEME_CLASS[slider.navigationTheme];
  // Arka plan görseli slider genişliğinde — boxed yerleşimde kap genişliği kadar.
  const imageSizes =
    slider.widthMode === "boxed" && chrome === "page" ? `(min-width: ${DEFAULT_CONTAINER_MAX_WIDTH}px) ${DEFAULT_CONTAINER_MAX_WIDTH}px, 100vw` : "100vw";
  const transitionDurationSec = reducedMotion ? 0 : slider.transitionDurationMs / 1000;
  // Yerel `const`e ayrılır — TS narrowing'i JSX'teki iç içe `.map()` kapanışları (closure) ARASINDA
  // korumak için (`slider.transitionEffect` doğrudan property erişimi kapanış sınırında sıfırlanır).
  const transitionEffect = slider.transitionEffect;

  if (slides.length === 0) return null;

  // §9.1.3/§9.1.4 architect — `boxed` yerleşimi YALNIZCA `chrome === "page"` iken sarmalayıcı
  // DOM üretir (page-builder `container` bloğunun "boxed" kuralının BİREBİR yeniden kullanımı,
  // bkz. §9.1.2). `full-width` HER ZAMAN ve `boxed` bağlamında `chrome === "bare"` iken kök
  // <div> DEĞİŞMEDEN, hiçbir ek DOM olmadan render edilir — geriye dönük uyumluluk kanıtı.
  const root = (
    <div
      id={rootId}
      ref={rootRef}
      role="region"
      aria-roledescription="carousel"
      aria-label={slider.name}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseEnter={() => slider.pauseOnHover && setHoverPaused(true)}
      onMouseLeave={() => slider.pauseOnHover && setHoverPaused(false)}
      onFocus={() => slider.pauseOnHover && setHoverPaused(true)}
      onBlur={() => slider.pauseOnHover && setHoverPaused(false)}
      className="advanced-slider group/slider relative w-full overflow-hidden bg-black/5 outline-none"
      style={stacked && stackMinHeight > 0 ? { ...desktopHeight, minHeight: stackMinHeight } : desktopHeight}
    >
      {mobileOverrideNeeded && mobileHeight && (
        <style>{`@media (max-width: 767px) { #${rootId} { ${cssDeclarations(mobileHeight)} } }`}</style>
      )}
      {containDeviceCss && <style>{containDeviceCss}</style>}

      <div
        ref={trackWrapRef}
        className="absolute inset-0 overflow-hidden"
        style={{ perspective: slider.transitionEffect === "cube" ? 1200 : undefined }}
        {...swipeHandlers}
      >
        {transitionEffect === "slide" ? (
          <motion.div
            className="flex h-full"
            style={{ width: trackWidth ? `${slides.length * trackWidth}px` : "100%" }}
            drag={slides.length > 1 ? "x" : false}
            dragElastic={0.15}
            dragMomentum={false}
            dragConstraints={{ left: -(Math.max(0, slides.length - 1) * trackWidth), right: 0 }}
            onDragEnd={handleTrackDragEnd}
            animate={{ x: -active * trackWidth }}
            transition={{ duration: transitionDurationSec, ease: "easeInOut" }}
          >
            {slides.map((slide, index) => (
              <div key={slide.id} className="relative h-full shrink-0" style={{ width: trackWidth ? `${trackWidth}px` : "100%" }}>
                <SlideStage
                  slide={slide}
                  index={index}
                  active={active}
                  total={slides.length}
                  sliderName={slider.name}
                  reducedMotion={reducedMotion}
                  stacked={stacked}
                  reserveBottomPx={stackReserveBottomPx}
                  onStackContentHeight={handleStackContentHeight}
                  fit={imageFit}
                  sizes={imageSizes}
                />
              </div>
            ))}
          </motion.div>
        ) : (
          slides.map((slide, index) => {
            const motionProps = crossfadeMotionProps(transitionEffect, index, active, transitionDurationSec);
            return (
              <motion.div key={slide.id} className="absolute inset-0" animate={motionProps.animate} transition={motionProps.transition} style={motionProps.style}>
                <SlideStage
                  slide={slide}
                  index={index}
                  active={active}
                  total={slides.length}
                  sliderName={slider.name}
                  reducedMotion={reducedMotion}
                  stacked={stacked}
                  reserveBottomPx={stackReserveBottomPx}
                  onStackContentHeight={handleStackContentHeight}
                  fit={imageFit}
                  sizes={imageSizes}
                />
              </motion.div>
            );
          })
        )}
      </div>

      {slider.showProgressBar && currentSlide && (
        <div className={cn("absolute inset-x-0 bottom-0 z-20 h-[3px]", navTheme.track)}>
          <motion.div
            key={`${currentSlide.id}-${effectiveAutoplay}`}
            className="h-full bg-[var(--site-primary,var(--slider-nav-active-fallback))]"
            initial={{ width: "0%" }}
            animate={{ width: effectiveAutoplay ? "100%" : "0%" }}
            transition={{ duration: effectiveAutoplay ? effectiveDuration / 1000 : 0, ease: "linear" }}
          />
        </div>
      )}

      {slider.showArrows && slides.length > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            aria-label="Önceki slayt"
            className={cn(
              "absolute left-4 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border backdrop-blur-sm transition-all duration-200 hover:scale-105 sm:left-6",
              navTheme.control
            )}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Sonraki slayt"
            className={cn(
              "absolute right-4 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border backdrop-blur-sm transition-all duration-200 hover:scale-105 sm:right-6",
              navTheme.control
            )}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}

      {slider.showBullets && slides.length > 1 && (
        <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 sm:bottom-6">
          {slides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => setActive(index)}
              aria-label={`${index + 1}. slayta git`}
              aria-current={index === active ? "true" : undefined}
              className={cn(
                "h-2 rounded-full transition-all duration-[250ms]",
                index === active ? "w-6 bg-[var(--site-primary,var(--slider-nav-active-fallback))]" : cn("w-2", navTheme.bulletInactive)
              )}
            />
          ))}
        </div>
      )}

      {/* WCAG 2.2.2 (bağlayıcı) — autoplay AÇIKKEN duraklat/oynat düğmesi HER ZAMAN render edilir. */}
      {slider.autoplay && slides.length > 1 && (
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Otomatik oynatmayı duraklat" : "Otomatik oynatmayı başlat"}
          className={cn(
            "absolute bottom-4 right-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur-sm transition-all duration-200 hover:scale-105 sm:bottom-6 sm:right-6",
            navTheme.control
          )}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
      )}
    </div>
  );

  if (slider.widthMode === "boxed" && chrome === "page") {
    return (
      <div className="mx-auto w-full px-4 sm:px-6" style={{ maxWidth: DEFAULT_CONTAINER_MAX_WIDTH }}>
        {root}
      </div>
    );
  }

  return root;
}
