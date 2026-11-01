import { describe, expect, it } from "vitest";
import { BLOG_DICTIONARIES } from "@/lib/i18n/use-blog-strings";
import { blogStrings as en } from "@/lib/i18n/site-dictionaries/en/blog";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { blogListPath, cleanQuery, cleanTopic, findActiveGroup, listingRobots, splitTopicChips, totalPages, VISIBLE_TOPIC_CHIPS } from "@/lib/blog/topics";
import { paginationWindow } from "@/components/site/blog/blog-pagination";
import { fillBlogString } from "@/lib/blog/format";
import { specialtyIconFor } from "@/lib/blog/specialty-icon";
import { Stethoscope } from "lucide-react";
import { GROUPS } from "./blog-z1-fixtures";

const LANGS = ["tr", "en", "de", "ar", "ru", "es", "fr", "ro", "sr-latn"] as const;
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(",");

describe("Paket Z1 — sözlük paritesi (9 dil)", () => {
  it("9 dilin hepsi kayıtlı ve aynı anahtar kümesine sahip", () => {
    expect(Object.keys(BLOG_DICTIONARIES).sort()).toEqual([...LANGS].sort());
    const keys = Object.keys(en).sort();
    for (const lang of LANGS) expect(Object.keys(BLOG_DICTIONARIES[lang]!).sort(), lang).toEqual(keys);
  });

  it("hiçbir değer boş değil ve yer tutucular kaynakla aynı", () => {
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(BLOG_DICTIONARIES[lang]!)) {
        expect(value.trim().length, `${lang}.${key}`).toBeGreaterThan(0);
        expect(placeholders(value), `${lang}.${key}`).toBe(placeholders((en as Record<string, string>)[key]!));
      }
    }
  });

  it("çevrilmiş diller İngilizce metni birebir kopyalamaz (ortak anahtarlar hariç)", () => {
    for (const lang of LANGS.filter((l) => l !== "en")) {
      const same = Object.entries(BLOG_DICTIONARIES[lang]!).filter(([key, value]) => value === (en as Record<string, string>)[key]);
      expect(same.length, `${lang}: ${same.map(([k]) => k).join(",")}`).toBeLessThanOrEqual(2);
    }
  });

  it("sunucu sözlüğü blog bölümünü her dilde döner; bilinmeyen dil EN'e düşer", async () => {
    for (const lang of LANGS) expect((await getSiteDictionary(lang)).blog).toBe(BLOG_DICTIONARIES[lang]);
    expect((await getSiteDictionary("xx")).blog).toBe(en);
  });

  it("uyarı metni 9 dilde mevcut ve İngilizcesi sabit cümle", () => {
    expect(en.disclaimer).toBe("This article is for general information and is not a substitute for a medical consultation.");
    expect(en.pageTitle).toBe("Health Guides");
    expect(en.pageIntro).toBe("Patient guides written by our editorial team and reviewed by our physicians.");
  });
});

describe("Paket Z1 — filtre sayıları ve 'More topics'", () => {
  const ortho = GROUPS[0]!;

  it("ilk 6 çip görünür, kalanı More topics altında", () => {
    const { visible, hidden } = splitTopicChips(ortho.topics, "");
    expect(visible).toHaveLength(VISIBLE_TOPIC_CHIPS);
    expect(hidden.map((t) => t.slug)).toEqual(["elbow", "ankle"]);
    expect(visible[0]).toMatchObject({ slug: "knee-pain", count: 4 });
  });

  it("gizli kümedeki etkin konu görünür kümeye taşınır", () => {
    const { visible, hidden } = splitTopicChips(ortho.topics, "ankle");
    expect(visible.map((t) => t.slug)).toContain("ankle");
    expect(hidden.map((t) => t.slug)).toEqual(["elbow"]);
  });

  it("6 ya da daha az konuda More topics yok", () => {
    expect(splitTopicChips(GROUPS[1]!.topics, "").hidden).toEqual([]);
  });

  it("etkin grup uzmanlık slug'ı ya da konu slug'ı ile bulunur", () => {
    expect(findActiveGroup(GROUPS, "cardiology")?.specialty.slug).toBe("cardiology");
    expect(findActiveGroup(GROUPS, "hip")?.specialty.slug).toBe("orthopaedics");
    expect(findActiveGroup(GROUPS, "")).toBeNull();
    expect(findActiveGroup(GROUPS, "nope")).toBeNull();
  });
});

describe("Paket Z1 — URL, sayfalama ve meta kararları", () => {
  it("blogListPath: 1. sayfa /blog, n. sayfa /blog/page/n, sorgu eklenir", () => {
    expect(blogListPath({})).toBe("/blog");
    expect(blogListPath({ page: 1 })).toBe("/blog");
    expect(blogListPath({ page: 2 })).toBe("/blog/page/2");
    expect(blogListPath({ page: 3, topic: "knee-pain" })).toBe("/blog/page/3?topic=knee-pain");
    expect(blogListPath({ topic: "hip", q: "diz ağrısı" })).toBe("/blog?topic=hip&q=diz+a%C4%9Fr%C4%B1s%C4%B1");
  });

  it("girdi temizleme ve sayfa sayısı", () => {
    expect(cleanQuery("  a   b  ")).toBe("a b");
    expect(cleanQuery("x".repeat(300))).toHaveLength(100);
    expect(cleanTopic("knee-pain")).toBe("knee-pain");
    expect(cleanTopic("../etc")).toBe("");
    expect(totalPages(0, 12)).toBe(1);
    expect(totalPages(25, 12)).toBe(3);
  });

  it("arama ve sonuçsuz sayfa noindex, konu filtreli sayfa indekslenir", () => {
    expect(listingRobots({ q: "diz", total: 3 })).toEqual({ index: false, follow: true });
    expect(listingRobots({ q: "", total: 0 })).toEqual({ index: false, follow: true });
    expect(listingRobots({ q: "", total: 5 })).toEqual({ index: true, follow: true });
  });

  it("sayfa numarası penceresi", () => {
    expect(paginationWindow(1, 3)).toEqual([1, 2, 3]);
    expect(paginationWindow(5, 10)).toEqual([1, "gap", 4, 5, 6, "gap", 10]);
  });

  it("fillBlogString ve ikon eşlemesi", () => {
    expect(fillBlogString("Page {n} of {total}", { n: 2, total: 5 })).toBe("Page 2 of 5");
    expect(specialtyIconFor("unknown-xyz")).toBe(Stethoscope);
    expect(specialtyIconFor(null)).toBe(Stethoscope);
    expect(specialtyIconFor("dentalcare")).not.toBe(Stethoscope);
    expect(specialtyIconFor("cardiology")).not.toBe(specialtyIconFor("dentalcare"));
  });
});
