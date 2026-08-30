import { describe, expect, it } from "vitest";
import { MAX_SHORTCODE_SLIDERS_PER_FIELD, buildSliderShortcode, splitSliderShortcodes } from "@/lib/sliders/shortcode";

const UUID_1 = "8f14e45f-ceea-4d0f-9c1b-0b2c3d4e5f60";
const UUID_2 = "11111111-2222-3333-4444-555555555555";

describe("buildSliderShortcode", () => {
  it("builds the canonical shortcode string", () => {
    expect(buildSliderShortcode(UUID_1)).toBe(`[slider id="${UUID_1}"]`);
  });
});

describe("splitSliderShortcodes", () => {
  it("returns a single html segment when there is no shortcode", () => {
    const html = "<p>Merhaba dünya</p>";
    const segments = splitSliderShortcodes(html);
    expect(segments).toEqual([{ kind: "html", html }]);
  });

  it("splits a shortcode at the start of the content", () => {
    const html = `[slider id="${UUID_1}"]<p>sonra metin</p>`;
    const segments = splitSliderShortcodes(html);
    expect(segments).toEqual([{ kind: "slider", sliderId: UUID_1 }, { kind: "html", html: "<p>sonra metin</p>" }]);
  });

  it("splits a shortcode in the middle of the content", () => {
    const html = `<p>önce</p>[slider id="${UUID_1}"]<p>sonra</p>`;
    const segments = splitSliderShortcodes(html);
    expect(segments).toEqual([
      { kind: "html", html: "<p>önce</p>" },
      { kind: "slider", sliderId: UUID_1 },
      { kind: "html", html: "<p>sonra</p>" },
    ]);
  });

  it("splits a shortcode at the end of the content", () => {
    const html = `<p>önce metin</p>[slider id="${UUID_1}"]`;
    const segments = splitSliderShortcodes(html);
    expect(segments).toEqual([{ kind: "html", html: "<p>önce metin</p>" }, { kind: "slider", sliderId: UUID_1 }]);
  });

  it("handles two shortcodes back to back", () => {
    const html = `[slider id="${UUID_1}"][slider id="${UUID_2}"]`;
    const segments = splitSliderShortcodes(html);
    expect(segments).toEqual([
      { kind: "slider", sliderId: UUID_1 },
      { kind: "slider", sliderId: UUID_2 },
    ]);
  });

  it("does not split on an invalid uuid", () => {
    const html = `<p>metin [slider id="not-a-uuid"] devam</p>`;
    const segments = splitSliderShortcodes(html);
    expect(segments).toEqual([{ kind: "html", html }]);
  });

  it("accepts the &quot; quote variant", () => {
    const html = `[slider id=&quot;${UUID_1}&quot;]`;
    const segments = splitSliderShortcodes(html);
    expect(segments).toEqual([{ kind: "slider", sliderId: UUID_1 }]);
  });

  it("does not split a shortcode-looking string inside a tag attribute", () => {
    const html = `<img alt='[slider id="${UUID_1}"]'>`;
    const segments = splitSliderShortcodes(html);
    expect(segments).toEqual([{ kind: "html", html }]);
  });

  it("caps slider segments at MAX_SHORTCODE_SLIDERS_PER_FIELD, leaving the rest as html", () => {
    const uuids = Array.from({ length: 6 }, (_, i) => `00000000-0000-0000-0000-00000000000${i}`);
    const html = uuids.map((id) => `[slider id="${id}"]`).join("");
    const segments = splitSliderShortcodes(html);

    expect(MAX_SHORTCODE_SLIDERS_PER_FIELD).toBe(5);
    const sliderSegments = segments.filter((s) => s.kind === "slider");
    expect(sliderSegments).toHaveLength(5);
    expect(sliderSegments.map((s) => (s as { sliderId: string }).sliderId)).toEqual(uuids.slice(0, 5));

    const htmlSegments = segments.filter((s) => s.kind === "html");
    expect(htmlSegments.some((s) => (s as { html: string }).html.includes(uuids[5]!))).toBe(true);
  });
});
