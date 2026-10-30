"use client";

import Link from "next/link";
import { Menu } from "@base-ui/react/menu";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MoreMenuLink {
  id: string;
  href: string;
  label: string;
  children: { id: string; href: string; label: string }[];
}

/**
 * Paket AB — 1024–1279 px'te menü sığmazsa sondaki ikincil öğeler burada toplanır (hamburger yok).
 * Base UI Menu: oklar, Home/End, Esc ile kapanma ve odak geri dönüşü. Alt öğeli bir kök öğe grup
 * başlığı + alt bağlantılar olarak listelenir. Aktif sayfa `aria-current="page"`.
 */
export function MoreMenu({
  label,
  links,
  localize,
  isActive,
  triggerClassName,
  activeTriggerClassName,
}: {
  label: string;
  links: MoreMenuLink[];
  localize: (href: string) => string;
  isActive: (href: string) => boolean;
  triggerClassName: string;
  activeTriggerClassName: string;
}) {
  const anyActive = links.some((l) => isActive(localize(l.href)) || l.children.some((c) => isActive(localize(c.href))));
  const itemClass =
    "flex min-h-10 items-center rounded-lg px-3 py-2 text-sm text-foreground outline-none hover:bg-[color-mix(in_oklch,var(--site-primary)_6%,var(--site-surface))] data-[highlighted]:bg-[color-mix(in_oklch,var(--site-primary)_6%,var(--site-surface))] aria-[current=page]:font-semibold aria-[current=page]:text-[var(--site-header-link-active)]";
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <button
            type="button"
            data-testid="header-more-trigger"
            className={cn(
              "group flex items-center gap-1 rounded-lg px-1 py-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-primary)]/40",
              anyActive ? activeTriggerClassName : triggerClassName
            )}
          />
        }
      >
        {label}
        <ChevronDown className="h-3.5 w-3.5 transition-transform duration-150 group-data-[popup-open]:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="isolate z-50 outline-none" side="bottom" align="end" sideOffset={12} collisionPadding={12}>
          <Menu.Popup
            data-testid="header-more-menu"
            className="min-w-56 rounded-[18px] border border-border bg-surface p-2 text-foreground shadow-[0_12px_32px_-8px_rgba(15,23,42,0.18)] outline-none transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none"
          >
            {links.map((link) =>
              link.children.length > 0 ? (
                <Menu.Group key={link.id}>
                  <Menu.GroupLabel className="px-3 pt-2 pb-1 text-xs font-bold tracking-[0.12em] text-[var(--site-muted-text,currentColor)] uppercase">{link.label}</Menu.GroupLabel>
                  {link.children.map((child) => {
                    const href = localize(child.href);
                    return (
                      <Menu.Item key={child.id} render={<Link href={href} aria-current={isActive(href) ? "page" : undefined} />} className={itemClass}>
                        {child.label}
                      </Menu.Item>
                    );
                  })}
                </Menu.Group>
              ) : (
                <Menu.Item
                  key={link.id}
                  render={<Link href={localize(link.href)} aria-current={isActive(localize(link.href)) ? "page" : undefined} />}
                  className={itemClass}
                >
                  {link.label}
                </Menu.Item>
              )
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
