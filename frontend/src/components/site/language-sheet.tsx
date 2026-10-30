"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Check, XIcon } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { LocaleFlag } from "@/components/site/locale-flag";
import { localeHref } from "@/components/site/language-switcher";
import { useLocaleAlternates } from "@/context/locale-alternates-context";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/api/types";

/** Aşağı sürükleme bu mesafeyi (px) geçerse alt sayfa kapanır. */
export const SWIPE_CLOSE_THRESHOLD_PX = 80;

interface LanguageSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locales: Locale[];
  activeLocale: Locale;
  title: string;
  closeLabel: string;
}

/**
 * Paket V (İş 2) — mobil dil seçimi alt sayfası (bottom sheet). Base UI Dialog: odak sayfada tutulur,
 * ESC ve arka plan tıklaması kapatır, kapanınca odak tetikleyiciye döner, arka plan karartılır ve
 * kaydırılamaz. Ek olarak tutamaçtan/başlıktan aşağı sürükleyerek kapanır.
 *
 * 2 sütunlu ızgara: bayrak + dilin kendi adı; aktif dil vurgulu, ✓ ve `aria-current`. Dil adı `<bdi>`
 * ile kendi dilinde ve yönünde yalıtılır (Arapça satır sağa kaymaz, satır düzeni bozulmaz). Dil
 * değişince aynı içeriğin o dildeki adresine gidilir (`localeHref`, masaüstüyle aynı kural).
 */
export function LanguageSheet({ open, onOpenChange, locales: allLocales, activeLocale, title, closeLabel }: LanguageSheetProps) {
  const alternates = useLocaleAlternates();
  const locales = allLocales.filter((l) => l.enabled);
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Kapat düğmesine dokunuş sürükleme sayılmaz (pointer capture tıklamayı yutmasın).
    if ((event.target as HTMLElement).closest("button")) return;
    startY.current = event.clientY;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (startY.current === null) return;
    setDragY(Math.max(0, event.clientY - startY.current));
  }

  function onPointerEnd() {
    if (startY.current === null) return;
    startY.current = null;
    if (dragY > SWIPE_CLOSE_THRESHOLD_PX) onOpenChange(false);
    setDragY(0);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        data-testid="language-sheet"
        style={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
        className="max-h-[85dvh] gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]"
      >
        {/* Sürükleme alanı: tutamaç + başlık satırı (ızgaradaki bağlantılar normal dokunuşla çalışır). */}
        <div
          data-testid="language-sheet-drag"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onLostPointerCapture={onPointerEnd}
          className="touch-none select-none"
        >
          <div className="flex justify-center pt-2.5" aria-hidden="true">
            <span className="h-1.5 w-10 rounded-full bg-foreground/20" />
          </div>
          <div className="flex items-center justify-between py-1.5 ps-4 pe-2">
            <SheetTitle className="text-base font-semibold text-foreground">{title}</SheetTitle>
            <SheetClose
              render={
                <button
                  type="button"
                  aria-label={closeLabel}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-foreground/70 hover:bg-surface-muted"
                />
              }
            >
              <XIcon className="h-5 w-5" aria-hidden="true" />
            </SheetClose>
          </div>
        </div>

        <ul className="grid grid-cols-2 gap-2 overflow-y-auto px-3 pb-4 pt-1">
          {locales.map((l) => {
            const active = l.code === activeLocale.code;
            return (
              <li key={l.code} className="min-w-0">
                <Link
                  href={localeHref(alternates, l, locales)}
                  lang={l.code}
                  hrefLang={l.hreflang ?? l.code}
                  aria-current={active ? "true" : undefined}
                  onClick={() => onOpenChange(false)}
                  className={cn(
                    "flex min-h-12 w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition-colors",
                    active
                      ? "border-[var(--site-accent,#2951A0)] bg-[var(--site-accent,#2951A0)]/5 font-semibold text-[var(--site-accent,#2951A0)]"
                      : "border-border text-foreground hover:bg-surface-muted"
                  )}
                >
                  <LocaleFlag code={l.code} />
                  <span className="min-w-0 flex-1 truncate text-start">
                    <bdi lang={l.code} dir={localeDirection(l.code)}>
                      {l.nativeLabel}
                    </bdi>
                  </span>
                  {active && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                </Link>
              </li>
            );
          })}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
