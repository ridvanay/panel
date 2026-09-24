import { describe, expect, it } from "vitest";
import { CreatePageRequestSchema, UpdatePageRequestSchema } from "../../src/modules/pages/pages.schemas";
import { assertTemplateEditAllowed } from "../../src/lib/page-template-guard";
import { TEMPLATE_EDITABLE_FIELDS } from "../../src/lib/page-template-fields";

/**
 * "Hakkımızda" şablon bloğu (`about-page`) — bkz. `src/lib/about-page-template.ts`. Dispatch dalı
 * unutulsaydı blok `z.record(z.unknown())` olarak SESSİZCE geçerdi; bu yüzden güvenlik testleri
 * açıkça `success === false` bekler.
 */
function aboutBlock(data: Record<string, unknown> = {}, id = "about-root") {
  return { id, type: "about-page", data };
}

function parseBlocks(blocks: unknown[]) {
  return CreatePageRequestSchema.safeParse({ title: "Hakkımızda", slug: "about", blocks });
}

describe("about-page — geçerli veri ve varsayılanlar", () => {
  it("boş data'yı kabul eder ve tüm bölümleri varsayılanlarla doldurur (boş string = sözlük varsayılanı)", () => {
    const result = parseBlocks([aboutBlock()]);
    expect(result.success).toBe(true);
    const block = (result.success ? result.data.blocks?.[0] : null) as { data: Record<string, Record<string, unknown>> };
    expect(block.data.hero).toBeDefined();
    expect(block.data.hero!.title).toBe("");
    expect(block.data.hero!.primaryCta).toEqual({ label: "", href: "" });
    expect(block.data.treatments).toMatchObject({ enabled: true, items: [] });
    expect(block.data.approach).toMatchObject({ enabled: true, items: [] });
    expect(block.data.doctors).toMatchObject({ enabled: true, count: 3, founderDoctorId: null });
  });

  it("tam dolu bir bloğu kabul eder; sayfa içi çapa, relative ve https bağlantılar geçerlidir", () => {
    const result = parseBlocks([
      aboutBlock({
        hero: {
          title: "Quality healthcare",
          primaryCta: { label: "Book", href: "/doctors" },
          secondaryCta: { label: "Meet", href: "#doctors" },
          imageUrl: "https://cdn.example.com/a.jpg",
        },
        treatments: { enabled: false, items: [{ id: "t1", name: "Dental care", icon: "Smile" }] },
        approach: { items: [{ id: "a1", title: "Clarity", body: "Text", icon: "ClipboardCheck" }] },
        doctors: { count: 6, founderDoctorId: "8f14e45f-ceea-4e7a-9f3b-1f0c5e1c2b3a", founderLabel: "Founder" },
        closing: { primaryCta: { label: "Contact", href: "https://example.com/contact" } },
      }),
    ]);
    expect(result.success).toBe(true);
  });

  it("bilinmeyen alanları atar (şema dışı veri DB'ye yazılmaz)", () => {
    const result = parseBlocks([aboutBlock({ hero: { title: "x", evil: "<script>" }, extra: 1 })]);
    expect(result.success).toBe(true);
    const block = (result.success ? result.data.blocks?.[0] : null) as { data: Record<string, Record<string, unknown>> };
    expect(block.data.hero).toBeDefined();
    expect(block.data.hero).not.toHaveProperty("evil");
    expect(block.data).not.toHaveProperty("extra");
  });
});

