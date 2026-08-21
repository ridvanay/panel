import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * `POST /api/revalidate` (bkz. `src/app/api/revalidate/route.ts`) — backend'in on-demand ISR
 * webhook'u (`backend/src/lib/revalidate.ts::triggerPublicPageRevalidation`) tarafından
 * çağrılır. frontend-agent bu ucu manuel `curl` ile doğrulamıştı, kalıcı bir test dosyası
 * BIRAKMAMIŞTI — qa-agent bunu kalıcı hale getirir.
 *
 * `next/cache`'in `revalidatePath()`'i yalnızca GERÇEK bir Next.js request/response yaşam
 * döngüsü İÇİNDE (route handler çağrısı sırasında Next sunucusu tarafından kurulan async
 * storage bağlamında) çalışır — vitest/jsdom altında doğrudan çağrılırsa Next'in dahili
 * "static generation store" bağlamı YOKTUR ve çağrı patlar/no-op olur. Bu yüzden `proxy-
 * maintenance-mode.test.ts`'teki `vi.stubGlobal("fetch", ...)` deseninin AYNISI burada
 * `next/cache` modülü için `vi.mock` ile uygulanır — asıl doğrulanan şey zaten route
 * handler'ın YETKİLENDİRME/DOĞRULAMA mantığı ve `revalidatePath`'in DOĞRU path'lerle
 * çağrılıp çağrılmadığı, `revalidatePath`'in kendi iç Next.js implementasyonu DEĞİL.
 */
const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePathMock(path),
}));

function makeRequest(headers: Record<string, string>, rawBody: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/revalidate", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

describe("POST /api/revalidate", () => {
  const originalSecret = process.env.REVALIDATE_SECRET;

  beforeEach(() => {
    process.env.REVALIDATE_SECRET = "test-shared-secret";
    revalidatePathMock.mockClear();
  });

  afterEach(() => {
    process.env.REVALIDATE_SECRET = originalSecret;
  });

  it("doğru secret + geçerli path(ler) -> 200 + revalidatePath HER path için sırayla çağrılır", async () => {
    const { POST } = await import("@/app/api/revalidate/route");
    const res = await POST(
      makeRequest(
        { "x-revalidate-secret": "test-shared-secret", "content-type": "application/json" },
        JSON.stringify({ paths: ["/tr", "/tr/hakkimizda"] })
      )
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revalidated: true, paths: ["/tr", "/tr/hakkimizda"] });
    expect(revalidatePathMock).toHaveBeenCalledTimes(2);
    expect(revalidatePathMock).toHaveBeenNthCalledWith(1, "/tr");
    expect(revalidatePathMock).toHaveBeenNthCalledWith(2, "/tr/hakkimizda");
  });

  it("`x-revalidate-secret` header'ı eksikse 401 döner, revalidatePath ÇAĞRILMAZ", async () => {
    const { POST } = await import("@/app/api/revalidate/route");
    const res = await POST(makeRequest({ "content-type": "application/json" }, JSON.stringify({ paths: ["/tr"] })));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("yanlış secret -> 401, revalidatePath ÇAĞRILMAZ", async () => {
    const { POST } = await import("@/app/api/revalidate/route");
    const res = await POST(
      makeRequest({ "x-revalidate-secret": "yanlis-sir", "content-type": "application/json" }, JSON.stringify({ paths: ["/tr"] }))
    );

    expect(res.status).toBe(401);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("farklı UZUNLUKTA bir secret de (timingSafeEqual uzunluk kısayolu) 401 ile reddedilir, throw ETMEZ", async () => {
    const { POST } = await import("@/app/api/revalidate/route");
    const res = await POST(
      makeRequest({ "x-revalidate-secret": "kisa", "content-type": "application/json" }, JSON.stringify({ paths: ["/tr"] }))
    );

    expect(res.status).toBe(401);
  });

  it("`REVALIDATE_SECRET` ortam değişkeni yapılandırılmamışsa (boş) fail-closed — 401 döner", async () => {
    process.env.REVALIDATE_SECRET = "";
    const { POST } = await import("@/app/api/revalidate/route");
    const res = await POST(
      makeRequest({ "x-revalidate-secret": "", "content-type": "application/json" }, JSON.stringify({ paths: ["/tr"] }))
    );

    expect(res.status).toBe(401);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("boş `paths` dizisi -> 400, revalidatePath ÇAĞRILMAZ", async () => {
    const { POST } = await import("@/app/api/revalidate/route");
    const res = await POST(
      makeRequest({ "x-revalidate-secret": "test-shared-secret", "content-type": "application/json" }, JSON.stringify({ paths: [] }))
    );

    expect(res.status).toBe(400);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("'/' ile BAŞLAMAYAN bir path -> 400", async () => {
    const { POST } = await import("@/app/api/revalidate/route");
    const res = await POST(
      makeRequest(
        { "x-revalidate-secret": "test-shared-secret", "content-type": "application/json" },
        JSON.stringify({ paths: ["tr/hakkimizda"] })
      )
    );

    expect(res.status).toBe(400);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("bir dizi içindeki path'lerden BİRİ geçersizse (karışık dizi) TÜMÜ reddedilir (400), hiçbiri revalidate edilmez", async () => {
    const { POST } = await import("@/app/api/revalidate/route");
    const res = await POST(
      makeRequest(
        { "x-revalidate-secret": "test-shared-secret", "content-type": "application/json" },
        JSON.stringify({ paths: ["/tr", "gecersiz-path"] })
      )
    );

    expect(res.status).toBe(400);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("`paths` alanı eksik/yanlış tipteyse -> 400", async () => {
    const { POST } = await import("@/app/api/revalidate/route");
    const res = await POST(
      makeRequest({ "x-revalidate-secret": "test-shared-secret", "content-type": "application/json" }, JSON.stringify({}))
    );

    expect(res.status).toBe(400);
  });

  it("bozuk (malformed) JSON gövdesi -> 400", async () => {
    const { POST } = await import("@/app/api/revalidate/route");
    const res = await POST(makeRequest({ "x-revalidate-secret": "test-shared-secret", "content-type": "application/json" }, "{ bozuk-json"));

    expect(res.status).toBe(400);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
