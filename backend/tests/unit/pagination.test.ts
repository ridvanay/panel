import { describe, expect, it } from "vitest";
import { buildPageMeta, encodeCursor, parseCursor } from "../../src/lib/pagination";

describe("encodeCursor / parseCursor", () => {
  it("round-trips a seq number through a cursor", () => {
    const cursor = encodeCursor(42);
    expect(parseCursor(cursor)).toBe(42);
  });

  it("returns undefined for an empty/missing cursor", () => {
    expect(parseCursor(undefined)).toBeUndefined();
    expect(parseCursor("")).toBeUndefined();
  });

  it("returns undefined for a malformed cursor", () => {
    expect(parseCursor("not-a-valid-base64url-number")).toBeUndefined();
  });

  it("returns undefined for a non-positive decoded number", () => {
    expect(parseCursor(encodeCursor(0))).toBeUndefined();
  });
});

describe("buildPageMeta", () => {
  it("returns a nextCursor when the page is full (more items may exist)", () => {
    const items = [{ seq: 1 }, { seq: 2 }, { seq: 3 }];
    const meta = buildPageMeta(items, 3);
    expect(meta.nextCursor).toBe(encodeCursor(3));
  });

  it("returns null nextCursor when the page is short (last page)", () => {
    const items = [{ seq: 1 }, { seq: 2 }];
    const meta = buildPageMeta(items, 3);
    expect(meta.nextCursor).toBeNull();
  });

  it("returns null nextCursor for an empty page", () => {
    expect(buildPageMeta([], 20).nextCursor).toBeNull();
  });
});