describe("about-page — güvenlik ve sınırlar", () => {
  it.each([
    ["javascript: şeması", "javascript:alert(1)"],
    ["baştaki boşluklu javascript:", "  javascript:alert(1)"],
    ["data: şeması", "data:text/html,<script>alert(1)</script>"],
    ["geçersiz çapa", "#<img>"],
  ])("tehlikeli/geçersiz bağlantıyı reddeder: %s", (_label, href) => {
    expect(parseBlocks([aboutBlock({ hero: { primaryCta: { label: "x", href } } })]).success).toBe(false);
    expect(parseBlocks([aboutBlock({ closing: { secondaryCta: { label: "x", href } } })]).success).toBe(false);
  });

  it("javascript: görsel URL'ini reddeder", () => {
    expect(parseBlocks([aboutBlock({ hero: { imageUrl: "javascript:alert(1)" } })]).success).toBe(false);
  });

  it("listede olmayan ikonu reddeder", () => {
    expect(parseBlocks([aboutBlock({ treatments: { items: [{ id: "t1", name: "X", icon: "Skull" }] } })]).success).toBe(false);
  });

  it("kart ve madde sayısı sınırlarını uygular", () => {
    const cards = Array.from({ length: 13 }, (_, i) => ({ id: `t${i}`, name: "X", icon: "Heart" }));
    const items = Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, title: "X", body: "", icon: "Heart" }));
    expect(parseBlocks([aboutBlock({ treatments: { items: cards } })]).success).toBe(false);
    expect(parseBlocks([aboutBlock({ approach: { items } })]).success).toBe(false);
  });

  it("doktor sayısını 1–6 aralığında, kurucu kimliğini uuid olarak zorunlu tutar", () => {
    expect(parseBlocks([aboutBlock({ doctors: { count: 0 } })]).success).toBe(false);
    expect(parseBlocks([aboutBlock({ doctors: { count: 7 } })]).success).toBe(false);
    expect(parseBlocks([aboutBlock({ doctors: { founderDoctorId: "vahit-mutlu" } })]).success).toBe(false);
  });

  it("metin uzunluk sınırını uygular", () => {
    expect(parseBlocks([aboutBlock({ hero: { title: "x".repeat(201) } })]).success).toBe(false);
  });
});

describe("about-page — tek kök blok kuralı", () => {
  const heading = { id: "h1", type: "heading", data: { text: "Başlık", level: 2, align: "left", underline: false } };

  it("başka bir blokla birlikte kullanılamaz", () => {
    expect(parseBlocks([aboutBlock(), heading]).success).toBe(false);
    expect(parseBlocks([heading, aboutBlock()]).success).toBe(false);
  });

  it("iki about bloğu olamaz", () => {
    expect(parseBlocks([aboutBlock({}, "a"), aboutBlock({}, "b")]).success).toBe(false);
  });

  it("konteyner içine konamaz", () => {
    const container = {
      id: "c1",
      type: "container",
      settings: { layout: "boxed", direction: "column", gap: 16 },
      children: [aboutBlock()],
    };
    expect(parseBlocks([container]).success).toBe(false);
  });

  it("aynı kural translations.<locale>.blocks için de geçerlidir", () => {
    const result = UpdatePageRequestSchema.safeParse({ translations: { en: { title: "About Us", blocks: [aboutBlock(), heading] } } });
    expect(result.success).toBe(false);
  });

  it("about bloğu içermeyen sayfalar bu kuraldan etkilenmez", () => {
    expect(parseBlocks([heading, { ...heading, id: "h2" }]).success).toBe(true);
  });
});

describe("about-page — şablon modu (Yazar rolü)", () => {
  it("alan haritası beş içerik bölümünü içerir", () => {
    expect(TEMPLATE_EDITABLE_FIELDS["about-page"]).toEqual(["data.hero", "data.treatments", "data.approach", "data.doctors", "data.closing"]);
  });

  it("Yazar bölüm içeriğini (liste öğesi ekleme dahil) değiştirebilir", () => {
    const existing = [aboutBlock({ treatments: { items: [] } })];
    const incoming = [aboutBlock({ treatments: { items: [{ id: "t1", name: "X", icon: "Heart" }] } })];
    expect(() => assertTemplateEditAllowed(existing, incoming)).not.toThrow();
  });

  it("Yazar bloğu silemez veya yanına başka blok ekleyemez", () => {
    const existing = [aboutBlock()];
    expect(() => assertTemplateEditAllowed(existing, [])).toThrow();
    expect(() =>
      assertTemplateEditAllowed(existing, [aboutBlock(), { id: "h1", type: "heading", data: { text: "x" } }])
    ).toThrow();
  });
});
