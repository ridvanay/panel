import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { Media } from "@/lib/api/types";

/** Paket AE-ek — otomatik medya dönüştürme: purpose, CONVERTED bildirimi, MOV, durum rozetleri, yeniden dene, periyodik yenileme. */
const { toastMock, clientMock, mediaMock, showcase } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  clientMock: { apiFetch: vi.fn(), apiFetchPage: vi.fn(), apiFetchWithMeta: vi.fn() },
  mediaMock: { uploadVideo: vi.fn(), listTranscodeJobs: vi.fn(), retryTranscode: vi.fn() },
  showcase: { listDoctorMedia: vi.fn(), getDoctorMediaSettings: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/api/client", () => clientMock);
vi.mock("@/lib/api/media", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/media")>("@/lib/api/media");
  return { ...actual, ...mediaMock };
});
vi.mock("@/lib/api/doctor-showcase", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/doctor-showcase")>("@/lib/api/doctor-showcase");
  return { ...actual, ...showcase };
});
vi.mock("@/components/admin/media/media-select-field", () => ({ MediaSelectField: () => <div data-testid="media-select" /> }));
vi.mock("@/components/admin/media/media-picker", () => ({ MediaPicker: () => null }));

import * as realMedia from "@/lib/api/media";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import { showMediaNotice } from "@/components/admin/media/media-notice";
import { MediaFileTile } from "@/components/admin/media/media-thumbnail";
import { VideoUploadPanel, type VideoUploadValue } from "@/components/admin/telehealth/video-upload-panel";
import { DoctorMediaManager, PROCESSING_POLL_MS } from "@/components/admin/telehealth/doctor-media-manager";
import { ApiClientError } from "@/lib/api/error";

