import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import {
  LEGACY_TOKEN_IN_URL_UNTIL,
  acceptLegacyToken,
  isLegacyTokenTransportAllowed,
  legacyTokenTransportCount,
  readAccessToken,
} from "../../src/lib/access-token-transport";

/** Paket AP — token taşıma yardımcısı: başlık önceliği, eski biçim geçiş süresi, log'da token yok. */
function fakeRequest(headers: Record<string, string | string[] | undefined> = {}) {
  const info = vi.fn();
  const request = { headers, url: "/api/v1/x?t=SECRET", routeOptions: { url: "/api/v1/x/:id" }, log: { info } } as unknown as FastifyRequest;
  return { request, info };
}

describe("access-token-transport (Paket AP)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("son tarih: 2026-11-06 + 45 gün (2026-12-21) — öncesi izinli, sonrası değil", () => {
    expect(LEGACY_TOKEN_IN_URL_UNTIL.toISOString()).toBe("2026-12-21T00:00:00.000Z");
    expect(isLegacyTokenTransportAllowed(new Date("2026-12-20T23:59:59.999Z"))).toBe(true);
    expect(isLegacyTokenTransportAllowed(new Date("2026-12-21T00:00:00.000Z"))).toBe(false);
  });

  it("X-Access-Token başlığı eski sorgudan önce gelir ve kırpılır; eski biçim sayılmaz", () => {
    const { request, info } = fakeRequest({ "x-access-token": "  HEADER-TOKEN  " });
    expect(readAccessToken(request, "QUERY-TOKEN")).toBe("HEADER-TOKEN");
    expect(info).not.toHaveBeenCalled();
  });

  it("aşırı uzun başlık okunmaz (eski biçime düşer)", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-10T00:00:00.000Z") });
    const { request } = fakeRequest({ "x-access-token": "x".repeat(513) });
    expect(readAccessToken(request, undefined)).toBeUndefined();
  });

  it("geçiş süresinde eski sorgu kabul edilir; aynı istekte ikinci okuma sayacı artırmaz; log'da token yok", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-10T00:00:00.000Z") });
    const { request, info } = fakeRequest();
    const before = legacyTokenTransportCount();
    expect(readAccessToken(request, "LEGACY-SECRET")).toBe("LEGACY-SECRET");
    expect(readAccessToken(request, "LEGACY-SECRET")).toBe("LEGACY-SECRET");
    expect(legacyTokenTransportCount()).toBe(before + 1);
    expect(info).toHaveBeenCalledTimes(1);
    const [obj, msg] = info.mock.calls[0]!;
    expect(msg).toBe("legacy_token_transport");
    expect(obj).toEqual({ legacy_token_transport: before + 1, route: "/api/v1/x/:id" });
    expect(JSON.stringify(info.mock.calls)).not.toContain("LEGACY-SECRET");
  });

  it("süre dolunca eski biçim (sorgu ve yol) `undefined` döner ve loglanmaz", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-12-21T00:00:01.000Z") });
    const a = fakeRequest();
    expect(readAccessToken(a.request, "LEGACY-SECRET")).toBeUndefined();
    const b = fakeRequest();
    expect(acceptLegacyToken(b.request, "PATH-SECRET")).toBeUndefined();
    expect(a.info).not.toHaveBeenCalled();
    expect(b.info).not.toHaveBeenCalled();
  });
});
