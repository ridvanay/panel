"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Menu } from "@base-ui/react/menu";
import { ArrowRight, ChevronDown } from "lucide-react";
import { resolveIcon } from "@/lib/page-builder/icon-options";
import { cn } from "@/lib/utils";

/** Header menüsü için uzmanlık özeti — `(site)/layout.tsx` uzmanlıklar modülünden verir. */
export interface NavSpecialty {
  slug: string;
  name: string;
  icon: string;
  imageUrl: string | null;
}

export interface NavDropdownLink {
  id: string;
  href: string;
  label: string;
  children: { id: string; href: string; label: string }[];
}

/**
 * Alt öğenin bir uzmanlık sayfasına gidip gitmediğini bağlantısından çıkarır. İki biçim tanınır:
 * `/specialties/<slug>` ve `/doctors?specialty=<slug>` (demo şablonun menüsü ikinciyi kullanır).
 * Dil öneki (`/en/...`) ve sondaki `/` göz ardı edilir. Tanınmazsa `null`.
 */
export function specialtySlugFromHref(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href, "https://nav.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://nav.invalid") return null;
  const path = url.pathname.replace(/\/+$/, "").replace(/^\/[a-z]{2}(?=\/)/, "");
  const direct = /^\/specialties\/([^/]+)$/.exec(path);
  if (direct) return decodeURIComponent(direct[1]!);
  if (path === "/doctors") {
    const slug = url.searchParams.get("specialty");
    if (slug) return slug;
  }
  return null;
}

/** Header'ın alt kenarı ile panel arasındaki boşluk. */
const PANEL_GAP_PX = 12;

/** "#", boş veya yalnızca çapa olan üst öğe bağlantısı "kendi linki yok" sayılır. */
function hasOwnLink(href: string): boolean {
  const trimmed = href.trim();
  return trimmed !== "" && !trimmed.startsWith("#");
}

