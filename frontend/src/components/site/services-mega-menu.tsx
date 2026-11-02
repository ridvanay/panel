"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Menu } from "@base-ui/react/menu";
import { ArrowRight, CalendarCheck, ChevronDown, Compass, ShieldCheck } from "lucide-react";
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion";
import { WhatsappIcon } from "@/components/site/contact/contact-cta";
import { useContactChannels } from "@/components/site/contact/contact-channels-context";
import type { NavSpecialty } from "@/components/site/nav-dropdown";
import { resolveIcon } from "@/lib/page-builder/icon-options";
import { groupServices, serviceGroupTitle, type ServiceGroup } from "@/lib/service-groups";
import { buildWhatsappHref } from "@/lib/whatsapp-link";
import { useContactCtaStrings } from "@/lib/i18n/use-contact-cta-strings";
import type { ServicesStrings } from "@/lib/i18n/site-dictionaries/types";
import { cn } from "@/lib/utils";

/** Paket AI — mega menü masaüstü yükseklik tavanı (px). Taşan içerik kendi içinde kayar. */
export const MEGA_MENU_MAX_HEIGHT_PX = 520;

/** Header'ın alt kenarı ile panel arasındaki boşluk (nav-dropdown ile aynı). */
const PANEL_GAP_PX = 12;

export const FIND_YOUR_TREATMENT_PATH = "/find-your-treatment";
/** İş 3 canlıya çıkana kadar online görüşme düğmeleri talep formuna gider. */
export const BOOK_CONSULTATION_PATH = "/request";

/** `react-hooks/static-components` yanlış-pozitifinden kaçınma deseni (bkz. icon-box-block.tsx). */
function iconGlyph(name: string, className: string) {
  const Icon = resolveIcon(name);
  return <Icon className={className} aria-hidden="true" />;
}

/** Menüde gösterilecek gruplu hizmetler: yalnızca aktif uzmanlıklar (API `order` sırasıyla). */
export function useServiceGroups(specialties: NavSpecialty[]): ServiceGroup<NavSpecialty>[] {
  return useMemo(() => groupServices(specialties), [specialties]);
}

export interface ServicesMegaMenuProps {
  /** Üst menü öğesi (etiket + `/specialties` bağlantısı). */
  link: { id: string; href: string; label: string };
  localize: (href: string) => string;
  active: boolean;
  specialties: NavSpecialty[];
  strings: ServicesStrings;
  /** WhatsApp mesajındaki konu (site adı). */
  contactTopic: string;
  triggerClassName: string;
  activeTriggerClassName: string;
}

const ITEM_CLASS =
  "flex w-full items-start gap-3 rounded-lg px-2 py-1 text-start outline-none transition-colors duration-150 hover:bg-[color-mix(in_oklch,var(--site-primary)_6%,var(--site-surface))] data-[highlighted]:bg-[color-mix(in_oklch,var(--site-primary)_6%,var(--site-surface))] motion-reduce:transition-none";
const CHIP_CLASS =
  "inline-flex h-6 items-center rounded-full border border-border bg-surface px-2 text-xs font-semibold text-[var(--site-primary)] outline-none transition-colors hover:bg-[color-mix(in_oklch,var(--site-primary)_8%,var(--site-surface))] data-[highlighted]:bg-[color-mix(in_oklch,var(--site-primary)_8%,var(--site-surface))] motion-reduce:transition-none";

/**
 * Paket AI — "Health Tourism Services" mega menüsü (masaüstü). Sol: gruplu liste (CSS kolonları, 2 kolon);
 * her öğe 24 px ikon + ad + tek satır kısa açıklama, alt uzmanlıklar küçük çipler. Sağ: vurgulu panel
 * ("Find your treatment", "Book an online consultation", varsa WhatsApp). Alt şerit: "View all services".
 * Yükseklik ≤ 520 px. ARIA/klavye: Base UI Menu (menu/menuitem; oklar, Home/End, Esc, odak tetikleyiciye döner)
 * — `NavDropdown` ile aynı kütüphane. Grup başlıkları `role="group"` + etiket. RTL: mantıksal sınıflar.
 */
