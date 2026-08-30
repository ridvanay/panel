import { describe, expect, it } from "vitest";
import { findSliderReferences } from "../../src/modules/sliders/lib/slider-usage";

const SLIDER_ID = "8f14e45f-ceea-4d0f-9c1b-0b2c3d4e5f60";
const OTHER_SLIDER_ID = "11111111-1111-1111-1111-111111111111";

function textBlock(id: string, html: string) {
  return { id, type: "text", data: { html } };
}

function customHtmlBlock(id: string, html: string) {
  return { id, type: "custom-html", data: { html } };
}

function advancedSliderBlock(id: string, sliderId?: string) {
  return { id, type: "advanced-slider", data: sliderId !== undefined ? { sliderId } : {} };
}

function container(id: string, children: unknown[]) {
  return { id, type: "container", children };
}

describe("findSliderReferences — lib/slider-usage.ts (§9.2.7 kısa kod taraması)", () => {
  it("detects a shortcode embedded in a 'text' block's html (usageType: shortcode)", () => {
    const blocks = [textBlock("b1", `<p>Merhaba [slider id="${SLIDER_ID}"]</p>`)];
    const result = findSliderReferences(blocks, SLIDER_ID);
    expect(result).toEqual([{ blockId: "b1", usageType: "shortcode" }]);
  });

  it("detects a shortcode embedded in a 'custom-html' block's html", () => {
    const blocks = [customHtmlBlock("b1", `<div>[slider id='${SLIDER_ID}']</div>`)];
    const result = findSliderReferences(blocks, SLIDER_ID);
    expect(result).toEqual([{ blockId: "b1", usageType: "shortcode" }]);
  });

  it("detects a shortcode inside a 'text' block nested within a container", () => {
    const blocks = [container("c1", [textBlock("b1", `[slider id="${SLIDER_ID}"]`)])];
    const result = findSliderReferences(blocks, SLIDER_ID);
    expect(result).toEqual([{ blockId: "b1", usageType: "shortcode" }]);
  });

  it("does NOT detect a shortcode referencing a different (wrong) uuid", () => {
    const blocks = [textBlock("b1", `[slider id="${OTHER_SLIDER_ID}"]`)];
    const result = findSliderReferences(blocks, SLIDER_ID);
    expect(result).toEqual([]);
  });

  it("does NOT detect a shortcode with a missing quote", () => {
    const blocks = [textBlock("b1", `[slider id=${SLIDER_ID}]`)];
    const result = findSliderReferences(blocks, SLIDER_ID);
    expect(result).toEqual([]);
  });

  it("does NOT detect a malformed shortcode ('[slider id=abc]')", () => {
    const blocks = [textBlock("b1", `[slider id=abc]`)];
    const result = findSliderReferences(blocks, SLIDER_ID);
    expect(result).toEqual([]);
  });

  it("does NOT detect a shortcode with mismatched open/close quotes", () => {
    const blocks = [textBlock("b1", `[slider id="${SLIDER_ID}']`)];
    const result = findSliderReferences(blocks, SLIDER_ID);
    expect(result).toEqual([]);
  });

  it("accepts the &quot; entity-encoded quote variant", () => {
    const blocks = [textBlock("b1", `[slider id=&quot;${SLIDER_ID}&quot;]`)];
    const result = findSliderReferences(blocks, SLIDER_ID);
    expect(result).toEqual([{ blockId: "b1", usageType: "shortcode" }]);
  });

  it("produces TWO separate entries when the same page has both a block reference AND a shortcode reference", () => {
    const blocks = [advancedSliderBlock("block-1", SLIDER_ID), textBlock("text-1", `[slider id="${SLIDER_ID}"]`)];
    const result = findSliderReferences(blocks, SLIDER_ID);
    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        { blockId: "block-1", usageType: "block" },
        { blockId: "text-1", usageType: "shortcode" },
      ])
    );
  });

  it("still detects an 'advanced-slider' block reference (usageType: block)", () => {
    const blocks = [advancedSliderBlock("block-1", SLIDER_ID)];
    const result = findSliderReferences(blocks, SLIDER_ID);
    expect(result).toEqual([{ blockId: "block-1", usageType: "block" }]);
  });

  it("does not match an 'advanced-slider' block with no sliderId selected yet", () => {
    const blocks = [advancedSliderBlock("block-1")];
    const result = findSliderReferences(blocks, SLIDER_ID);
    expect(result).toEqual([]);
  });

  it("returns an empty array for non-array blocks input", () => {
    expect(findSliderReferences(null, SLIDER_ID)).toEqual([]);
    expect(findSliderReferences(undefined, SLIDER_ID)).toEqual([]);
    expect(findSliderReferences({}, SLIDER_ID)).toEqual([]);
  });
});
