import { afterEach, describe, expect, it, vi } from "vitest";
import { createInternalClientResolver, normalizeAddress, type InternalClientResolver } from "../../src/lib/internal-clients";

const log = { info: vi.fn(), warn: vi.fn() };
let resolver: InternalClientResolver | null = null;

function build(url: string | undefined, resolve4: (host: string) => Promise<string[]>, resolve6?: (host: string) => Promise<string[]>) {
  resolver = createInternalClientResolver(url, log, {
    resolve4,
    resolve6: resolve6 ?? (async () => { throw new Error("ENODATA"); }),
  });
  return resolver;
}

afterEach(() => {
  resolver?.close();
  resolver = null;
  vi.clearAllMocks();
});

describe("normalizeAddress", () => {
  it("IPv4-mapped IPv6 adresini düz IPv4'e çevirir", () => {
    expect(normalizeAddress("::ffff:172.19.0.4")).toBe("172.19.0.4");
    expect(normalizeAddress("172.19.0.4")).toBe("172.19.0.4");
    expect(normalizeAddress("FD00::1")).toBe("fd00::1");
    expect(normalizeAddress(undefined)).toBeNull();
  });
});

describe("createInternalClientResolver", () => {
  it("INTERNAL_FRONTEND_URL host'unun DNS çözümüyle eşleşen soket adresini iç sayar", async () => {
    const resolve4 = vi.fn(async () => ["172.19.0.4"]);
    const r = build("http://frontend:3000", resolve4);
    await r.refresh();
    expect(resolve4).toHaveBeenCalledWith("frontend");
    expect(r.isInternal("172.19.0.4")).toBe(true);
    expect(r.isInternal("::ffff:172.19.0.4")).toBe(true);
    // Nginx (Docker gateway) ve dış istemciler iç sayılmaz
    expect(r.isInternal("172.19.0.1")).toBe(false);
    expect(r.isInternal("203.0.113.9")).toBe(false);
    expect(r.isInternal(undefined)).toBe(false);
  });

  it("konteyner yeniden oluşturulup IP değişince tazelemeden sonra yeni IP geçerli, eskisi değil", async () => {
    let current = ["172.19.0.4"];
    const r = build("http://frontend:3000", async () => current);
    await r.refresh();
    current = ["172.19.0.9"];
    await r.refresh();
    expect(r.isInternal("172.19.0.9")).toBe(true);
    expect(r.isInternal("172.19.0.4")).toBe(false);
  });

  it("ilk açılışta çözümlenemezse (frontend henüz başlamadı) uyarı değil bilgi loglanır", async () => {
    const r = build("http://frontend:3000", async () => { throw new Error("ENOTFOUND"); });
    await r.refresh();
    expect(r.isInternal("172.19.0.4")).toBe(false);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledTimes(1);
  });

  it("adres yokken kısa aralıkla yeniden dener, bulununca normal aralığa döner", async () => {
    vi.useFakeTimers();
    let ready = false;
    const resolve4 = vi.fn(async () => {
      if (!ready) throw new Error("ENOTFOUND");
      return ["172.19.0.4"];
    });
    resolver = createInternalClientResolver("http://frontend:3000", log, { resolve4, resolve6: async () => [], refreshMs: 30_000, retryMs: 5_000 });
    await resolver.refresh();
    ready = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(resolver.isInternal("172.19.0.4")).toBe(true);
    const calls = resolve4.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(resolve4.mock.calls.length).toBe(calls);
    vi.useRealTimers();
  });

  it("fail-closed: çözümlenmiş adres kaybolursa kimse iç sayılmaz ve bir kez uyarı loglanır", async () => {
    let fail = false;
    const r = build("http://frontend:3000", async () => {
      if (fail) throw new Error("ENOTFOUND");
      return ["172.19.0.4"];
    });
    await r.refresh();
    fail = true;
    await r.refresh();
    await r.refresh();
    expect(r.isInternal("172.19.0.4")).toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("değişken yoksa veya host localhost ise devre dışı (DNS sorgusu yapılmaz)", async () => {
    const resolve4 = vi.fn(async () => ["127.0.0.1"]);
    for (const url of [undefined, "http://localhost:3000", "not a url"]) {
      const r = build(url, resolve4);
      await r.refresh();
      expect(r.isInternal("127.0.0.1")).toBe(false);
      r.close();
    }
    expect(resolve4).not.toHaveBeenCalled();
  });

  it("host bir IP ise DNS'e gitmeden o adres kullanılır; IPv6 çözümü de dahil edilir", async () => {
    const resolve4 = vi.fn(async () => []);
    const literal = build("http://10.0.0.5:3000", resolve4);
    await literal.refresh();
    expect(literal.isInternal("10.0.0.5")).toBe(true);
    expect(resolve4).not.toHaveBeenCalled();
    literal.close();

    const dual = build("http://frontend:3000", async () => ["172.19.0.4"], async () => ["fd00::4"]);
    await dual.refresh();
    expect(dual.isInternal("fd00::4")).toBe(true);
  });
});
