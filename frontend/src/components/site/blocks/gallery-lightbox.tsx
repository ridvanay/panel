"use client";

import { useCallback, useRef } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface GalleryLightboxProps {
  images: { url: string; alt: string }[];
  /** `null` = kapalı. Açıkken şu an gösterilen görselin index'i. */
  index: number | null;
  onIndexChange: (index: number | null) => void;
}

const CONTROL_BUTTON_CLASS =
  "flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black text-white shadow-sm outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black";

/**
 * Galeri bloğu için tam ekran lightbox — `@base-ui/react` Dialog primitifleri üzerine kurulu
 * (proje genelinde `dialog.tsx`/`confirm-dialog.tsx`/`media-preview-dialog.tsx` ile aynı taban).
 * ESC ile kapama, overlay dışına tıklayınca kapama ve kapanınca tetikleyen elemana odak
 * dönüşü `modal` varsayılanından HAZIR gelir. Tab-döngüsü (focus trap) ise BİLİNÇLİ OLARAK
 * elle (`handleKeyDown` içinde) uygulanır — base-ui'nin dahili guard-span mekanizması bu
 * tam-ekran/özel içerikli popup'ta gözlemlenerek doğrulandı: Tab ile son kontrole (Sonraki
 * görsel) ulaşılıp bir kez daha Tab'a basılınca odak diyalog DIŞINA (sayfanın arkasındaki
 * bir linke) kaçıyor ve diyalog kapanıyordu (qa doğrulaması, gerçek tarayıcıda). Bu yüzden
 * 3 kontrolün (`Kapat`/`Önceki`/`Sonraki`) ref'leri tutulup Tab/Shift+Tab sınırda elle
 * `preventDefault` + `.focus()` ile döngüye alınıyor — WCAG "klavye tuzağı yok" gereksinimini
 * base-ui'ye güvenmek yerine garanti altına alan savunma katmanı.
 */
export function GalleryLightbox({ images, index, onIndexChange }: GalleryLightboxProps) {
  const open = index !== null;
  const currentImage = index !== null ? images[index] : null;
  const touchStartX = useRef<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const goTo = useCallback(
    (next: number) => {
      const total = images.length;
      onIndexChange(((next % total) + total) % total);
    },
    [images.length, onIndexChange],
  );

  function handleKeyDown(event: React.KeyboardEvent) {
    if (index === null) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(index - 1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo(index + 1);
      return;
    }
    if (event.key === "Tab") {
      const focusable = [closeRef.current, prevRef.current, nextRef.current].filter(
        (el): el is HTMLButtonElement => el !== null,
      );
      if (focusable.length === 0) return;
      event.preventDefault();
      const currentIndex = focusable.indexOf(document.activeElement as HTMLButtonElement);
      let nextIndex: number;
      if (event.shiftKey) {
        nextIndex = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
      } else {
        nextIndex = currentIndex === -1 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1;
      }
      focusable[nextIndex].focus();
    }
  }

  function handleTouchStart(event: React.TouchEvent) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event: React.TouchEvent) {
    if (touchStartX.current === null || index === null) return;
    const deltaX = (event.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
    touchStartX.current = null;
    const SWIPE_THRESHOLD_PX = 40;
    if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX) return;
    goTo(deltaX > 0 ? index - 1 : index + 1);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onIndexChange(null)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup
          onKeyDown={handleKeyDown}
          className="fixed inset-0 z-50 flex flex-col outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        >
          <DialogPrimitive.Title className="sr-only">
            {currentImage?.alt || (index !== null ? `Görsel ${index + 1}` : "Galeri önizleme")}
          </DialogPrimitive.Title>

          <DialogPrimitive.Close
            ref={closeRef}
            aria-label="Kapat"
            className={cn(CONTROL_BUTTON_CLASS, "absolute right-3 top-3 z-10 sm:right-6 sm:top-6")}
          >
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>

          {images.length > 1 && (
            <button
              ref={prevRef}
              type="button"
              aria-label="Önceki görsel"
              onClick={() => index !== null && goTo(index - 1)}
              className={cn(CONTROL_BUTTON_CLASS, "absolute left-2 top-1/2 z-10 -translate-y-1/2 sm:left-4")}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}

          {images.length > 1 && (
            <button
              ref={nextRef}
              type="button"
              aria-label="Sonraki görsel"
              onClick={() => index !== null && goTo(index + 1)}
              className={cn(CONTROL_BUTTON_CLASS, "absolute right-2 top-1/2 z-10 -translate-y-1/2 sm:right-4")}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          )}

          {images.length > 1 && index !== null && (
            <span className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-black px-3 py-1 text-xs font-medium tabular-nums text-white/80 sm:top-6">
              {index + 1} / {images.length}
            </span>
          )}

          {/* Boş alana (görselin dışı) tıklayınca kapatır; görsele tıklamak kapatmaz. */}
          <div
            className="flex flex-1 items-center justify-center px-4 py-16 sm:px-20"
            onClick={() => onIndexChange(null)}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {currentImage && (
              // eslint-disable-next-line @next/next/no-img-element -- URL, medya kütüphanesinden geliyor, next/image remotePatterns henüz tanımlı değil
              <img
                key={currentImage.url}
                src={currentImage.url}
                alt={currentImage.alt}
                onClick={(event) => event.stopPropagation()}
                className="max-h-full max-w-full object-contain"
              />
            )}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
