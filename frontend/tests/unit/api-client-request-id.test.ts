import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Kanıt (bkz. proje kökü CLAUDE.md § Kurallar — trace correlation): `lib/api/client.ts`
 * her isteğe bir `x-request-id` header'ı ekliyor mu, ve SADECE beklenmedik (5xx/ağ) hatalarında
 * Sentry'ye rapor ediyor mu (bilinen 4xx hatalarda GÜRÜLTÜ yapmıyor mu)?
 */
const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock("@sentry/nextjs", () => ({
  captureException: captureExceptionMock,
  setUser: vi.fn(),
  init: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

describe("lib/api/client — trace correlation & Sentry raporlama", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    captureExceptionMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("her isteğe bir x-request-id header'ı ekler", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }));

    const { apiFetch } = await import("@/lib/api/client");
    await apiFetch("/plans");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("5xx yanıtlarında Sentry.captureException'ı requestId tag'iyle çağırır", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "patladı" } }), { status: 500 })
    );

    const { apiFetch } = await import("@/lib/api/client");
    const { ApiClientError } = await import("@/lib/api/error");

    await expect(apiFetch("/plans")).rejects.toBeInstanceOf(ApiClientError);

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [, hint] = captureExceptionMock.mock.calls[0] as [Error, { tags: { requestId: string } }];
    expect(hint.tags.requestId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("bilinen 4xx hatalarında (ör. 422 validation) Sentry'ye HİÇ göndermez", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "geçersiz girdi" } }), {
        status: 422,
      })
    );

    const { apiFetch } = await import("@/lib/api/client");
    const { ApiClientError } = await import("@/lib/api/error");

    await expect(apiFetch("/plans")).rejects.toBeInstanceOf(ApiClientError);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("ApiClientError, backend log korelasyonu için requestId taşır", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "bulunamadı" } }), { status: 404 })
    );

    const { apiFetch } = await import("@/lib/api/client");
    const { ApiClientError } = await import("@/lib/api/error");

    try {
      await apiFetch("/plans");
      throw new Error("beklenen hata fırlatılmadı");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as InstanceType<typeof ApiClientError>).requestId).toMatch(/^[0-9a-f-]{36}$/i);
    }
  });
});
