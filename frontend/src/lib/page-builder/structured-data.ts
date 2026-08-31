import type { AccordionQAItem, PageNode } from "./types";

/**
 * Sayfa-seviyesi JSON-LD toplayıcı + güvenli serileştirme yardımcıları.
 * `.claude/architect-scope-google-map-corporate-blocks.md` §6/§7.5 — seo-agent BAĞLAYICI kararları.
 *
 * Neden BLOK BİLEŞENLERİNİN İÇİNDE DEĞİL (Boşluk 1 çözümü): bir sayfada 2+ `accordion` bloğu
 * varsa her blok kendi `<script type="application/ld+json">` etiketini basarsa Google sayfa
 * başına TEK `FAQPage` beklediğinden Search Console "yinelenen yapılandırılmış veri" uyarısı
 * üretir. Çözüm: `accordion-block.tsx` artık JSON-LD ÜRETMEZ (yalnızca görsel render); sayfadaki
 * TÜM accordion bloklarının (konteynerler İÇİNDEKİLER dahil) soru/cevapları burada TEK bir
 * `FAQPage`'de toplanır ve sayfa düzeyinde (`[slug]/page.tsx` / kök `page.tsx`) TEK `<script>`
 * olarak basılır.
 *
 * `noIndex` sorumluluğu (Boşluk 2): bu modül `noIndex`'ten HABERSİZDİR — bastırma kararı
 * çağıran sayfa bileşenlerinde verilir (onlar zaten `generateMetadata`de aynı `noIndex` hesabını
 * yapıyor, TEK kaynak orada kalır; burada ikinci bir kopya YOK).
 */

/** "</script>" enjeksiyonunu önlemek için JSON içindeki "</" dizisi kaçışlanır (OWASP "JSON in
 *  HTML" tavsiyesi) — `JSON.stringify` bunu KENDİLİĞİNDEN yapmaz. Sayfadaki HER JSON-LD çıktısı
 *  BU fonksiyondan geçmek ZORUNDADIR (eski `accordion-block.tsx::faqJsonLd` deseninin TEK kaynağı). */
export function safeJsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/<\//g, "<\\/");
}

/** Ağacı (konteynerler dahil) gezip her düğüm için `visit`in ürettiği öğeleri sırayı koruyarak
 *  düzleştirir — `accordion`/`google-map` toplayıcılarının ortak gezinme mantığı. */
function walk<T>(nodes: PageNode[], visit: (node: PageNode) => T[]): T[] {
  const out: T[] = [];
  for (const node of nodes) {
    out.push(...visit(node));
    if (node.type === "container") {
      out.push(...walk(node.children, visit));
    }
  }
  return out;
}

/** Sayfadaki TÜM `accordion` bloklarının (konteynerler dahil, belge sırası korunarak) soru+cevabı
 *  DOLU öğelerini tek bir listede toplar — eski per-block filtre (`question.trim() && answer.trim()`)
 *  BİREBİR korunur. */
export function collectFaqItems(nodes: PageNode[]): AccordionQAItem[] {
  return walk(nodes, (node) => {
    if (node.type !== "accordion") return [];
    return node.data.items.filter((item) => item.question.trim() && item.answer.trim());
  });
}

/** Schema.org FAQPage JSON-LD — sayfa başına TEK script (Boşluk 1). Dolu öğe yoksa `null`
 *  (çağıran taraf script'i hiç basmaz). */
export function buildFaqPageJsonLd(nodes: PageNode[]): string | null {
  const items = collectFaqItems(nodes);
  if (items.length === 0) return null;

  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
  return safeJsonLdString(data);
}

interface MapPlace {
  name?: string;
  address: string;
}

/** Sayfadaki TÜM `google-map` bloklarından yalnızca `address` DOLU olanları toplar. `embedUrl`
 *  (Mod A) TEK BAŞINA YETERLİ DEĞİLDİR — yalnızca kullanıcının gerçekten yazdığı serbest adres
 *  metninden türetilir (Boşluk 3 kısıtı: sahte/eksik `Place` üretme). */
function collectMapPlaces(nodes: PageNode[]): MapPlace[] {
  return walk(nodes, (node) => {
    if (node.type !== "google-map") return [];
    const address = node.data.address?.trim();
    if (!address) return [];
    const markerTitle = node.data.markerTitle?.trim();
    return [{ address, name: markerTitle || undefined }];
  });
}

/**
 * Schema.org `Place` JSON-LD (Boşluk 3). `LocalBusiness` DEĞİL `Place` seçildi: blokta telefon/
 * açılış saati/fiyat aralığı gibi hiçbir işletme-özgü alan YOK; `LocalBusiness` iddiası
 * doğrulanamaz bir varsayım üretirdi (mimar §7.5 — "sahte/uydurma alan üretme" kısıtı).
 * `address` şema.org'da hem düz metin hem `PostalAddress` kabul eder; burada yalnızca serbest
 * metin (`address`) var — sokak/il/posta kodu AYRIŞTIRILMADAN uydurulmuş bir `PostalAddress`
 * üretilmez, ham metin `address` alanına aynen yazılır.
 *
 * Birden fazla harita bloğu (ör. birden çok şube) varsa TEK script içinde `@graph` ile
 * birleştirilir — `FAQPage`'deki "sayfa başına tek script" dersinin ikinci uygulaması.
 */
export function buildMapPlaceJsonLd(nodes: PageNode[]): string | null {
  const places = collectMapPlaces(nodes);
  if (places.length === 0) return null;

  const toPlace = (place: MapPlace) => ({
    "@type": "Place",
    ...(place.name ? { name: place.name } : {}),
    address: place.address,
  });

  const data =
    places.length === 1
      ? { "@context": "https://schema.org", ...toPlace(places[0]) }
      : { "@context": "https://schema.org", "@graph": places.map(toPlace) };

  return safeJsonLdString(data);
}
