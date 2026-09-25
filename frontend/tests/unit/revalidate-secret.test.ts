import { afterEach, describe, expect, it, vi } from "vitest";
import { getRevalidateSecret } from "@/lib/revalidate-secret";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getRevalidateSecret", () => {
  it.each([
    ["tanımsız", undefined],
    ["boş", ""],
    ["yalnızca boşluk", "   "],
    ["örnek yer tutucu", "change-me-in-production"],
  ])("%s → null (uç fail-closed)", (_label, value) => {
    vi.stubEnv("REVALIDATE_SECRET", value as string);
    expect(getRevalidateSecret()).toBeNull();
  });

  it("gerçek değer baştaki/sondaki boşluk kırpılarak döner", () => {
    vi.stubEnv("REVALIDATE_SECRET", "  0f3a9c  ");
    expect(getRevalidateSecret()).toBe("0f3a9c");
  });
});
