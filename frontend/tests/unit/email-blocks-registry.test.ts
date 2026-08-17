import { describe, expect, it } from "vitest";
import { EMAIL_BLOCK_TYPES, EMAIL_BLOCK_SPACING_PX, createEmailBlock, emailBlockRegistry } from "@/lib/email-blocks/registry";

describe("emailBlockRegistry", () => {
  it("her blok tipi için bir ikon + etiket tanımlar", () => {
    for (const type of EMAIL_BLOCK_TYPES) {
      expect(emailBlockRegistry[type].label.length).toBeGreaterThan(0);
      expect(emailBlockRegistry[type].icon).toBeTruthy();
    }
  });
});

describe("createEmailBlock", () => {
  it("her blok tipi için varsayılan style + benzersiz id üretir", () => {
    const a = createEmailBlock("text");
    const b = createEmailBlock("text");
    expect(a.id).not.toBe(b.id);
    expect(a.style).toEqual({ align: "left", backgroundColor: null, textColor: null, paddingY: "md", paddingX: "md" });
  });

  it("logo-header: useSiteLogo varsayılan true, logoUrl null", () => {
    const block = createEmailBlock("logo-header");
    expect(block.type).toBe("logo-header");
    if (block.type === "logo-header") {
      expect(block.data.useSiteLogo).toBe(true);
      expect(block.data.logoUrl).toBeNull();
      expect(block.data.height).toBeGreaterThan(0);
    }
  });

  it("heading: level varsayılan 2", () => {
    const block = createEmailBlock("heading");
    if (block.type === "heading") expect(block.data.level).toBe(2);
  });

  it("button: href/radius varsayılanları geçerli", () => {
    const block = createEmailBlock("button");
    if (block.type === "button") {
      expect(block.data.radius).toBe("sm");
      expect(block.data.backgroundColor).toBeNull();
    }
  });

  it("image: mediaId null, url boş, width null (otomatik genişlik)", () => {
    const block = createEmailBlock("image");
    if (block.type === "image") {
      expect(block.data.mediaId).toBeNull();
      expect(block.data.width).toBeNull();
    }
  });

  it("divider: thickness varsayılan 1", () => {
    const block = createEmailBlock("divider");
    if (block.type === "divider") expect(block.data.thickness).toBe(1);
  });

  it("footer: text boş başlar (zorunlu KVKK footer'ından AYRI, ek metin)", () => {
    const block = createEmailBlock("footer");
    if (block.type === "footer") expect(block.data.text).toBe("");
  });
});

describe("EMAIL_BLOCK_SPACING_PX", () => {
  it("0/8/16/32 ölçeğini birebir uygular", () => {
    expect(EMAIL_BLOCK_SPACING_PX).toEqual({ none: 0, sm: 8, md: 16, lg: 32 });
  });
});
