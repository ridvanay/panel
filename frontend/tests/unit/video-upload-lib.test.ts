import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FRAME_CAPTURE_FAILED_MESSAGE,
  FrameCaptureError,
  HEVC_WARNING_MESSAGE,
  captureVideoFrame,
  validateCaptionsFile,
  validateMaxVideoMb,
  validateVideoFile,
  warningsFromVideoInfo,
} from "@/lib/video-upload";

describe("validateVideoFile", () => {
  it("MP4 ve MOV'u, azami boyuta kadar kabul eder", () => {
    expect(validateVideoFile({ name: "a.mp4", type: "video/mp4", size: 1024 }, 100)).toBeNull();
    expect(validateVideoFile({ name: "a.mp4", type: "", size: 1024 }, 100)).toBeNull();
    expect(validateVideoFile({ name: "a.mov", type: "video/quicktime", size: 1024 }, 100)).toBeNull();
    expect(validateVideoFile({ name: "IMG_1.MOV", type: "", size: 1024 }, 100)).toBeNull();
    expect(validateVideoFile({ name: "a.mp4", type: "video/webm", size: 1024 }, 100)).toMatch(/MP4 ya da MOV/);
    expect(validateVideoFile({ name: "a.avi", type: "", size: 1024 }, 100)).toMatch(/MP4 ya da MOV/);
    expect(validateVideoFile({ name: "a.mp4", type: "video/mp4", size: 101 * 1024 * 1024 }, 100)).toMatch(/en fazla 100 MB/);
  });
  it("altyazı: .vtt ve 512 KB sınırı", () => {
    expect(validateCaptionsFile({ name: "a.vtt", size: 100 })).toBeNull();
    expect(validateCaptionsFile({ name: "a.srt", size: 100 })).toMatch(/\.vtt/);
    expect(validateCaptionsFile({ name: "a.vtt", size: 600 * 1024 })).toMatch(/512 KB/);
  });
});

describe("validateMaxVideoMb", () => {
  it("1–500 arası tam sayı", () => {
    expect(validateMaxVideoMb(100)).toBeNull();
    expect(validateMaxVideoMb(1)).toBeNull();
    expect(validateMaxVideoMb(500)).toBeNull();
    expect(validateMaxVideoMb(0)).toBeTruthy();
    expect(validateMaxVideoMb(501)).toBeTruthy();
    expect(validateMaxVideoMb(10.5)).toBeTruthy();
    expect(validateMaxVideoMb(NaN)).toBeTruthy();
  });
});

describe("warningsFromVideoInfo", () => {
  it("HEVC ve moov-sonda için uyarı üretir", () => {
    const w = warningsFromVideoInfo({ codec: "hvc1", faststart: false });
    expect(w.map((x) => x.code)).toEqual(["HEVC_CODEC", "MOOV_AT_END"]);
    expect(w[0].message).toBe(HEVC_WARNING_MESSAGE);
    expect(warningsFromVideoInfo({ codec: "avc1", faststart: true })).toEqual([]);
    expect(warningsFromVideoInfo(null)).toEqual([]);
  });
});

describe("captureVideoFrame (sahte video + canvas)", () => {
  let video: Record<string, unknown>;
  let toBlobImpl: (cb: (b: Blob | null) => void, type?: string, q?: number) => void;
  const drawImage = vi.fn();
  const realCreate = document.createElement.bind(document);

  beforeEach(() => {
    drawImage.mockClear();
    video = { duration: 10, videoWidth: 640, videoHeight: 360, removeAttribute: vi.fn(), load: vi.fn() };
    toBlobImpl = (cb) => cb(new Blob(["jpg"], { type: "image/jpeg" }));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      if (tag === "video") {
        // `src` atanınca metadata + seek olaylarını sahte olarak tetikler.
        Object.defineProperty(video, "src", {
          configurable: true,
          set: () => queueMicrotask(() => (video.onloadedmetadata as () => void)()),
        });
        Object.defineProperty(video, "currentTime", {
          configurable: true,
          set: (v: number) => {
            video.seekedTo = v;
            queueMicrotask(() => (video.onseeked as () => void)());
          },
        });
        return video as unknown as HTMLVideoElement;
      }
      if (tag === "canvas") {
        return { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob: (cb: (b: Blob | null) => void, t?: string, q?: number) => toBlobImpl(cb, t, q) } as unknown as HTMLCanvasElement;
      }
      return realCreate(tag);
    }) as typeof document.createElement);
  });
  afterEach(() => vi.restoreAllMocks());

  it("istenen saniyedeki kareyi JPEG olarak yakalar", async () => {
    const spy = vi.fn(toBlobImpl);
    toBlobImpl = spy;
    const frame = await captureVideoFrame(new Blob(["x"]), 3);
    expect(video.seekedTo).toBe(3);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 640, 360);
    expect(spy.mock.calls[0][1]).toBe("image/jpeg");
    expect(spy.mock.calls[0][2]).toBe(0.85);
    expect(frame.blob.type).toBe("image/jpeg");
    expect(frame.duration).toBe(10);
    expect(frame.seconds).toBe(3);
  });

  it("saniyeyi video süresiyle sınırlar", async () => {
    const frame = await captureVideoFrame(new Blob(["x"]), 99);
    expect(frame.seconds).toBeLessThan(10);
    expect(frame.seconds).toBeGreaterThan(9);
  });

  it("kare alınamazsa (toBlob null) anlaşılır hata fırlatır", async () => {
    toBlobImpl = (cb) => cb(null);
    const err = await captureVideoFrame(new Blob(["x"]), 1).catch((e) => e);
    expect(err).toBeInstanceOf(FrameCaptureError);
    expect(err.message).toBe(FRAME_CAPTURE_FAILED_MESSAGE);
  });

  it("tarayıcı videoyu çözemezse (onerror) hata fırlatır", async () => {
    vi.mocked(document.createElement).mockImplementation(((tag: string) => {
      if (tag === "video") {
        Object.defineProperty(video, "src", { configurable: true, set: () => queueMicrotask(() => (video.onerror as () => void)()) });
        return video as unknown as HTMLVideoElement;
      }
      return realCreate(tag);
    }) as typeof document.createElement);
    await expect(captureVideoFrame(new Blob(["x"]), 1)).rejects.toBeInstanceOf(FrameCaptureError);
  });
});