function normalizePath(href: string): string {
  const path = href.split(/[?#]/)[0] ?? "";
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** `react-hooks/static-components` yanlış-pozitifinden kaçınma deseni (bkz. icon-box-block.tsx). */
function iconGlyph(name: string) {
  const Icon = resolveIcon(name);
  return <Icon className="size-5" aria-hidden="true" />;
}

export interface NavDropdownProps {
  link: NavDropdownLink;
  localize: (href: string) => string;
  /** Alt öğelerden biri aktif sayfaysa tetikleyici "aktif" görünür. */
  active: boolean;
  specialties: NavSpecialty[];
  viewAllLabel: string;
  findDoctorLabel: string;
  triggerClassName: string;
  activeTriggerClassName: string;
}

/**
 * Masaüstü header açılır menüsü. Panel header'ın ~12 px altında, düğmeye küçük bir okla bağlı;
 * beyaz, 18 px köşe, ince kenarlık, yumuşak gölge. Üstte üst öğenin adı (küçük, büyük harf);
 * 4'ten fazla alt öğede 2 kolon. Uzmanlığa giden öğelerde 42 px yuvarlak görsel (uzmanlık görseli,
 * yoksa ikonu). Altta ince çizgiyle ayrılmış bölüm: üst öğenin kendi linki varsa "View all …",
 * uzmanlık menüsünde ayrıca "Find a doctor" (üst öğe zaten doktorlar sayfasına gitmiyorsa).
 * Açılış ~150 ms geçiş; `prefers-reduced-motion`'da animasyon yok. Klavye: Base UI Menu (oklar,
 * Home/End, Esc, tür-başı arama).
 */
export function NavDropdown({
  link,
  localize,
  active,
  specialties,
  viewAllLabel,
  findDoctorLabel,
  triggerClassName,
  activeTriggerClassName,
}: NavDropdownProps) {
  const bySlug = new Map(specialties.map((s) => [s.slug, s]));
  const items = link.children.map((child) => {
    const slug = specialtySlugFromHref(child.href);
    return { ...child, slug, specialty: slug ? bySlug.get(slug) ?? null : null };
  });
  const isSpecialtyMenu = items.some((item) => item.slug !== null);
  const twoColumns = items.length > 4;
  const showViewAll = hasOwnLink(link.href);
  const showFindDoctor = isSpecialtyMenu && normalizePath(link.href) !== "/doctors";
  const hasFooter = showViewAll || showFindDoctor;

  // Panel header'ın ALT KENARININ ~12 px altında açılır (düğmenin değil) — düğme header içinde
  // dikeyde ortalı olduğu için aradaki fark açılışta ölçülüp ofsete eklenir.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [sideOffset, setSideOffset] = useState(PANEL_GAP_PX);
  // Panel `<body>`'ye değil sitenin tema kapsamına (`.site-scope`) taşınır — aksi halde `--site-*`
  // değişkenleri (renk/yarıçap/font) panelde tanımsız kalır.
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  function measureOffset() {
    const trigger = triggerRef.current;
    setPortalContainer((trigger?.closest(".site-scope") as HTMLElement | null) ?? null);
    const header = trigger?.closest("header");
    if (!trigger || !header) return;
    const extra = Math.max(0, Math.round(header.getBoundingClientRect().bottom - trigger.getBoundingClientRect().bottom));
    setSideOffset(extra + PANEL_GAP_PX);
  }

  return (
    <Menu.Root
      onOpenChange={(open) => {
        if (open) measureOffset();
      }}
    >
      <Menu.Trigger
        ref={triggerRef}
        render={
          <button
            type="button"
            aria-current={active ? "page" : undefined}
            className={cn(
              "group -mx-3 flex items-center gap-1 rounded-lg px-3 py-2 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[var(--site-primary)]/40 data-[popup-open]:bg-[color-mix(in_oklch,var(--site-primary)_8%,transparent)] data-[popup-open]:font-semibold data-[popup-open]:text-[var(--site-primary)] motion-reduce:transition-none",
              active ? activeTriggerClassName : triggerClassName
            )}
          />
        }
      >
        {link.label}
        <ChevronDown
          className="h-3.5 w-3.5 transition-transform duration-150 group-data-[popup-open]:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </Menu.Trigger>
      <Menu.Portal container={portalContainer ?? undefined}>
        <Menu.Positioner className="isolate z-50 outline-none" side="bottom" align="start" sideOffset={sideOffset} collisionPadding={12}>
          <Menu.Popup
            data-slot="nav-dropdown"
            className={cn(
              "origin-(--transform-origin) rounded-[18px] border border-border bg-surface p-2 text-foreground shadow-[0_12px_32px_-8px_rgba(15,23,42,0.18),0_2px_6px_rgba(15,23,42,0.06)] outline-none",
              "max-w-[min(36rem,var(--available-width))] transition-[opacity,transform] duration-150 ease-out",
              "data-[starting-style]:-translate-y-1 data-[starting-style]:opacity-0 data-[ending-style]:-translate-y-1 data-[ending-style]:opacity-0",
              "motion-reduce:transition-none motion-reduce:data-[starting-style]:translate-y-0 motion-reduce:data-[ending-style]:translate-y-0",
              twoColumns ? "w-[37.5rem]" : "w-[19rem]"
            )}
          >
            <Menu.Arrow className="data-[side=bottom]:-top-[7px]">
              <span className="block size-3 rotate-45 rounded-[2px] border-l border-t border-border bg-surface" aria-hidden="true" />
            </Menu.Arrow>
            <Menu.Group>
              <Menu.GroupLabel className="px-3 pt-3 pb-2 text-xs font-bold tracking-[0.12em] text-[var(--site-muted-text,currentColor)] uppercase">
                {link.label}
              </Menu.GroupLabel>
              <div className={cn("grid gap-0.5", twoColumns && "grid-cols-2")}>
                {items.map((item) => (
                  <Menu.Item
                    key={item.id}
                    render={<Link href={localize(item.href)} title={item.label} />}
                    className="flex min-h-[60px] items-center gap-3.5 rounded-xl px-3 py-2.5 text-[15px] leading-snug font-semibold text-foreground outline-none transition-colors duration-150 hover:bg-[color-mix(in_oklch,var(--site-primary)_6%,var(--site-surface))] data-[highlighted]:bg-[color-mix(in_oklch,var(--site-primary)_6%,var(--site-surface))] motion-reduce:transition-none"
                  >
                    {item.slug !== null && (
                      <span className="flex size-[42px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--site-accent)_18%,var(--site-surface))] text-[var(--site-primary)]">
                        {item.specialty?.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- 42 px küçük görsel, medya kütüphanesi URL'i
                          <img src={item.specialty.imageUrl} alt="" width={42} height={42} loading="lazy" className="size-full object-cover" />
                        ) : (
                          iconGlyph(item.specialty?.icon ?? "Stethoscope")
                        )}
                      </span>
                    )}
                    <span className="line-clamp-2">{item.label}</span>
                  </Menu.Item>
                ))}
              </div>
            </Menu.Group>
            {hasFooter && (
              <div className="mx-1 mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-2 pt-3 pb-1">
                {showViewAll && (
                  <Menu.Item
                    render={<Link href={localize(link.href)} />}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg text-[15px] font-semibold text-[var(--site-primary)] outline-none hover:underline data-[highlighted]:underline"
                  >
                    {viewAllLabel}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Menu.Item>
                )}
                {showFindDoctor && (
                  <Menu.Item
                    render={<Link href={localize("/doctors")} />}
                    className="ml-auto inline-flex min-h-11 items-center rounded-full bg-[color-mix(in_oklch,var(--site-primary)_7%,var(--site-surface))] px-5 text-sm font-semibold text-[var(--site-primary)] outline-none hover:bg-[color-mix(in_oklch,var(--site-primary)_12%,var(--site-surface))] data-[highlighted]:bg-[color-mix(in_oklch,var(--site-primary)_12%,var(--site-surface))]"
                  >
                    {findDoctorLabel}
                  </Menu.Item>
                )}
              </div>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
