import { describe, expect, it } from "vitest";
import { CreatePageRequestSchema } from "../../src/modules/pages/pages.schemas";
import { TEMPLATE_EDITABLE_FIELDS } from "../../src/lib/page-template-fields";

/**
 * "Anasayfa" şablon bloğu (`home-page`) — bkz. `src/lib/home-page-template.ts`. Dispatch dalı
 * unutulsaydı blok doğrulanmadan geçerdi; bu yüzden geçersiz değerlerin reddi açıkça test edilir.
 */
function homeBlock(data: Record<string, unknown> = {}, id = "home-root") {
  return { id, type: "home-page", data };
}

function parse(blocks: unknown[]) {
  return CreatePageRequestSchema.safeParse({ title: "Anasayfa", slug: "anasayfa-yeni", blocks });
}

const item = (id: string) => ({ id, icon: "Clock", title: "T", text: "X" });

describe("home-page blok şeması", () => {
  it("boş data'yı varsayılanlarla doldurur (6 kolon, 3 doktor, tüm bölümler açık, metinler boş = sözlük)", () => {
    const result = parse([homeBlock()]);
    expect(result.success).toBe(true);
    const data = (result.success ? result.data.blocks?.[0] : null) as { data: Record<string, Record<string, unknown>> };
    expect(data.data.hero).toMatchObject({ enabled: true, title: "", imageUrl: "" });
    expect(data.data.specialties).toMatchObject({ enabled: true, columns: 6 });
    expect(data.data.doctors).toMatchObject({ enabled: true, count: 3 });
    expect(data.data.closing).toMatchObject({ enabled: true });
    expect(data.data.trust).toBeUndefined();
    expect(data.data.how).toBeUndefined();
  });

  it("tam dolu bloğu kabul eder; sayfa içi çapa, göreli ve https bağlantılar geçerlidir", () => {
    const result = parse([
      homeBlock({
        hero: {
          title: "Book",
          primaryCta: { label: "Find a doctor", href: "/doctors" },
          secondaryCta: { label: "How it works", href: "#how" },
          imageUrl: "https://cdn.example.com/hero.jpg",
          cardTitle: "Secure",
        },
        trust: { enabled: true, items: [item("a"), item("b"), item("c"), item("d")] },
        how: { steps: [item("s1"), item("s2")] },
        specialties: { columns: 4 },
        doctors: { count: 8 },
        closing: { enabled: false, primaryCta: { label: "Contact", href: "/contact" } },
      }),
    ]);
    expect(result.success).toBe(true);
  });

  it.each([
    ["javascript: bağlantı", { hero: { primaryCta: { label: "x", href: "javascript:alert(1)" } } }],
    ["geçersiz görsel URL", { hero: { imageUrl: "javascript:alert(1)" } }],
    ["güven şeridinde 0 madde", { trust: { items: [] } }],
    ["güven şeridinde 5 madde", { trust: { items: ["a", "b", "c", "d", "e"].map(item) } }],
    ["tek adım", { how: { steps: [item("s1")] } }],
    ["5 adım", { how: { steps: ["1", "2", "3", "4", "5"].map(item) } }],
    ["listede olmayan ikon", { trust: { items: [{ id: "a", icon: "Rocket", title: "", text: "" }] } }],
    ["9 doktor", { doctors: { count: 9 } }],
    ["0 doktor", { doctors: { count: 0 } }],
    ["5 kolon", { specialties: { columns: 5 } }],
    ["çok uzun başlık", { hero: { title: "x".repeat(201) } }],
  ])("reddeder: %s", (_label, data) => {
    expect(parse([homeBlock(data)]).success).toBe(false);
  });

  it("yalnızca tek ve kök düğüm olabilir (başka blokla veya konteyner içinde reddedilir)", () => {
    expect(parse([homeBlock(), { id: "h", type: "heading", data: { text: "x", level: 2 } }]).success).toBe(false);
    expect(parse([homeBlock({}, "a"), homeBlock({}, "b")]).success).toBe(false);
  });

  it("şablon modunda bölüm içerikleri düzenlenebilir", () => {
    expect(TEMPLATE_EDITABLE_FIELDS["home-page"]).toEqual([
      "data.hero",
      "data.trust",
      "data.specialties",
      "data.how",
      "data.doctors",
      "data.closing",
    ]);
  });
});
