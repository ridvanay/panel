import { describe, expect, it } from "vitest";
import { addUtcDays, startOfUtcDay, toDateKey } from "../../src/lib/date";

describe("startOfUtcDay", () => {
  it("returns midnight UTC of today", () => {
    const result = startOfUtcDay();
    expect(result.toISOString()).toBe(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  });
});

describe("addUtcDays", () => {
  it("adds positive days", () => {
    const base = new Date("2026-01-01T00:00:00.000Z");
    expect(toDateKey(addUtcDays(base, 5))).toBe("2026-01-06");
  });

  it("subtracts with negative days", () => {
    const base = new Date("2026-01-10T00:00:00.000Z");
    expect(toDateKey(addUtcDays(base, -3))).toBe("2026-01-07");
  });

  it("rolls over month boundaries", () => {
    const base = new Date("2026-01-31T00:00:00.000Z");
    expect(toDateKey(addUtcDays(base, 1))).toBe("2026-02-01");
  });

  it("does not mutate the input date", () => {
    const base = new Date("2026-01-01T00:00:00.000Z");
    addUtcDays(base, 10);
    expect(base.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("toDateKey", () => {
  it("formats as YYYY-MM-DD", () => {
    expect(toDateKey(new Date("2026-03-05T13:45:00.000Z"))).toBe("2026-03-05");
  });
});