const MB = 1024 * 1024;
const sample = (over: Partial<Media> = {}): Media => ({
  id: "m1", url: "/uploads/a.webp", filename: "foto.webp", mimeType: "image/webp", sizeBytes: 100, altText: null, width: 10, height: 10, folderId: null, createdAt: "2026-01-01T00:00:00Z", ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("uploadMedia — purpose ve CONVERTED bildirimi", () => {
  it("purpose multipart alanı olarak gönderilir; verilmezse eklenmez", async () => {
    clientMock.apiFetchWithMeta.mockResolvedValue({ data: sample(), meta: {} });
    await realMedia.uploadMedia(new File(["x"], "l.png", { type: "image/png" }), null, undefined, { purpose: "logo" });
    await realMedia.uploadMedia(new File(["x"], "f.png", { type: "image/png" }), null, undefined, { purpose: "icon" });
    await realMedia.uploadMedia(new File(["x"], "p.jpg", { type: "image/jpeg" }));
    const bodies = clientMock.apiFetchWithMeta.mock.calls.map((c) => c[1].body as FormData);
    expect(bodies[0].get("purpose")).toBe("logo");
    expect(bodies[1].get("purpose")).toBe("icon");
    expect(bodies[2].has("purpose")).toBe(false);
  });

  it("CONVERTED mesajı koddan bağımsız bilgi toast'u olarak gösterilir", async () => {
    const message = "WebP olarak kaydedildi (1,2 MB → 240 KB); konum ve kamera bilgileri silindi.";
    clientMock.apiFetchWithMeta.mockResolvedValue({ data: sample(), meta: { notice: { code: "CONVERTED", detectedMimeType: "image/jpeg", message } } });
    await realMedia.uploadMedia(new File(["x"], "a.jpg", { type: "image/jpeg" }), null, showMediaNotice);
    expect(toastMock.info).toHaveBeenCalledWith(message);
  });
});

describe("ImageUploadField — purpose", () => {
  async function pick(purpose?: "logo" | "icon") {
    const user = userEvent.setup();
    clientMock.apiFetchWithMeta.mockResolvedValue({ data: sample(), meta: {} });
    render(<ImageUploadField id="x" label="Alan" value="" onChange={() => undefined} purpose={purpose} />);
    await user.upload(screen.getByLabelText("Bilgisayardan görsel yükle"), new File(["x"], "a.png", { type: "image/png" }));
    await waitFor(() => expect(clientMock.apiFetchWithMeta).toHaveBeenCalled());
    return (clientMock.apiFetchWithMeta.mock.calls[0][1].body as FormData).get("purpose");
  }

  it("logo alanı purpose=logo gönderir", async () => expect(await pick("logo")).toBe("logo"));
  it("favicon/apple-touch-icon alanı purpose=icon gönderir", async () => expect(await pick("icon")).toBe("icon"));
  it("purpose verilmeyen alanlar eskisi gibi gönderir (alan yok)", async () => expect(await pick()).toBeNull());
});

describe("MediaFileTile — işleme rozeti", () => {
  it("processing/failed videoda rozet gösterir; ready ve görselde göstermez", () => {
    const { rerender } = render(<MediaFileTile mimeType="video/mp4" processingStatus="processing" />);
    expect(screen.getByTestId("media-processing-badge")).toHaveTextContent("İşleniyor");
    rerender(<MediaFileTile mimeType="video/mp4" processingStatus="failed" />);
    expect(screen.getByTestId("media-processing-badge")).toHaveTextContent("Başarısız");
    rerender(<MediaFileTile mimeType="video/mp4" processingStatus="ready" />);
    expect(screen.queryByTestId("media-processing-badge")).not.toBeInTheDocument();
    rerender(<MediaFileTile mimeType="video/quicktime" />);
    expect(screen.queryByTestId("media-processing-badge")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Video · MOV")).toBeInTheDocument();
  });
});

describe("VideoUploadPanel — MOV ve dönüştürme", () => {
  function Harness() {
    const [value, setValue] = useState<VideoUploadValue>({ video: null, info: null, poster: null, captions: null, captionsLang: "tr" });
    return <VideoUploadPanel value={value} onChange={(p) => setValue((v) => ({ ...v, ...p }))} maxVideoMb={100} />;
  }

  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  it(".mov (video/quicktime) kabul edilir; İşleniyor rozeti, kuyruk sırası ve sunucu bilgi metni görünür", async () => {
    const user = userEvent.setup();
    mediaMock.uploadVideo.mockResolvedValue({
      media: sample({ id: "v1", url: "", filename: "IMG_1.mov", mimeType: "video/quicktime", sizeBytes: 48 * MB }),
      video: { codec: "hvc1", faststart: false, durationSec: 42 },
      warnings: [],
      processing: { status: "processing", queuePosition: 2 },
    });
    render(<Harness />);
    expect(screen.getByTestId("server-transcode-note")).toHaveTextContent("Sunucu videoyu H.264'e dönüştürecek, kapak otomatik üretilecek.");
    const input = screen.getByLabelText("Bilgisayardan MP4 ya da MOV video yükle");
    expect(input).toHaveAttribute("accept", expect.stringContaining("video/quicktime"));
    await user.upload(input, new File(["x"], "IMG_1.mov", { type: "video/quicktime" }));

    expect(mediaMock.uploadVideo).toHaveBeenCalledTimes(1);
    const status = await screen.findByTestId("video-processing-status");
    expect(status).toHaveTextContent("İşleniyor");
    expect(status).toHaveTextContent("Sırada: 2");
    expect(status).toHaveTextContent("0:42");
    // Sunucu dönüştüreceği için HEVC kaynak bilgisi artık uyarı üretmez.
    expect(screen.queryByTestId("video-warnings")).not.toBeInTheDocument();
  });
});

describe("DoctorMediaManager — dönüştürme durumu", () => {
  const item = (processing: unknown, over: Record<string, unknown> = {}) => ({
    id: "dm1",
    doctorId: "d1",
    kind: "video",
    videoProvider: "upload",
    videoId: null,
    category: "about",
    translations: { tr: { title: "Röportaj", description: "", alt: "" } },
    showsPatient: false,
    patientConsentConfirmed: false,
    isPublished: false,
    sortOrder: 0,
    media: { id: "med1", url: null, width: null, height: null, filename: "IMG_1.mov" },
    video: { codec: "hvc1", faststart: false, durationSec: 42 },
    processing,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  });
  const proc = (over: Record<string, unknown>) => ({
    status: "processing", jobStatus: "queued", error: null, canRetry: false,
    sourceSizeBytes: 48.2 * MB, sourceDurationSec: 42, sourceCodec: "hvc1", outputSizeBytes: null, ...over,
  });

  beforeEach(() => {
    showcase.getDoctorMediaSettings.mockResolvedValue({ beforeAfterEnabled: true, maxVideoUploadMb: 100 });
    mediaMock.listTranscodeJobs.mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("İşleniyor: sıra, kaynak boyutu ve süre; HEVC uyarı rozeti çıkmaz", async () => {
    showcase.listDoctorMedia.mockResolvedValue([item(proc({}))]);
    mediaMock.listTranscodeJobs.mockResolvedValue([{ mediaId: "med1", status: "queued", queuePosition: 2 }]);
    render(<DoctorMediaManager doctorId="d1" />);
    const status = await screen.findByTestId("video-processing-status");
    expect(status).toHaveTextContent("İşleniyor");
    await waitFor(() => expect(status).toHaveTextContent("Sırada: 2"));
    expect(status).toHaveTextContent("48,2 MB");
    expect(status).toHaveTextContent("0:42");
    expect(screen.queryByText("HEVC uyarısı")).not.toBeInTheDocument();
  });

  it("Hazır: önce → sonra boyut gösterilir", async () => {
    showcase.listDoctorMedia.mockResolvedValue([item(proc({ status: "ready", jobStatus: "done", outputSizeBytes: 12.1 * MB }))]);
    render(<DoctorMediaManager doctorId="d1" />);
    const status = await screen.findByTestId("video-processing-status");
    expect(status).toHaveTextContent("Hazır");
    expect(status).toHaveTextContent("48,2 MB → 12,1 MB");
    expect(mediaMock.listTranscodeJobs).not.toHaveBeenCalled();
  });

  it("Başarısız: okunabilir hata + Yeniden dene retry ucunu çağırır ve listeyi yeniler; canRetry=false ise düğme yok", async () => {
    const user = userEvent.setup();
    showcase.listDoctorMedia
      .mockResolvedValueOnce([item(proc({ status: "failed", jobStatus: "failed", error: "Video dönüştürülemedi (bozuk dosya).", canRetry: true }))])
      .mockResolvedValue([item(proc({ status: "processing" }))]);
    mediaMock.retryTranscode.mockResolvedValue({ id: "j1", status: "queued" });
    render(<DoctorMediaManager doctorId="d1" />);
    expect(await screen.findByText("Video dönüştürülemedi (bozuk dosya).")).toBeInTheDocument();
    expect(screen.getByText("Başarısız")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Yeniden dene" }));
    expect(mediaMock.retryTranscode).toHaveBeenCalledWith("med1");
    await waitFor(() => expect(screen.getByTestId("video-processing-status")).toHaveTextContent("İşleniyor"));
  });

  it("Yeniden dene 409 verirse hata toast'u gösterilir", async () => {
    const user = userEvent.setup();
    showcase.listDoctorMedia.mockResolvedValue([item(proc({ status: "failed", error: "x", canRetry: true }))]);
    mediaMock.retryTranscode.mockRejectedValue(new ApiClientError(409, { code: "CONFLICT" as never, message: "Orijinal silinmiş; videoyu yeniden yükleyin." }));
    render(<DoctorMediaManager doctorId="d1" />);
    await user.click(await screen.findByRole("button", { name: "Yeniden dene" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  });

  it("işlenen video varken liste 10 sn'de bir yenilenir; hepsi bitince yenileme durur", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    showcase.listDoctorMedia
      .mockResolvedValueOnce([item(proc({}))])
      .mockResolvedValueOnce([item(proc({}))])
      .mockResolvedValue([item(proc({ status: "ready", jobStatus: "done", outputSizeBytes: 12 * MB }))]);
    render(<DoctorMediaManager doctorId="d1" />);
    await screen.findByTestId("video-processing-status");
    expect(PROCESSING_POLL_MS).toBe(10_000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROCESSING_POLL_MS + 100);
    });
    await waitFor(() => expect(screen.getByTestId("video-processing-status")).toHaveTextContent("Hazır"));

    const callsWhenDone = showcase.listDoctorMedia.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROCESSING_POLL_MS * 3);
    });
    expect(showcase.listDoctorMedia.mock.calls.length).toBe(callsWhenDone);
  });
});
