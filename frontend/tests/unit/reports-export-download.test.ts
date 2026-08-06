import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `downloadExportJob` — bkz. `lib/api/reports.ts`. Yanıt JSON DEĞİL (dosya stream) olduğu için
 * `apiFetch` KULLANILMAZ; bu test doğrudan `fetch`'i mock'layarak Authorization header'ının
 * eklendiğini, başarılı yanıtta `URL.createObjectURL` + `<a download>` akışının tetiklendiğini
 * ve HATA yanıtında backend `{error: {code, message}}` zarfının `ApiClientError`'a doğru
 * aktarıldığını doğrular (qa-agent — `users-admin-export.test.ts` ile AYNI mock deseni).
 */
describe("downloadExportJob", () => {
  const fetchMock = vi.fn();
  const createObjectURLMock = vi.fn(() => "blob:mock-url");
  const revokeObjectURLMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: createObjectURLMock, revokeObjectURL: revokeObjectURLMock }));
    fetchMock.mockReset();
    createObjectURLMock.mockClear();
    revokeObjectURLMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("başarılı yanıtta blob'u indirir ve geçici bir <a download> elemanı ile tetikler", async () => {
    const blob = new Blob(["id,views\n1,10\n"], { type: "text/csv" });
    fetchMock.mockResolvedValueOnce(new Response(blob, { status: 200 }));

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const { downloadExportJob } = await import("@/lib/api/reports");
    await downloadExportJob({ id: "job-1", type: "VIEWS", format: "CSV" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/admin/reports/exports/job-1/download");
    expect(init?.credentials).toBe("include");

    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:mock-url");

    clickSpy.mockRestore();
  });

  it("hata yanıtında backend {error} zarfını ApiClientError'a aktarır (jenerik mesaj GÖSTERMEZ)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "CONFLICT", message: "Rapor henüz hazır değil." } }), { status: 409 })
    );

    const { downloadExportJob } = await import("@/lib/api/reports");
    const { ApiClientError } = await import("@/lib/api/error");

    await expect(downloadExportJob({ id: "job-2", type: "VIEWS", format: "CSV" })).rejects.toMatchObject({
      message: "Rapor henüz hazır değil.",
      status: 409,
      code: "CONFLICT",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "CONFLICT", message: "Rapor henüz hazır değil." } }), { status: 409 })
    );
    await expect(downloadExportJob({ id: "job-2", type: "VIEWS", format: "CSV" })).rejects.toBeInstanceOf(ApiClientError);
  });

  it("ağ hatasında NETWORK_ERROR koduyla ApiClientError fırlatır", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network down"));

    const { downloadExportJob } = await import("@/lib/api/reports");

    await expect(downloadExportJob({ id: "job-3", type: "VIEWS", format: "CSV" })).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });
});
