import type { DoctorFaqItem } from "@/lib/api/types";
import { safeJsonLdString } from "@/lib/page-builder/structured-data";

/**
 * Paket Y — hekim profili SSS için `FAQPage` JSON-LD. YALNIZCA dolu soru/cevap varsa üretilir
 * (`null` → `JsonLdScript` hiçbir şey basmaz). `Review`/`AggregateRating` BİLİNÇLİ OLARAK yoktur:
 * Google, kuruluşun kendi hakkındaki yorum işaretlemesini desteklemez; yanlış kullanım cezaya yol açabilir.
 */
export function buildDoctorFaqJsonLd(faq: readonly DoctorFaqItem[] | undefined): string | null {
  const items = (faq ?? []).filter((item) => item.question.trim() !== "" && item.answer.trim() !== "");
  if (items.length === 0) return null;
  return safeJsonLdString({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  });
}
