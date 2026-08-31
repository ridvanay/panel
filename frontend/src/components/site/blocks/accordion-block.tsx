"use client";

import { Accordion, AccordionItem, AccordionTrigger, AccordionPanel } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import type { AccordionBlock, AccordionLayoutStyle, BlockChrome } from "@/lib/page-builder/types";

/**
 * `layoutStyle` sınıf tablosu — ui-designer §2 (BAĞLAYICI). `bordered` (varsayılan) alanları
 * `undefined` bırakır — `cn(base, undefined)` `ui/accordion.tsx`'in KENDİ taban sınıflarını
 * aynen bırakır, bu PİKSEL-EŞ garantiyi kod seviyesinde de sağlar (`tailwind-merge` `card`/
 * `minimal`'in override'larını doğru şekilde ezer).
 */
const ACCORDION_LAYOUT_CLASSES: Record<AccordionLayoutStyle, { list?: string; item?: string; trigger?: string; panelText: string }> = {
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

export function AccordionBlockView({ block, chrome }: { block: AccordionBlock; chrome: BlockChrome }) {
  const items = block.data.items.filter((item) => item.question.trim() && item.answer.trim());
  if (items.length === 0) return null;

  const layoutStyle = block.data.layoutStyle ?? "bordered";
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
          render'ı etkiler, JSON-LD üretimini ETKİLEMEZ (o artık burada bile yok). */}
    </section>
  );
}
