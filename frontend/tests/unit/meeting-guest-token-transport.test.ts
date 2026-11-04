import { afterEach, describe, expect, it, vi } from "vitest";
import { guestJoin, guestPreflight } from "@/lib/api/meetings";

/** Paket AM — belirteç fetch URL'sinde/sorgusunda değil, yalnızca POST gövdesinde taşınır. */
const TOKEN = `mg_${"A".repeat(43)}`;

afterEach(() => vi.restoreAllMocks());

describe("belirteç taşıma", () => {
  it("guestJoin/guestPreflight: URL'de belirteç yok, gövdede var", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify({ data: { status: "waiting", guestSession: "gs", pollAfterSec: 5 } }), { status: 200, headers: { "content-type": "application/json" } })
    );
    await guestJoin({ t: TOKEN, name: "Ada" });
    await guestPreflight(TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain("mg_");
      expect(String(url)).not.toContain("?");
      expect((init as RequestInit).method).toBe("POST");
      expect(String((init as RequestInit).body)).toContain(TOKEN);
    }
  });
});
