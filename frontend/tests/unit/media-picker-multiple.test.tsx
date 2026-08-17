import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MediaPicker } from "@/components/admin/media/media-picker";
import type { Media } from "@/lib/api/types";

// §10.15.3 — MediaPicker çoklu seçim modu.
vi.mock("@/lib/api/media", () => ({
  listMedia: vi.fn(),
  uploadMedia: vi.fn(),
  listMediaFolders: vi.fn(() => Promise.resolve([])),
}));

const mediaApi = await import("@/lib/api/media");

function makeMedia(id: string): Media {
  return {
    id,
    url: `https://example.com/${id}.png`,
    filename: `${id}.png`,
    mimeType: "image/png",
    sizeBytes: 100,
    altText: null,
    width: null,
    height: null,
    folderId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const sampleMedia = [makeMedia("a"), makeMedia("b"), makeMedia("c")];

describe("MediaPicker — multiple: true (§10.15.3)", () => {
  beforeEach(() => {
    vi.mocked(mediaApi.listMedia).mockReset();
    vi.mocked(mediaApi.listMedia).mockResolvedValue({ items: sampleMedia, meta: { nextCursor: null } });
  });

  it("multiple verilmediğinde tekil davranış korunur — tıklama hemen seçer ve kapatır", async () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<MediaPicker open onOpenChange={onOpenChange} onSelect={onSelect} />);

    await user.click(await screen.findByLabelText("a.png seç"));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("multiple=true iken tıklama TOGGLE eder, modal KAPANMAZ; onay yalnızca 'Seç (N)' ile verilir", async () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<MediaPicker open onOpenChange={onOpenChange} multiple onSelect={onSelect} />);

    const cardA = await screen.findByLabelText("a.png seç");
    await user.click(cardA);

    // Toggle sonrası kart "seçimden kaldır" etiketine döner ve aria-pressed=true olur.
    const selectedCardA = await screen.findByLabelText("a.png seçimden kaldır");
    expect(selectedCardA).toHaveAttribute("aria-pressed", "true");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();

    await user.click(await screen.findByLabelText("b.png seç"));
    expect(screen.getByText("2 / 24 seçili")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Seç (2)" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    const selected = onSelect.mock.calls[0][0] as Media[];
    expect(selected.map((m) => m.id).sort()).toEqual(["a", "b"]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("0 seçiliyken 'Seç' butonu disabled'dır", async () => {
    render(<MediaPicker open onOpenChange={vi.fn()} multiple onSelect={vi.fn()} />);
    await screen.findByLabelText("a.png seç");

    expect(screen.getByRole("button", { name: "Seç (0)" })).toBeDisabled();
  });

  it("maxSelection'a ulaşılınca seçilmemiş kartlar disabled olur", async () => {
    const user = userEvent.setup();
    render(<MediaPicker open onOpenChange={vi.fn()} multiple maxSelection={1} onSelect={vi.fn()} />);

    await user.click(await screen.findByLabelText("a.png seç"));

    await waitFor(() => {
      expect(screen.getByLabelText("b.png seç")).toBeDisabled();
      expect(screen.getByLabelText("c.png seç")).toBeDisabled();
    });
    // Seçili kart kendisi disabled DEĞİLDİR — kaldırılabilir kalmalı.
    expect(screen.getByLabelText("a.png seçimden kaldır")).not.toBeDisabled();
  });

  it("Vazgeç tıklanınca seçim sıfırlanır ve modal kapanır", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<MediaPicker open onOpenChange={onOpenChange} multiple onSelect={vi.fn()} />);

    await user.click(await screen.findByLabelText("a.png seç"));
    await user.click(screen.getByRole("button", { name: "Vazgeç" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
