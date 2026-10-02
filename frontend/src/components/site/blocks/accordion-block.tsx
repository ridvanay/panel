"use client";

import { Plus, Minus } from "lucide-react";
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { Accordion, AccordionItem, AccordionTrigger, AccordionPanel } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import type { AccordionBlock, AccordionLayoutStyle, BlockChrome } from "@/lib/page-builder/types";

/**
 * `layoutStyle` sınıf tablosu — ui-designer §2 (BAĞLAYICI). `bordered` (varsayılan) alanları
 * `undefined` bırakır — `cn(base, undefined)` `ui/accordion.tsx`'in KENDİ taban sınıflarını
 * aynen bırakır, bu PİKSEL-EŞ garantiyi kod seviyesinde de sağlar (`tailwind-merge` `card`/
 * `minimal`'in override'larını doğru şekilde ezer). `spotlight` BU TABLODA YOK — kendi ayrı
 * render dalı var (bkz. `SpotlightAccordion` altta), bordered/card/minimal'i HİÇ ETKİLEMEZ.
 */
const ACCORDION_LAYOUT_CLASSES: Record<Exclude<AccordionLayoutStyle, "spotlight">, { list?: string; item?: string; trigger?: string; panelText: string }> = {
  bordered: {
    panelText: "px-3 pb-3 text-foreground/70",
  },
  card: {
    list: "flex flex-col gap-3",
    item: "overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md",
    trigger: "px-4 py-3.5 text-sm font-semibold",
    panelText: "px-4 pb-4 text-foreground/70",
  },
  minimal: {
    // `gap-0` taban `Accordion`'ın `gap-1`'ini iptal eder — minimal düzende boşluk `divide-y`den
    // gelir (ui-designer §2 tablosu literal olarak gap taşımaz).
    list: "flex flex-col divide-y divide-border/60 gap-0",
    // `rounded-none border-0` taban `AccordionItem`'ın `rounded-lg border border-border/60`
    // sınıflarını GÖRSEL OLARAK iptal eder (`tailwind-merge` aynı utility grubunu ezer) — sonuç
    // ui-designer'ın istediği "kenarlıksız/köşesiz, yalnızca overflow-hidden" görünümüyle eşleşir.
    item: "overflow-hidden rounded-none border-0",
    trigger: "px-1 py-3 text-sm font-medium hover:bg-transparent",
    panelText: "px-1 pb-3 text-foreground/60",
  },
};

/**
 * `spotlight` — imperiumhealthgroup.com referanslı (2026-10-03, journey-faq-blok turu). Ortada
 * hap-etiket (`badge`) + iki yanında uçlara doğru şeffaflaşan çizgiler, altında `intro`. Kartlar
 * beyaz/rounded-2xl; açık kartta `--site-accent`'ten açık bir gradyan + `--site-primary` kenarlık;
 * soru metni `--site-primary`'ye döner; buton dolu `--site-primary`, `+` → `−` 90° dönerek
 * (iki ikon üst üste, opacity/rotate çapraz geçişli) değişir. Panel yüksekliği Base UI'ın
 * `--accordion-panel-height` CSS değişkeni + `data-open`/`data-closed`/`data-starting-style`/
 * `data-ending-style` nitelikleriyle (bkz. `@base-ui/react/collapsible` panel sözleşmesi)
 * yumuşak açılır/kapanır. `motion-reduce:` ile `prefers-reduced-motion` açıkken TÜM geçişler
 * (yükseklik + ikon rotasyonu + renk) anında/dönüşümsüz olur. Sabit HEX YOK, sadece
 * `--site-primary`/`--site-accent` CSS değişkenleri.
 */
