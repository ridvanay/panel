import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { MediaPicker } from "@/components/admin/media/media-picker";
import type { Media } from "@/lib/api/types";

vi.mock("@/lib/api/media", () => ({ listMedia: vi.fn(), uploadMedia: vi.fn() }));

const mediaApi = await import("@/lib/api/media");

const axeOptions = { rules: { region: { enabled: false } } };

const sampleMedia: Media[] = [
  { id: "media-1", url: "https://example.com/a.png", filename: "a.png", mimeType: "image/png", sizeBytes: 100, altText: null, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "media-2", url: "https://example.com/b.png", filename: "b.png", mimeType: "image/png", sizeBytes: 200, altText: null, createdAt: "2026-01-02T00:00:00.000Z" },
];

describe("MediaPicker — a11y ve klavye davranışı", () => {
  beforeEach(() => {
    vi.mocked(mediaApi.listMedia).mockReset();
  });

  it("görsel listesi yüklendikten sonra kritik/ciddi a11y ihlali içermez", async () => {
    vi.mocked(mediaApi.listMedia).mockResolvedValue({ items: sampleMedia, meta: { nextCursor: null } });

    const { container } = render(<MediaPicker open onOpenChange={vi.fn()} onSelect={vi.fn()} />);

    expect(await screen.findByLabelText("a.png seç")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("boş kütüphane / arama sonucu bulunamadı durumlarında kritik/ciddi a11y ihlali içermez", async () => {
    vi.mocked(mediaApi.listMedia).mockResolvedValue({ items: [], meta: { nextCursor: null } });

    const { container } = render(<MediaPicker open onOpenChange={vi.fn()} onSelect={vi.fn()} />);

    expect(await screen.findByText("Henüz görsel yüklenmedi")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("modal açıldığında odak (focus) modal içinde tutulur (focus-trap)", async () => {
    vi.mocked(mediaApi.listMedia).mockResolvedValue({ items: sampleMedia, meta: { nextCursor: null } });
    const user = userEvent.setup();

    render(<MediaPicker open onOpenChange={vi.fn()} onSelect={vi.fn()} />);
    await screen.findByLabelText("a.png seç");

    // Base UI Dialog, popup açıldığında odağı içeri taşır — dışarıda (body'de) kalmamalı.
    await waitFor(() => {
      expect(document.body).not.toBe(document.activeElement);
      expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    });

    // Dialog içindeki tüm odaklanabilir elemanları Tab ile dolaş — hiçbiri dialog dışına çıkmamalı.
    // Not: Base UI, dialog sınırlarına görünmez "focus guard" elemanları yerleştirir ve odağı bir
    // sonraki tick'te (rAF/microtask) içeri geri yönlendirir — bu yüzden her Tab sonrası `waitFor`
    // ile bu yönlendirmenin tamamlanmasını bekliyoruz (senkron kontrol flaky olurdu).
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 12; i++) {
      await user.tab();
      await waitFor(() => {
        expect(dialog.contains(document.activeElement)).toBe(true);
      });
    }
  });

  it("ESC tuşuna basınca modal kapanır (onOpenChange(false) çağrılır)", async () => {
    vi.mocked(mediaApi.listMedia).mockResolvedValue({ items: sampleMedia, meta: { nextCursor: null } });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(<MediaPicker open onOpenChange={onOpenChange} onSelect={vi.fn()} />);
    await screen.findByLabelText("a.png seç");

    await user.keyboard("{Escape}");

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
