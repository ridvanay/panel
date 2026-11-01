/**
 * qa-agent — Paket Z1-ek once/sonra ekran goruntuleri icin ORTAK fixture icerigi. Ayni icerik hem master uzerinde
 * ("ONCE", blog-z1ek-once.spec.ts) hem de feat dalinda ("SONRA", blog-z1ek.spec.ts) olusturulur; boylece goruntuler
 * birebir karsilastirilabilir. Metinler yerel fixture, notr, tibbi iddiasizdir.
 */
export const SHOT_PAGES = {
  builder: { slug: "qa-z1ek-shot-page", title: { tr: "Örnek kurumsal sayfa", en: "Sample corporate page" } },
  legal: { slug: "qa-z1ek-shot-legal", title: { tr: "Örnek kullanım koşulları", en: "Sample terms of use" } },
} as const;

type L = "tr" | "en";

const COPY: Record<L, { intro: string; h2a: string; p: string; list: string[]; h3: string; h2b: string; tableHead: [string, string]; rows: [string, string][]; tail: string }> = {
  en: {
    intro: "This page is local fixture content used to review how plain CMS pages are laid out. It contains no real information.",
    h2a: "How we work",
    p: "Our team follows a simple process. The text below is neutral placeholder copy that gives the page some length so headings, spacing, lists and tables can be reviewed.",
    list: ["First, we listen to the request", "Then we prepare a plan with you", "Finally, we follow up after the service"],
    h3: "Opening hours",
    h2b: "At a glance",
    tableHead: ["Topic", "Detail"],
    rows: [
      ["Support", "Weekdays"],
      ["Reply time", "Within one working day"],
    ],
    tail: "If you have a question, please use the contact page.",
  },
  tr: {
    intro: "Bu sayfa, düz CMS sayfalarının yerleşimini incelemek için kullanılan yerel örnek içeriktir. Gerçek bilgi içermez.",
    h2a: "Nasıl çalışırız",
    p: "Ekibimiz basit bir süreç izler. Aşağıdaki metin, başlıkların, boşlukların, listelerin ve tabloların incelenebilmesi için sayfaya uzunluk kazandıran nötr örnek metindir.",
    list: ["Önce talebi dinleriz", "Sonra sizinle birlikte bir plan hazırlarız", "Son olarak hizmet sonrası takip ederiz"],
    h3: "Çalışma saatleri",
    h2b: "Bir bakışta",
    tableHead: ["Konu", "Ayrıntı"],
    rows: [
      ["Destek", "Hafta içi"],
      ["Yanıt süresi", "Bir iş günü içinde"],
    ],
    tail: "Sorunuz varsa lütfen iletişim sayfasını kullanın.",
  },
};

const h = (id: string, text: string, level: number) => ({ id, type: "heading", data: { text, level, align: "left", underline: false } });
const tx = (id: string, html: string) => ({ id, type: "text", data: { html } });

/** Genel (yasal olmayan) builder sayfasi: baslik blogu (sayfa basligiyla ayni H1) + zengin metin. */
export function shotBuilderBlocks(l: L): unknown[] {
  const c = COPY[l];
  return [
    h("s-h1", SHOT_PAGES.builder.title[l], 1),
    tx("s-t1", `<p>${c.intro}</p>`),
    h("s-h2a", c.h2a, 2),
    tx("s-t2", `<p>${c.p}</p><ul>${c.list.map((i) => `<li>${i}</li>`).join("")}</ul><h3>${c.h3}</h3><p>${c.p}</p>`),
    h("s-h2b", c.h2b, 2),
    tx(
      "s-t3",
      `<table><thead><tr><th>${c.tableHead[0]}</th><th>${c.tableHead[1]}</th></tr></thead><tbody>${c.rows
        .map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`)
        .join("")}</tbody></table><p>${c.tail}</p>`
    ),
  ];
}

/** Hukuki belge: icerik, sayfa basligiyla ayni H1 ile baslar (yasal metin degismemeli). */
export function shotLegalBlocks(l: L): unknown[] {
  const c = COPY[l];
  return [
    tx(
      "s-l1",
      `<h1>${SHOT_PAGES.legal.title[l]}</h1><p>${c.intro}</p><h2>1. ${c.h2a}</h2><p>${c.p}</p><ol>${c.list.map((i) => `<li>${i}</li>`).join("")}</ol><h2>2. ${c.h2b}</h2><p>${c.tail}</p>`
    ),
  ];
}
