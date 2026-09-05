"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from "framer-motion";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PublicSlide, PublicSlider, SliderHeightMode, SliderNavigationTheme, SliderTransitionEffect } from "@/lib/sliders/types";
import { DEFAULT_CONTAINER_MAX_WIDTH, type BlockChrome } from "@/lib/page-builder/types";
import { SlideLayerView } from "./slide-layer";
import { usePointerSwipe } from "./use-pointer-swipe";
import { useResolvedLayers } from "./resolve-responsive";

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

function SlideBackgroundView({
  slide,
  isActive,
  priority,
  reducedMotion,
}: {
  slide: PublicSlide;
  isActive: boolean;
  priority: boolean;
  reducedMotion: boolean;
}) {
  const kenBurns = slide.bgKenBurns && !reducedMotion;

  if (slide.bgType === "image" && slide.bgMedia) {
    return (
      <motion.div
        className="absolute inset-0 overflow-hidden"
        animate={kenBurns ? { scale: [1, 1.12, 1] } : undefined}
        transition={kenBurns ? { duration: 18, repeat: Infinity, ease: "linear" } : undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- image-block.tsx ile AYNI gerekçe (URL medya kütüphanesinden gelir, next/image remotePatterns henüz tanımlı değil) */}
        <img
          src={slide.bgMedia.url}
          alt=""
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: `${slide.bgPositionX}% ${slide.bgPositionY}%` }}
        />
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

function SlideStage({
  slide,
  index,
  active,
  total,
  sliderName,
  reducedMotion,
}: {
  slide: PublicSlide;
  index: number;
  active: number;
  total: number;
  sliderName: string;
  reducedMotion: boolean;
}) {
  const isActive = index === active;
  const resolvedLayers = useResolvedLayers(slide.layers);

  return (
    <div
      role="group"
      aria-roledescription="slide"
      aria-label={`${index + 1} / ${total}`}
      aria-hidden={!isActive}
      inert={!isActive}
      className="relative h-full w-full"
    >
      <SlideBackgroundView slide={slide} isActive={isActive} priority={index === 0} reducedMotion={reducedMotion} />
      {slide.bgType === "image" && (
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-transparent" aria-hidden />
      )}
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
      <div className="absolute inset-0 z-10">
        <AnimatePresence>
          {isActive && (
            <motion.div key={`layers-${slide.id}`} className="absolute inset-0" initial={false}>
              {resolvedLayers.map((layer, li) => (!layer.hidden ? <SlideLayerView key={layer.id} layer={layer} layerIndex={li} reducedMotion={reducedMotion} /> : null))}
            </motion.div>
          )}
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

  const desktopHeight = useMemo(
    () => heightStyle(slider.heightMode, slider.heightPx, slider.aspectRatioWidth, slider.aspectRatioHeight),
    [slider.heightMode, slider.heightPx, slider.aspectRatioWidth, slider.aspectRatioHeight]
  );
  const mobileOverrideNeeded = slider.mobileHeightMode != null;
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
      style={desktopHeight}
    >
      {mobileOverrideNeeded && mobileHeight && (
        <style>{`@media (max-width: 767px) { #${rootId} { ${cssDeclarations(mobileHeight)} } }`}</style>
      )}

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
                <SlideStage slide={slide} index={index} active={active} total={slides.length} sliderName={slider.name} reducedMotion={reducedMotion} />
              </div>
            ))}
          </motion.div>
        ) : (
          slides.map((slide, index) => {
            const motionProps = crossfadeMotionProps(transitionEffect, index, active, transitionDurationSec);
            return (
              <motion.div key={slide.id} className="absolute inset-0" animate={motionProps.animate} transition={motionProps.transition} style={motionProps.style}>
                <SlideStage slide={slide} index={index} active={active} total={slides.length} sliderName={slider.name} reducedMotion={reducedMotion} />
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