export function ServicesMegaMenu({ link, localize, active, specialties, strings, contactTopic, triggerClassName, activeTriggerClassName }: ServicesMegaMenuProps) {
  const groups = useServiceGroups(specialties);
  const { whatsapp } = useContactChannels();
  const contact = useContactCtaStrings();

  const triggerRef = useRef<HTMLButtonElement>(null);
  const [sideOffset, setSideOffset] = useState(PANEL_GAP_PX);
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
            data-testid="services-mega-trigger"
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
            data-slot="services-mega-menu"
            data-testid="services-mega-menu"
            style={{ maxHeight: `${MEGA_MENU_MAX_HEIGHT_PX}px` }}
            className={cn(
              "flex w-[min(64rem,calc(100vw-2rem))] origin-(--transform-origin) flex-col overflow-hidden rounded-[18px] border border-border bg-surface text-foreground shadow-[0_12px_32px_-8px_rgba(15,23,42,0.18),0_2px_6px_rgba(15,23,42,0.06)] outline-none",
              "transition-[opacity,transform] duration-150 ease-out data-[starting-style]:-translate-y-1 data-[starting-style]:opacity-0 data-[ending-style]:-translate-y-1 data-[ending-style]:opacity-0",
              "motion-reduce:transition-none motion-reduce:data-[starting-style]:translate-y-0 motion-reduce:data-[ending-style]:translate-y-0"
            )}
          >
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_16rem]">
              <div className="min-h-0 overflow-y-auto px-4 py-3" data-testid="services-mega-groups">
                <div className="columns-2 gap-x-6">
                  {groups.map((group) => (
                    <Menu.Group key={group.id} data-testid={`services-group-${group.id}`} className="mb-2 break-inside-avoid">
                      <Menu.GroupLabel className="px-2 pb-1 text-[11px] font-bold tracking-[0.1em] text-[var(--site-muted-text,currentColor)] uppercase">
                        {serviceGroupTitle(group.id, strings)}
                      </Menu.GroupLabel>
                      <div className="flex flex-col">
                        {group.items.map((item) => (
                          <div key={item.slug} data-testid="services-item">
                            <Menu.Item render={<Link href={localize(`/specialties/${item.slug}`)} />} className={ITEM_CLASS}>
                              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center text-[var(--site-primary)]">
                                {iconGlyph(item.icon, "size-6")}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm leading-5 font-semibold text-foreground">{item.name}</span>
                                {item.shortDescription && (
                                  <span className="block line-clamp-2 text-xs leading-4 text-[var(--site-muted-text,currentColor)]">{item.shortDescription}</span>
                                )}
                              </span>
                            </Menu.Item>
                            {item.children.length > 0 && (
                              <div data-testid="nav-procedures" className="flex flex-wrap items-center gap-1 pb-1 ps-11 pe-2">
                                <span className="sr-only">{strings.relatedProceduresAria}</span>
                                {item.children.map((child) => (
                                  <Menu.Item key={child.slug} render={<Link href={localize(`/specialties/${child.slug}`)} />} className={CHIP_CLASS}>
                                    {child.name}
                                  </Menu.Item>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </Menu.Group>
                  ))}
                </div>
              </div>

              <div
                data-testid="services-mega-panel"
                className="flex min-h-0 flex-col gap-3 overflow-y-auto border-s border-border bg-[color-mix(in_oklch,var(--site-primary)_6%,var(--site-surface))] p-5"
              >
                <p className="text-base leading-snug font-semibold text-foreground">{strings.panelHeading}</p>
                <Menu.Item
                  render={<Link href={localize(FIND_YOUR_TREATMENT_PATH)} />}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--site-radius,0.75rem)] bg-[var(--site-button)] px-4 text-sm font-semibold text-[var(--site-button-text)] outline-none transition-opacity hover:opacity-90 data-[highlighted]:opacity-90"
                >
                  <Compass className="size-4" aria-hidden="true" />
                  {strings.findYourTreatment}
                </Menu.Item>
                <Menu.Item
                  render={<Link href={localize(BOOK_CONSULTATION_PATH)} />}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--site-radius,0.75rem)] border border-[var(--site-primary)] bg-surface px-4 text-sm font-semibold text-[var(--site-primary)] outline-none transition-colors hover:bg-[color-mix(in_oklch,var(--site-primary)_6%,var(--site-surface))] data-[highlighted]:bg-[color-mix(in_oklch,var(--site-primary)_6%,var(--site-surface))]"
                >
                  <CalendarCheck className="size-4" aria-hidden="true" />
                  {strings.bookOnlineConsultation}
                </Menu.Item>
                {whatsapp && (
                  <div className="mt-1 border-t border-border pt-3" data-testid="services-mega-contact">
                    <p className="text-xs font-medium text-[var(--site-muted-text,currentColor)]">{strings.coordinatorHeading}</p>
                    <Menu.Item
                      render={<a href={buildWhatsappHref(whatsapp, contactTopic)} target="_blank" rel="noopener noreferrer" aria-label={contact.whatsappAria} />}
                      className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-[var(--site-primary)] outline-none hover:underline data-[highlighted]:underline"
                    >
                      <WhatsappIcon className="size-4" />
                      {contact.whatsapp}
                    </Menu.Item>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-5 py-1.5">
              <Menu.Item
                render={<Link href={localize(link.href)} />}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg text-sm font-semibold text-[var(--site-primary)] outline-none hover:underline data-[highlighted]:underline"
              >
                {strings.viewAllServices}
                <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
              </Menu.Item>
              <p className="inline-flex items-center gap-1.5 text-xs text-[var(--site-muted-text,currentColor)]">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                {strings.facilitiesNote}
              </p>
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * Paket AI — mobil menü: "Health Tourism Services" panelinin içeriği. Gruplu akordeon (grup başlığı = akordeon
 * tetikleyicisi); her öğe ikon + ad + kısa açıklama, alt uzmanlıklar çip; en altta "View all services".
 */
export function ServicesMobileGroups({
  specialties,
  localize,
  strings,
  viewAllHref,
  onNavigate,
  isActive,
}: {
  specialties: NavSpecialty[];
  localize: (href: string) => string;
  strings: ServicesStrings;
  viewAllHref: string;
  onNavigate: () => void;
  isActive: (href: string) => boolean;
}) {
  const groups = useServiceGroups(specialties);
  const activeGroup = groups.find((g) =>
    g.items.some((i) => isActive(localize(`/specialties/${i.slug}`)) || i.children.some((c) => isActive(localize(`/specialties/${c.slug}`))))
  );
  return (
    <div className="flex flex-col gap-1 pb-1 ps-3" data-testid="mobile-services-groups">
      <Accordion defaultValue={activeGroup ? [activeGroup.id] : []}>
        {groups.map((group) => (
          <AccordionItem key={group.id} value={group.id} className="rounded-lg border-0" data-testid={`mobile-services-group-${group.id}`}>
            <AccordionTrigger className="min-h-11 rounded-lg px-3 text-sm">
              <span className="flex-1">{serviceGroupTitle(group.id, strings)}</span>
            </AccordionTrigger>
            <AccordionPanel>
              <ul className="flex flex-col gap-0.5 pb-1">
                {group.items.map((item) => {
                  const href = localize(`/specialties/${item.slug}`);
                  const current = isActive(href);
                  return (
                    <li key={item.slug}>
                      <Link
                        href={href}
                        onClick={onNavigate}
                        aria-current={current ? "page" : undefined}
                        className="flex min-h-11 items-start gap-3 rounded-lg px-3 py-2 hover:bg-surface-muted"
                      >
                        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center text-[var(--site-primary)]">{iconGlyph(item.icon, "size-6")}</span>
                        <span className="min-w-0 flex-1">
                          <span className={cn("block text-sm leading-5 font-semibold", current ? "text-[var(--site-header-link-active)]" : "text-foreground")}>{item.name}</span>
                          {item.shortDescription && <span className="block text-xs leading-4 text-foreground/60">{item.shortDescription}</span>}
                        </span>
                      </Link>
                      {item.children.length > 0 && (
                        <div data-testid="mobile-nav-procedures" className="flex flex-wrap items-center gap-1.5 pb-1 ps-12 pe-3">
                          <span className="sr-only">{strings.relatedProceduresAria}</span>
                          {item.children.map((child) => (
                            <Link
                              key={child.slug}
                              href={localize(`/specialties/${child.slug}`)}
                              onClick={onNavigate}
                              className="inline-flex min-h-8 items-center rounded-full border border-border px-3 text-xs font-semibold text-[var(--site-primary)] hover:bg-surface-muted"
                            >
                              {child.name}
                            </Link>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </AccordionPanel>
          </AccordionItem>
        ))}
      </Accordion>
      <Link
        href={viewAllHref}
        onClick={onNavigate}
        className="flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-[var(--site-primary)] hover:bg-surface-muted"
      >
        {strings.viewAllServices}
        <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
      </Link>
      <p className="px-3 pb-1 text-xs text-foreground/60">{strings.facilitiesNote}</p>
    </div>
  );
}
