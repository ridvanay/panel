import { describe, expect, it } from "vitest";
import { parseSlideLayers, SliderLayerSchema } from "../../src/modules/sliders/lib/layers";
import { MAX_SLIDE_LAYERS, MAX_SLIDE_LAYERS_BYTES } from "../../src/modules/sliders/lib/constants";
import { ApiError, ValidationError, PayloadTooLargeError } from "../../src/lib/errors";

function headingLayer(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: "heading",
    content: { text: "Hello", level: 2 },
    position: { xPercent: 10, yPercent: 20, origin: "top-left" },
    animation: { inEffect: "fade", delayMs: 0, durationMs: 300 },
    ...overrides,
  };
}

function buttonLayer(id: string, href: string) {
  return {
    id,
    type: "button",
    content: { label: "Tıkla", href, variant: "solid", size: "md" },
    position: { xPercent: 10, yPercent: 20, origin: "top-left" },
    animation: { inEffect: "fade", delayMs: 0, durationMs: 300 },
  };
}

describe("parseSlideLayers — SlideLayersSchema/lib/layers.ts", () => {
  it("accepts a well-formed single-layer array", () => {
    const result = parseSlideLayers([headingLayer("l1")]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("l1");
  });

  it("accepts exactly MAX_SLIDE_LAYERS (20) layers (boundary)", () => {
    const layers = Array.from({ length: MAX_SLIDE_LAYERS }, (_, i) => headingLayer(`l${i}`));
    const result = parseSlideLayers(layers);
    expect(result).toHaveLength(MAX_SLIDE_LAYERS);
  });

  it("rejects 21 layers (over MAX_SLIDE_LAYERS) with a 422 ValidationError", () => {
    const layers = Array.from({ length: MAX_SLIDE_LAYERS + 1 }, (_, i) => headingLayer(`l${i}`));
    expect(() => parseSlideLayers(layers)).toThrow(ValidationError);
    try {
      parseSlideLayers(layers);
      expect.fail("beklenen hata fırlatılmadı");
    } catch (err) {
      expect((err as ApiError).statusCode).toBe(422);
    }
  });

  it("rejects a payload over MAX_SLIDE_LAYERS_BYTES (64 KB) with a 413 PayloadTooLargeError, not 422", () => {
    // Şekil GEÇERSİZ olabilir — byte tavanı kontrolü şekil doğrulamasından ÖNCE, ham dizi
    // üzerinde çalışır (bkz. lib/layers.ts::parseSlideLayers doğrulama sırası yorumu).
    const bulky = Array.from({ length: 10 }, (_, i) => ({ id: `l${i}`, junk: "x".repeat(8000) }));
    expect(Buffer.byteLength(JSON.stringify(bulky), "utf8")).toBeGreaterThan(MAX_SLIDE_LAYERS_BYTES);

    expect(() => parseSlideLayers(bulky)).toThrow(PayloadTooLargeError);
    try {
      parseSlideLayers(bulky);
      expect.fail("beklenen hata fırlatılmadı");
    } catch (err) {
      expect((err as ApiError).statusCode).toBe(413);
      expect((err as ApiError).code).toBe("PAYLOAD_TOO_LARGE");
    }
  });

  it("rejects duplicate layer ids with a 422 ValidationError", () => {
    const layers = [headingLayer("dup"), headingLayer("dup")];
    expect(() => parseSlideLayers(layers)).toThrow(ValidationError);
    try {
      parseSlideLayers(layers);
      expect.fail("beklenen hata fırlatılmadı");
    } catch (err) {
      expect((err as ApiError).statusCode).toBe(422);
    }
  });

  it("rejects a 'javascript:' href in a button layer's content", () => {
    const layers = [buttonLayer("b1", "javascript:alert(1)")];
    expect(() => parseSlideLayers(layers)).toThrow(ValidationError);
  });

  it("accepts a safe relative href in a button layer's content", () => {
    const layers = [buttonLayer("b1", "/kampanya")];
    const result = parseSlideLayers(layers);
    expect(result).toHaveLength(1);
  });

  it("rejects an attempt to override 'content' via responsive.mobile (v1 sınırı — strict şema reddi)", () => {
    const layers = [
      headingLayer("l1", {
        responsive: { mobile: { content: { text: "Mobilde farklı metin" } } },
      }),
    ];
    expect(() => parseSlideLayers(layers)).toThrow(ValidationError);
  });

  it("accepts a legitimate responsive.mobile override (style/position, no content)", () => {
    const layers = [
      headingLayer("l1", {
        responsive: { mobile: { style: { fontSize: 30 }, hidden: false } },
      }),
    ];
    const result = parseSlideLayers(layers);
    expect(result).toHaveLength(1);
  });

  it("rejects an unknown layer 'type'", () => {
    const parsed = SliderLayerSchema.safeParse({
      id: "x",
      type: "video",
      content: {},
      position: { xPercent: 0, yPercent: 0, origin: "top-left" },
      animation: { inEffect: "fade", delayMs: 0, durationMs: 300 },
    });
    expect(parsed.success).toBe(false);
  });
});
