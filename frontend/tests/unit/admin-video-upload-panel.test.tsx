import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { Media } from "@/lib/api/types";
import { UPLOAD_ABORTED } from "@/lib/api/upload";
import { ApiClientError } from "@/lib/api/error";

/** Paket AE — MP4 yükleme paneli: ilerleme, iptal, uyarılar, poster karesi, kaydet gövdesi. */
const { api, capture, toastMock } = vi.hoisted(() => ({
  api: { uploadVideo: vi.fn(), uploadCaptions: vi.fn(), uploadMedia: vi.fn() },
  capture: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/api/media", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/media")>("@/lib/api/media");
  return { ...actual, ...api };
});
vi.mock("@/lib/video-upload", async () => {
  const actual = await vi.importActual<typeof import("@/lib/video-upload")>("@/lib/video-upload");
  return { ...actual, captureVideoFrame: capture };
});
vi.mock("@/components/admin/media/media-select-field", () => ({ MediaSelectField: () => <div data-testid="media-select" /> }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { VideoUploadPanel, type VideoUploadValue } from "@/components/admin/telehealth/video-upload-panel";
import { buildMediaInput, type MediaFormState } from "@/components/admin/telehealth/doctor-media-manager";

const mk = (over: Partial<Media>): Media => ({
  id: "m", url: "https://x/uploads/m", filename: "f", mimeType: "image/jpeg", sizeBytes: 5 * 1024 * 1024, altText: null, width: null, height: null, folderId: null, createdAt: "2026-01-01T00:00:00Z", ...over,
});
const videoMedia = mk({ id: "vid-1", filename: "röportaj.mp4", mimeType: "video/mp4" });

function Harness({ initial, onValue }: { initial?: Partial<VideoUploadValue>; onValue?: (v: VideoUploadValue) => void }) {
  const [value, setValue] = useState<VideoUploadValue>({ video: null, info: null, poster: null, captions: null, captionsLang: "tr", ...initial });
  onValue?.(value);
  return <VideoUploadPanel value={value} onChange={(p) => setValue((v) => ({ ...v, ...p }))} maxVideoMb={100} />;
}

const mp4 = () => new File(["x"], "röportaj.mp4", { type: "video/mp4" });

beforeEach(() => {
  vi.clearAllMocks();
  capture.mockResolvedValue({ blob: new Blob(["jpg"], { type: "image/jpeg" }), seconds: 1, duration: 12.4 });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:frame");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

describe("VideoUploadPanel", () => {
  it("ilerleme yüzdesi/MB gösterir ve İptal xhr iptalini (AbortSignal) tetikler", async () => {
    const user = userEvent.setup();
    let signal: AbortSignal | undefined;
    let progressCb: ((p: { loaded: number; total: number; percent: number }) => void) | undefined;
    api.uploadVideo.mockImplementation(
      (_f: File, opts: { signal: AbortSignal; onProgress: typeof progressCb }) =>
        new Promise((_res, rej) => {
          signal = opts.signal;
          progressCb = opts.onProgress;
          opts.signal.addEventListener("abort", () => rej(new ApiClientError(0, { code: UPLOAD_ABORTED as never, message: "Yükleme iptal edildi." })));
        }),
    );
    render(<Harness />);
    await user.upload(screen.getByLabelText("Bilgisayardan MP4 video yükle"), mp4());

    act(() => progressCb?.({ loaded: 2 * 1024 * 1024, total: 8 * 1024 * 1024, percent: 25 }));
    const bar = await screen.findByRole("progressbar", { name: "Video yükleme ilerlemesi" });
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText(/%25 · 2\.0 MB \/ 8\.0 MB/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "İptal" }));
    expect(signal?.aborted).toBe(true);
    expect(await screen.findByText("Yükleme iptal edildi.")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("istemci ön kontrolü: MP4 olmayan dosya sunucuya gitmeden reddedilir", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<Harness />);
    await user.upload(screen.getByLabelText("Bilgisayardan MP4 video yükle"), new File(["x"], "a.mov", { type: "video/quicktime" }));
    expect(await screen.findByText("Yalnızca MP4 video yükleyebilirsiniz.")).toBeInTheDocument();
    expect(api.uploadVideo).not.toHaveBeenCalled();
  });

  it("sunucu uyarılarını (HEVC_CODEC, MOOV_AT_END) sarı kutuda aynen gösterir; yükleme yine kabul edilir", async () => {
    const user = userEvent.setup();
    const warnings = [
      { code: "HEVC_CODEC", message: "Bu video iPhone'un HEVC biçiminde. (sunucu metni)" },
      { code: "MOOV_AT_END", message: "Video akışlı oynatma için optimize değil, yüklenmesi yavaş olabilir." },
    ];
    api.uploadVideo.mockResolvedValue({ media: videoMedia, video: { codec: "hvc1", faststart: false, durationSec: 12.4 }, warnings });
    render(<Harness />);
    await user.upload(screen.getByLabelText("Bilgisayardan MP4 video yükle"), mp4());

    const list = await screen.findByTestId("video-warnings");
    expect(list).toHaveTextContent("Bu video iPhone'un HEVC biçiminde. (sunucu metni)");
    expect(list).toHaveTextContent("Video akışlı oynatma için optimize değil, yüklenmesi yavaş olabilir.");
    expect(screen.getByText("röportaj.mp4")).toBeInTheDocument();
  });

  it("1. saniyeden kare yakalar, önizler ve 'Bu kareyi kullan' JPEG'i /admin/media ile yükleyip poster yapar", async () => {
    const user = userEvent.setup();
    api.uploadVideo.mockResolvedValue({ media: videoMedia, video: { codec: "avc1", faststart: true, durationSec: 12.4 }, warnings: [] });
    const poster = mk({ id: "poster-1", filename: "poster-1s.jpg" });
    api.uploadMedia.mockResolvedValue(poster);
    let latest: VideoUploadValue | undefined;
    render(<Harness onValue={(v) => (latest = v)} />);
    await user.upload(screen.getByLabelText("Bilgisayardan MP4 video yükle"), mp4());

    expect(await screen.findByAltText("Videodan yakalanan kare önizlemesi")).toBeInTheDocument();
    expect(capture).toHaveBeenCalledWith(expect.any(File), 1);

    await user.click(screen.getByRole("button", { name: "Bu kareyi kullan" }));
    await waitFor(() => expect(latest?.poster?.id).toBe("poster-1"));
    const [file, folder] = api.uploadMedia.mock.calls[0];
    expect(file).toBeInstanceOf(File);
    expect((file as File).type).toBe("image/jpeg");
    expect(folder).toBeNull();
  });

  it("kare yakalanamazsa (ör. HEVC) anlaşılır mesaj ve özel poster seçeneği gösterir", async () => {
    const user = userEvent.setup();
    capture.mockRejectedValue(new Error("x"));
    api.uploadVideo.mockResolvedValue({ media: videoMedia, video: { codec: "hvc1", faststart: true, durationSec: null }, warnings: [] });
    render(<Harness />);
    await user.upload(screen.getByLabelText("Bilgisayardan MP4 video yükle"), mp4());
    expect(await screen.findByText(/kare yakalayamadı/)).toBeInTheDocument();
    expect(screen.getByTestId("media-select")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bu kareyi kullan" })).toBeDisabled();
  });

  it("altyazı (.vtt) yüklenir ve dil seçimi görünür", async () => {
    const user = userEvent.setup({ applyAccept: false });
    api.uploadCaptions.mockResolvedValue(mk({ id: "cap-1", filename: "tr.vtt", mimeType: "text/vtt" }));
    render(<Harness />);
    await user.upload(screen.getByLabelText("Altyazı (.vtt) yükle"), new File(["WEBVTT"], "tr.vtt", { type: "text/vtt" }));
    expect(await screen.findByLabelText("Altyazı dili")).toBeInTheDocument();
    expect(screen.getByText("tr.vtt")).toBeInTheDocument();
  });
});

describe("buildMediaInput — upload videosu (sözleşme §1)", () => {
  const base: MediaFormState = {
    id: null, kind: "video", photo: null, videoProvider: "youtube", videoInput: "", videoSource: "upload",
    upload: { video: videoMedia, info: { codec: "avc1", faststart: true, durationSec: 12.4 }, poster: mk({ id: "poster-1" }), captions: mk({ id: "cap-1", mimeType: "text/vtt" }), captionsLang: "de" },
    category: "about", translations: {}, showsPatient: false, patientConsentConfirmed: false, consentNote: "", isPublished: false, sortOrder: 2,
  };

  it("videoProvider upload, mediaId video id'si, videoId null, poster/altyazı alanları", () => {
    const { input, errors } = buildMediaInput(base);
    expect(errors).toEqual({});
    expect(input).toMatchObject({
      kind: "video", videoProvider: "upload", mediaId: "vid-1", videoId: null,
      posterMediaId: "poster-1", captionsMediaId: "cap-1", captionsLang: "de",
    });
  });

  it("altyazı yoksa captionsMediaId/captionsLang null; poster yoksa null", () => {
    const { input } = buildMediaInput({ ...base, upload: { ...base.upload, poster: null, captions: null } });
    expect(input).toMatchObject({ posterMediaId: null, captionsMediaId: null, captionsLang: null });
  });

  it("video yüklenmediyse hata verir; bağlantı modunda poster alanları gövdede yok", () => {
    expect(buildMediaInput({ ...base, upload: { ...base.upload, video: null } }).errors.mediaId).toBeTruthy();
    const link = buildMediaInput({ ...base, videoSource: "link", videoInput: "https://youtu.be/dQw4w9WgXcQ" });
    expect(link.input).toMatchObject({ videoProvider: "youtube", videoId: "dQw4w9WgXcQ", mediaId: null });
    expect(link.input).not.toHaveProperty("posterMediaId");
  });
});