function SpotlightAccordion({ block }: { block: AccordionBlock; items: AccordionBlock["data"]["items"] }) {
  const items = block.data.items.filter((item) => item.question.trim() && item.answer.trim());
  const openByDefault = items.filter((item) => item.isOpenDefault).map((item) => item.id);
  const defaultValue =
    openByDefault.length > 0
      ? block.data.allowMultipleOpen
        ? openByDefault
        : openByDefault.slice(0, 1)
      : block.data.defaultOpenFirst && items[0]
        ? [items[0].id]
        : [];

  return (
    <div>
      {(block.data.badge || block.data.intro) && (
        <div className="mx-auto mb-10 max-w-xl text-center">
          {block.data.badge && (
            <div className="mb-4 flex items-center justify-center gap-4">
              <span className="h-px flex-1 bg-gradient-to-l from-border to-transparent" aria-hidden="true" />
              <span className="shrink-0 rounded-full border border-border px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--site-primary)]">
                {block.data.badge}
              </span>
              <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" aria-hidden="true" />
            </div>
          )}
          {block.data.intro && <p className="text-sm leading-relaxed text-foreground/60 sm:text-base">{block.data.intro}</p>}
        </div>
      )}

      <AccordionPrimitive.Root multiple={block.data.allowMultipleOpen} defaultValue={defaultValue} className="flex flex-col gap-4">
        {items.map((item) => (
          <AccordionPrimitive.Item key={item.id} value={item.id} className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border/60">
            <AccordionPrimitive.Header>
              <AccordionPrimitive.Trigger
                className={cn(
                  "group flex w-full items-center justify-between gap-4 px-5 py-4 text-left outline-none transition-colors duration-300",
                  "focus-visible:ring-2 focus-visible:ring-ring/50",
                  "data-[panel-open]:bg-gradient-to-br data-[panel-open]:from-[color-mix(in_oklch,var(--site-accent)_16%,white)] data-[panel-open]:to-card data-[panel-open]:ring-1 data-[panel-open]:ring-[var(--site-accent)]/50"
                )}
              >
                <span className="font-semibold text-foreground transition-colors duration-300 group-data-[panel-open]:text-[var(--site-primary)]">
                  {item.question}
                </span>
                <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-muted transition-colors duration-300 group-data-[panel-open]:bg-[var(--site-primary)]">
                  <Plus
                    aria-hidden="true"
                    className="h-4 w-4 text-foreground/70 transition-all duration-300 motion-reduce:transition-none group-data-[panel-open]:rotate-90 group-data-[panel-open]:opacity-0"
                  />
                  <Minus
                    aria-hidden="true"
                    className="absolute h-4 w-4 -rotate-90 text-white opacity-0 transition-all duration-300 motion-reduce:transition-none group-data-[panel-open]:rotate-0 group-data-[panel-open]:opacity-100"
                  />
                </span>
              </AccordionPrimitive.Trigger>
            </AccordionPrimitive.Header>
            <AccordionPrimitive.Panel
              className={cn(
                "overflow-hidden transition-[height] duration-300 ease-out motion-reduce:transition-none",
                "h-[var(--accordion-panel-height)] data-[starting-style]:h-0 data-[ending-style]:h-0"
              )}
            >
              <p className="border-t border-border/60 px-5 pb-5 pt-4 text-sm leading-relaxed text-foreground/70">{item.answer}</p>
            </AccordionPrimitive.Panel>
          </AccordionPrimitive.Item>
        ))}
      </AccordionPrimitive.Root>
    </div>
  );
}

export function AccordionBlockView({ block, chrome }: { block: AccordionBlock; chrome: BlockChrome }) {
  const items = block.data.items.filter((item) => item.question.trim() && item.answer.trim());
  if (items.length === 0) return null;

  const layoutStyle = block.data.layoutStyle ?? "bordered";

  if (layoutStyle === "spotlight") {
    return (
      <section className={cn(chrome === "page" && "px-4 py-8 sm:px-6")}>
        <div className="mx-auto max-w-3xl">
          <SpotlightAccordion block={block} items={items} />
        </div>
        {/* FAQPage JSON-LD aşağıdaki yorumla AYNI gerekçeyle burada ÜRETİLMEZ. */}
      </section>
    );
  }

  const layoutClasses = ACCORDION_LAYOUT_CLASSES[layoutStyle];

  // `allowMultipleOpen === false` iken birden fazla öğe `isOpenDefault` işaretliyse YALNIZCA
  // İLKİ açılır (mimar §2.2 — `Accordion defaultValue` tek elemanlı dizi alır).
  const openByDefault = items.filter((item) => item.isOpenDefault).map((item) => item.id);
  const defaultValue = block.data.allowMultipleOpen ? openByDefault : openByDefault.slice(0, 1);

  return (
    <section className={cn(chrome === "page" && "px-4 py-8 sm:px-6")}>
      <div className="mx-auto max-w-3xl">
        <Accordion multiple={block.data.allowMultipleOpen} defaultValue={defaultValue} className={layoutClasses.list}>
          {items.map((item) => (
            <AccordionItem key={item.id} value={item.id} className={layoutClasses.item}>
              <AccordionTrigger className={layoutClasses.trigger}>{item.question}</AccordionTrigger>
              <AccordionPanel>
                <p className={layoutClasses.panelText}>{item.answer}</p>
              </AccordionPanel>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
      {/* FAQPage JSON-LD BURADA ARTIK ÜRETİLMEZ — sayfada 2+ `accordion` bloğu olduğunda her blok
          kendi script'ini basarsa Google'ın beklediği "sayfa başına TEK FAQPage" kuralı ihlal
          edilirdi. Toplama + tek script üretimi artık sayfa seviyesinde
          `lib/page-builder/structured-data.ts::buildFaqPageJsonLd` ile yapılır (bkz.
          `[slug]/page.tsx` / kök `page.tsx`) — seo-agent, `.claude/architect-scope-google-map-
          corporate-blocks.md` §7.5 Boşluk 1. `layoutStyle`/`isOpenDefault` eklemeleri bu görsel
          render'ı etkiler, JSON-LD üretimini ETKİLEMEZ (o artık burada bile yok). `spotlight`
          (badge/intro/defaultOpenFirst dahil) de AYNI kuralın kapsamındadır. */}
    </section>
  );
}
