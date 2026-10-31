import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Media } from "@/lib/api/types";

/** Paket AE İş 2 — TYPE_CORRECTED bildirimi (kütüphane + seçici) ve görsel olmayan medyanın önizlemesi. */
const { toastMock, clientMock, mediaMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  clientMock: { apiFetch: vi.fn(), apiFetchPage: vi.fn(), apiFetchWithMeta: vi.fn() },
  mediaMock: { uploadMedia: vi.fn(), listMedia: vi.fn(), listMediaFolders: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/api/client", () => clientMock);

const sample = (over: Partial<Media> = {}): Media => ({
  id: "m1", url: "https://x/uploads/m1.jpg", filename: "foto.jpg", mimeType: "image/jpeg", sizeBytes: 100, altText: null, width: 10, height: 10, folderId: null, createdAt: "2026-01-01T00:00:00Z", ...over,
});

describe("lib/api/media uploadMedia — meta.notice", () => {
  it("TYPE_CORRECTED geldiğinde onNotice çağrılır; dönüş yine Media'dır", async () => {
    const real = await vi.importActual<typeof import("@/lib/api/media")>("@/lib/api/media");
    const notice = { code: "TYPE_CORRECTED", detectedMimeType: "image/jpeg", message: "Dosya JPEG olarak kaydedildi." };
    clientMock.apiFetchWithMeta.mockResolvedValue({ data: sample(), meta: { notice } });
    const onNotice = vi.fn();
    const media = await real.uploadMedia(new File(["x"], "a.png", { type: "image/png" }), null, onNotice);
    expect(media.id).toBe("m1");
    expect(onNotice).toHaveBeenCalledWith(notice);
    expect(clientMock.apiFetchWithMeta.mock.calls[0][0]).toBe("/admin/media");
  });

  it("meta yoksa (tür aynı) bildirim yok; onNotice verilmese de hata yok", async () => {
    const real = await vi.importActual<typeof import("@/lib/api/media")>("@/lib/api/media");
    clientMock.apiFetchWithMeta.mockResolvedValue({ data: sample(), meta: { nextCursor: null } });
    const onNotice = vi.fn();
    await real.uploadMedia(new File(["x"], "a.jpg", { type: "image/jpeg" }), "f1", onNotice);
    await real.uploadMedia(new File(["x"], "a.jpg", { type: "image/jpeg" }));
    expect(onNotice).not.toHaveBeenCalled();
  });
});

vi.mock("@/lib/api/media", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/media")>("@/lib/api/media");
  return { ...actual, ...mediaMock };
});

import { MediaSelectField } from "@/components/admin/media/media-select-field";
import { MediaListTable } from "@/components/admin/media/media-list-table";
import { MediaThumbnail } from "@/components/admin/media/media-thumbnail";
import { ApiClientError } from "@/lib/api/error";

beforeEach(() => {
  vi.clearAllMocks();
  mediaMock.listMediaFolders.mockResolvedValue([]);
  mediaMock.listMedia.mockResolvedValue({ items: [], meta: { nextCursor: null } });
});

describe("MediaSelectField — yükleme bildirimi", () => {
  it("uploadMedia'nın onNotice'ı bilgi toast'u gösterir", async () => {
    const user = userEvent.setup();
    mediaMock.uploadMedia.mockImplementation(async (_f: File, _folder: unknown, onNotice?: (n: unknown) => void) => {
      onNotice?.({ code: "TYPE_CORRECTED", message: "Dosya JPEG olarak kaydedildi." });
      return sample();
    });
    const onChange = vi.fn();
    render(<MediaSelectField id="logo" label="Logo" value={null} onChange={onChange} />);
    await user.upload(screen.getByLabelText("Bilgisayardan görsel yükle"), new File(["x"], "a.png", { type: "image/png" }));
    await waitFor(() => expect(toastMock.info).toHaveBeenCalledWith("Dosya JPEG olarak kaydedildi."));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });

  it("HEIC hata mesajı sunucudan geldiği gibi gösterilir", async () => {
    const user = userEvent.setup();
    const msg = "iPhone HEIC biçimi desteklenmiyor. JPEG/PNG olarak dışa aktarın.";
    mediaMock.uploadMedia.mockRejectedValue(new ApiClientError(400, { code: "VALIDATION_ERROR", message: msg }));
    render(<MediaSelectField id="logo" label="Logo" value={null} onChange={vi.fn()} />);
    await user.upload(screen.getByLabelText("Bilgisayardan görsel yükle"), new File(["x"], "a.heic", { type: "image/heic" }));
    expect(await screen.findByText(msg)).toBeInTheDocument();
    expect(toastMock.error).toHaveBeenCalledWith(msg);
  });
});

describe("Medya ızgarası/listesi — video ve altyazı kayıtları", () => {
  it("MediaThumbnail video/mp4 için <img> yerine simge + tür etiketi çizer", () => {
    const { container } = render(<MediaThumbnail src="https://x/v.mp4" mimeType="video/mp4" alt="" className="h-10 w-10" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByLabelText("Video · MP4")).toBeInTheDocument();
  });

  it("MediaListTable video ve vtt satırlarını img olmadan, görsel satırını img ile çizer", () => {
    const items = [
      sample({ id: "v", filename: "rop.mp4", mimeType: "video/mp4", url: "https://x/v.mp4" }),
      sample({ id: "c", filename: "tr.vtt", mimeType: "text/vtt", url: "https://x/c.vtt" }),
      sample({ id: "i", filename: "foto.jpg" }),
    ];
    const { container } = render(
      <MediaListTable items={items} selectedIds={new Set()} allSelected={false} onToggleSelect={vi.fn()} onToggleSelectAll={vi.fn()} onCopy={vi.fn()} onPreview={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(screen.getAllByTestId("media-file-tile")).toHaveLength(2);
    expect(screen.getByText("VIDEO")).toBeInTheDocument();
    expect(screen.getByText("VTT")).toBeInTheDocument();
  });
});
