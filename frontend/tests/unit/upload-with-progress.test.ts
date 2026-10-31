import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/error";
import { isUploadAborted, uploadWithProgress } from "@/lib/api/upload";
import { setAccessToken, clearAccessToken } from "@/lib/api/token-store";

/** Paket AE — XHR tabanlı yükleme: ilerleme, iptal, hata gövdesi, kimlik bilgileri. */
class FakeXHR {
  static instances: FakeXHR[] = [];
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  withCredentials = false;
  status = 0;
  responseText = "";
  headers: Record<string, string> = {};
  method = "";
  url = "";
  body: unknown = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;
  constructor() {
    FakeXHR.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  respond(status: number, json: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(json);
    this.onload?.();
  }
}

beforeEach(() => {
  FakeXHR.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  setAccessToken("tok-123");
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearAccessToken();
});

describe("uploadWithProgress", () => {
  it("apiFetch ile aynı kimlik bilgilerini gönderir ve ilerleme yüzdesini bildirir", async () => {
    const onProgress = vi.fn();
    const file = new File(["abc"], "a.mp4", { type: "video/mp4" });
    const promise = uploadWithProgress<{ ok: boolean }>("/admin/media/video", file, { onProgress });
    const xhr = FakeXHR.instances[0];
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toContain("/admin/media/video");
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.headers.Authorization).toBe("Bearer tok-123");
    expect(xhr.headers["x-request-id"]).toBeTruthy();
    expect((xhr.body as FormData).get("file")).toBeInstanceOf(File);

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
    expect(onProgress).toHaveBeenNthCalledWith(1, { loaded: 25, total: 100, percent: 25 });
    expect(onProgress).toHaveBeenNthCalledWith(2, { loaded: 100, total: 100, percent: 100 });

    xhr.respond(201, { data: { ok: true }, meta: { x: 1 } });
    await expect(promise).resolves.toEqual({ data: { ok: true }, meta: { x: 1 } });
  });

  it("AbortSignal ile iptal edilir: xhr.abort çağrılır ve UPLOAD_ABORTED ile reddedilir", async () => {
    const controller = new AbortController();
    const promise = uploadWithProgress("/admin/media/video", new File(["a"], "a.mp4"), { signal: controller.signal });
    const caught = promise.catch((e) => e);
    controller.abort();
    const err = await caught;
    expect(FakeXHR.instances[0].aborted).toBe(true);
    expect(isUploadAborted(err)).toBe(true);
  });

  it("sunucu hata gövdesini aynen ApiClientError olarak fırlatır (413)", async () => {
    const promise = uploadWithProgress("/admin/media/video", new File(["a"], "a.mp4"));
    const caught = promise.catch((e) => e);
    FakeXHR.instances[0].respond(413, { error: { code: "PAYLOAD_TOO_LARGE", message: "Video en fazla 100 MB olabilir." } });
    const err = await caught;
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.status).toBe(413);
    expect(err.message).toBe("Video en fazla 100 MB olabilir.");
    expect(isUploadAborted(err)).toBe(false);
  });
});
