import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { ContentListTable } from "@/components/admin/content-list/content-list-table";
import type { ContentListEntity, QuickEditValues } from "@/components/admin/content-list/types";

// axe-core `region`/`landmark-*` kuralları, sayfanın <main>/<header> gibi landmark'ları içermesini
// bekler — burada tek başına render edilen bir tablo/kart parçası test edildiği için bu kurallar
// bilerek devre dışı bırakılıyor (asıl sayfa render'ında landmark'lar admin/layout.tsx sağlar).
const axeOptions = {
  rules: {
    region: { enabled: false },
  },
};

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
  isAdmin: true,
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

describe("ContentListTable — a11y", () => {
  it("normal (yayında) satır durumunda kritik/ciddi a11y ihlali içermez", async () => {
    const { container } = render(
      <ContentListTable items={[makeItem(), makeItem({ id: "item-2", status: "DRAFT", author: null })]} {...baseProps} />
    );
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("çöp (trashed) durumunda (Geri Yükle / Kalıcı Sil aksiyonları) a11y ihlali içermez", async () => {
    const { container } = render(
      <ContentListTable
        items={[makeItem({ deletedAt: "2026-01-03T00:00:00.000Z" })]}
        {...baseProps}
        activeFilter="trashed"
      />
    );
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("hızlı düzenle (inline form) açıkken a11y ihlali içermez", async () => {
    const { container } = render(
      <ContentListTable
        items={[makeItem()]}
        {...baseProps}
        editingId="item-1"
        quickEditValues={{ title: "Örnek Sayfa", slug: "ornek-sayfa", status: "PUBLISHED" }}
      />
    );
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
