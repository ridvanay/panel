"use client";

import { Accordion, AccordionItem, AccordionTrigger, AccordionPanel } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import type { AccordionBlock, AccordionQAItem, BlockChrome } from "@/lib/page-builder/types";

/** Schema.org FAQPage JSON-LD — yalnızca soru VE cevabı dolu öğeler dahil edilir. */
function faqJsonLd(items: AccordionQAItem[]): string {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
  // "</script>" enjeksiyonunu önlemek için JSON içindeki "</" dizisi kaçışlanır (OWASP "JSON in
  // HTML" tavsiyesi) — `JSON.stringify` bunu KENDİLİĞİNDEN yapmaz.
  return JSON.stringify(data).replace(/<\//g, "<\\/");
}

export function AccordionBlockView({ block, chrome }: { block: AccordionBlock; chrome: BlockChrome }) {
  const items = block.data.items.filter((item) => item.question.trim() && item.answer.trim());
  if (items.length === 0) return null;

  return (
    <section className={cn(chrome === "page" && "px-4 py-8 sm:px-6")}>
      <div className="mx-auto max-w-3xl">
        <Accordion multiple={block.data.allowMultipleOpen} defaultValue={[]}>
          {items.map((item) => (
            <AccordionItem key={item.id} value={item.id}>
              <AccordionTrigger>{item.question}</AccordionTrigger>
              <AccordionPanel>
                <p className="px-3 pb-3 text-foreground/70">{item.answer}</p>
              </AccordionPanel>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
      {/* JSON-LD, XSS'e karşı `</` kaçışlanarak güvenli hale getirildi (bkz. `faqJsonLd`) */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd(items) }} />
    </section>
  );
}
