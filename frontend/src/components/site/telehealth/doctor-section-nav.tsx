"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface DoctorSectionNavItem {
  id: string;
  label: string;
}

export interface DoctorTabDefinition extends DoctorSectionNavItem {
  content: ReactNode;
}

/** Sekme dışından (ör. "Tümünü gör") sekme değiştirmek için özel olay. */
export const SELECT_PROFILE_TAB_EVENT = "doctor-profile:select-tab";

export function selectProfileTab(id: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SELECT_PROFILE_TAB_EVENT, { detail: id }));
}

function hashId(): string {
  if (typeof window === "undefined") return "";
  try {
    return decodeURIComponent(window.location.hash.replace(/^#/, ""));
  } catch {
    return "";
  }
}

/**
 * Paket AE — gerçek sekmeler (ARIA tabs deseni). Aynı anda tek panel görünür; TÜM paneller HTML'de kalır
 * (yalnızca `hidden` ile görsel olarak gizlenir — SEO). URL hash'i sekmeyi belirler (`#reviews`), tıklama hash'i
 * günceller (geri tuşu çalışır: hashchange/popstate dinlenir). Panel `id`'leri eski bölüm id'leridir.
 * Sunucu çıktısında ilk panel görünür; JS yoksa diğerleri gizli kalır ama metinleri HTML'dedir.
 */
export function DoctorProfileTabset({ tabs, ariaLabel }: { tabs: DoctorTabDefinition[]; ariaLabel: string }) {
  const ids = tabs.map((t) => t.id);
  const [active, setActive] = useState(ids[0] ?? "");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const listRef = useRef<HTMLDivElement | null>(null);
  const idsKey = ids.join("|");

  const scrollToTabsIfAbove = useCallback(() => {
    const el = listRef.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView?.({ block: "start" });
  }, []);

  useEffect(() => {
    const list = idsKey ? idsKey.split("|") : [];
    const syncFromHash = (scroll: boolean) => {
      const id = hashId();
      if (id && list.includes(id)) {
        setActive(id);
        if (scroll) scrollToTabsIfAbove();
      }
    };
    syncFromHash(false);
    const onHash = () => syncFromHash(true);
    const onSelect = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (!list.includes(id)) return;
      setActive(id);
      if (hashId() !== id) window.history.pushState(null, "", `#${id}`);
      scrollToTabsIfAbove();
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    window.addEventListener(SELECT_PROFILE_TAB_EVENT, onSelect);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
      window.removeEventListener(SELECT_PROFILE_TAB_EVENT, onSelect);
    };
  }, [idsKey, scrollToTabsIfAbove]);

  function activate(id: string, push: boolean) {
    setActive(id);
    if (hashId() !== id) {
      if (push) window.history.pushState(null, "", `#${id}`);
      else window.history.replaceState(null, "", `#${id}`);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const forward = rtl ? "ArrowLeft" : "ArrowRight";
    const backward = rtl ? "ArrowRight" : "ArrowLeft";
    let next = -1;
    if (event.key === forward) next = (index + 1) % tabs.length;
    else if (event.key === backward) next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const target = tabs[next];
    tabRefs.current[target.id]?.focus();
    activate(target.id, false);
  }

  const showBar = tabs.length > 1;

  return (
    <div data-testid="doctor-tabs">
      {showBar && (
        <div
          ref={listRef}
          className="-mx-4 border-b border-border bg-background/95 backdrop-blur-sm sm:mx-0 lg:sticky lg:top-[88px] lg:z-20"
        >
          <div role="tablist" aria-label={ariaLabel} className="flex gap-2 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] sm:px-0 lg:gap-1 lg:py-0 [&::-webkit-scrollbar]:hidden">
            {tabs.map((tab, index) => {
              const isActive = tab.id === active;
              return (
                <button
                  key={tab.id}
                  ref={(el) => {
                    tabRefs.current[tab.id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`tab-${tab.id}`}
                  aria-selected={isActive}
                  aria-controls={tab.id}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => activate(tab.id, true)}
                  onKeyDown={(e) => onKeyDown(e, index)}
                  className={cn(
                    "inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-semibold outline-none transition-all duration-300 focus-visible:ring-2 focus-visible:ring-ring",
                    "lg:rounded-none lg:border-0 lg:border-b-4 lg:px-4 lg:py-3",
                    isActive
                      ? "border-[var(--site-secondary)] bg-[var(--site-secondary)] text-white lg:bg-transparent lg:text-[var(--site-secondary)]"
                      : "border-border bg-surface text-foreground/70 hover:text-foreground lg:border-b-transparent lg:bg-transparent",
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={tab.id}
          role={showBar ? "tabpanel" : undefined}
          aria-labelledby={showBar ? `tab-${tab.id}` : undefined}
          tabIndex={showBar ? 0 : undefined}
          hidden={showBar && tab.id !== active}
          className={cn("scroll-mt-28 outline-none focus-visible:ring-2 focus-visible:ring-ring", showBar && "pt-6")}
        >
          <h2 className="sr-only">{tab.label}</h2>
          {tab.content}
        </div>
      ))}
    </div>
  );
}
