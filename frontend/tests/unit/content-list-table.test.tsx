import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContentListTable } from "@/components/admin/content-list/content-list-table";
import type { ContentListEntity, QuickEditValues } from "@/components/admin/content-list/types";

function makeItem(overrides: Partial<ContentListEntity> = {}): ContentListEntity {
  return {
    id: "item-1",
    title: "Örnek Sayfa",
    slug: "ornek-sayfa",
    status: "PUBLISHED",
    deletedAt: null,
    authorId: "user-1",
    author: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com", avatarUrl: null },
    seoScore: 90,
    seoScoreIssues: [],
    publishedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    viewCount: 42,
    ...overrides,
  };
}

const defaultQuickEditValues: QuickEditValues = { title: "", slug: "", status: "DRAFT" };

const baseProps = {
  activeFilter: "all" as const,
  isAdmin: false,
  selectedIds: new Set<string>(),
  onToggleSelect: vi.fn(),
  onToggleSelectAll: vi.fn(),
  allSelected: false,
  editingId: null,
  quickEditValues: defaultQuickEditValues,
  quickEditSaving: false,
  quickEditError: null,
  onQuickEditChange: vi.fn(),
  onQuickEditSave: vi.fn(),
  onQuickEditCancel: vi.fn(),
  onStartQuickEdit: vi.fn(),
  busyId: null,
  onTrash: vi.fn(),
  onRestore: vi.fn(),
  onRequestPermanentDelete: vi.fn(),
  editHref: (item: ContentListEntity) => `/admin/pages/${item.id}`,
  viewHref: (item: ContentListEntity) => `/${item.slug}`,
};

describe("ContentListTable", () => {
  it("başlık, yazar, SEO ve görüntülenme sütunlarını render eder", () => {
    render(<ContentListTable items={[makeItem()]} {...baseProps} />);

    expect(screen.getByText("Örnek Sayfa")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("90")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Yayında")).toBeInTheDocument();
  });

  it("yazarı olmayan içerik için tire gösterir", () => {
    render(<ContentListTable items={[makeItem({ author: null })]} {...baseProps} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("normal satırda Düzenle | Hızlı Düzenle | Çöpe Taşı | Görüntüle aksiyonlarını gösterir", () => {
    render(<ContentListTable items={[makeItem()]} {...baseProps} />);
    expect(screen.getByText("Düzenle")).toBeInTheDocument();
    expect(screen.getByText("Hızlı Düzenle")).toBeInTheDocument();
    expect(screen.getByText("Çöpe Taşı")).toBeInTheDocument();
    expect(screen.getByText("Görüntüle")).toBeInTheDocument();
  });

  it("taslak içerikte Görüntüle bağlantısı gösterilmez", () => {
    render(<ContentListTable items={[makeItem({ status: "DRAFT" })]} {...baseProps} />);
    expect(screen.queryByText("Görüntüle")).not.toBeInTheDocument();
  });

  it("çöpteki içerikte Geri Yükle gösterilir, ADMIN değilse Kalıcı Sil gösterilmez", () => {
    render(
      <ContentListTable
        items={[makeItem({ deletedAt: "2026-01-03T00:00:00.000Z" })]}
        {...baseProps}
        activeFilter="trashed"
        isAdmin={false}
      />
    );
    expect(screen.getByText("Geri Yükle")).toBeInTheDocument();
    expect(screen.queryByText("Kalıcı Sil")).not.toBeInTheDocument();
  });

  it("çöpteki içerikte ADMIN için Kalıcı Sil gösterilir ve tıklanınca callback çağrılır", () => {
    const onRequestPermanentDelete = vi.fn();
    render(
      <ContentListTable
        items={[makeItem({ deletedAt: "2026-01-03T00:00:00.000Z" })]}
        {...baseProps}
        activeFilter="trashed"
        isAdmin
        onRequestPermanentDelete={onRequestPermanentDelete}
      />
    );
    fireEvent.click(screen.getByText("Kalıcı Sil"));
    expect(onRequestPermanentDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "item-1" }));
  });

  it("Hızlı Düzenle tıklanınca onStartQuickEdit çağrılır", () => {
    const onStartQuickEdit = vi.fn();
    render(<ContentListTable items={[makeItem()]} {...baseProps} onStartQuickEdit={onStartQuickEdit} />);
    fireEvent.click(screen.getByText("Hızlı Düzenle"));
    expect(onStartQuickEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "item-1" }));
  });

  it("editingId eşleştiğinde satır yerine inline Hızlı Düzenle formu render edilir", () => {
    render(
      <ContentListTable
        items={[makeItem()]}
        {...baseProps}
        editingId="item-1"
        quickEditValues={{ title: "Örnek Sayfa", slug: "ornek-sayfa", status: "PUBLISHED" }}
      />
    );

    expect(screen.queryByText("Düzenle")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Örnek Sayfa")).toBeInTheDocument();
    expect(screen.getByDisplayValue("ornek-sayfa")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Güncelle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "İptal" })).toBeInTheDocument();
  });

  it("blog için Kategori sütunu opsiyonel olarak render edilir", () => {
    render(
      <ContentListTable
        items={[makeItem()]}
        {...baseProps}
        categoryColumn={{ header: "Kategori", render: () => "Teknoloji" }}
      />
    );
    expect(screen.getByText("Kategori")).toBeInTheDocument();
    expect(screen.getByText("Teknoloji")).toBeInTheDocument();
  });
});
