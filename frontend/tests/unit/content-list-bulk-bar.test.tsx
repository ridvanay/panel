import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContentListBulkBar } from "@/components/admin/content-list/content-list-bulk-bar";

function getOptionLabels(select: HTMLElement): string[] {
  return Array.from(select.querySelectorAll("option")).map((o) => o.textContent ?? "");
}

describe("ContentListBulkBar", () => {
  it("aktif sekmede yayınla/taslağa al/çöpe taşı seçeneklerini gösterir", () => {
    render(
      <ContentListBulkBar
        selectedCount={2}
        activeFilter="all"
        isAdmin={false}
        action="publish"
        onActionChange={vi.fn()}
        onApply={vi.fn()}
        applying={false}
        onClearSelection={vi.fn()}
      />
    );
    const select = screen.getByLabelText("Toplu işlem seç");
    expect(getOptionLabels(select)).toEqual(["Yayınla", "Taslağa Al", "Çöpe Taşı"]);
  });

  it("çöp sekmesinde ve ADMIN değilken yalnızca Geri Yükle gösterilir (Kalıcı Sil gizlenir)", () => {
    render(
      <ContentListBulkBar
        selectedCount={2}
        activeFilter="trashed"
        isAdmin={false}
        action="restore"
        onActionChange={vi.fn()}
        onApply={vi.fn()}
        applying={false}
        onClearSelection={vi.fn()}
      />
    );
    const select = screen.getByLabelText("Toplu işlem seç");
    expect(getOptionLabels(select)).toEqual(["Geri Yükle"]);
  });

  it("çöp sekmesinde ADMIN için Kalıcı Sil de gösterilir", () => {
    render(
      <ContentListBulkBar
        selectedCount={2}
        activeFilter="trashed"
        isAdmin
        action="restore"
        onActionChange={vi.fn()}
        onApply={vi.fn()}
        applying={false}
        onClearSelection={vi.fn()}
      />
    );
    const select = screen.getByLabelText("Toplu işlem seç");
    expect(getOptionLabels(select)).toEqual(["Geri Yükle", "Kalıcı Sil"]);
  });

  it("seçili öğe sayısını gösterir", () => {
    render(
      <ContentListBulkBar
        selectedCount={5}
        activeFilter="all"
        isAdmin={false}
        action="publish"
        onActionChange={vi.fn()}
        onApply={vi.fn()}
        applying={false}
        onClearSelection={vi.fn()}
      />
    );
    expect(screen.getByText("5 seçili")).toBeInTheDocument();
  });
});
