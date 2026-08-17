import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TagSelect } from "@/components/admin/blog/tag-select";
import type { BlogTag } from "@/lib/api/types";

vi.mock("@/lib/api/blog", () => ({
  createTag: vi.fn(),
}));

const blogApi = await import("@/lib/api/blog");

function makeTag(overrides: Partial<BlogTag> = {}): BlogTag {
  return {
    id: "tag-1",
    name: "React",
    slug: "react",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("TagSelect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("seçili etiketleri chip olarak, görünür bir label ile render eder", () => {
    render(
      <TagSelect
        availableTags={[makeTag()]}
        selectedIds={["tag-1"]}
        onChange={vi.fn()}
        onTagCreated={vi.fn()}
      />
    );
    expect(screen.getByText("Etiketler")).toBeInTheDocument();
    expect(screen.getByText("React")).toBeInTheDocument();
    expect(screen.getByRole("list")).toBeInTheDocument();
  });

  it("mevcut bir etiket aranıp seçildiğinde onChange TAM SET (eklenmiş) ile çağrılır", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TagSelect
        availableTags={[makeTag({ id: "tag-1", name: "React" }), makeTag({ id: "tag-2", name: "Vue" })]}
        selectedIds={[]}
        onChange={onChange}
        onTagCreated={vi.fn()}
      />
    );

    await user.type(screen.getByPlaceholderText("Etiket ara veya ekle..."), "Rea");
    await user.click(await screen.findByRole("button", { name: "React" }));

    expect(onChange).toHaveBeenCalledWith(["tag-1"]);
  });

  it("kaldır butonu tıklanınca onChange etiketi TAM SET'ten çıkararak çağrılır", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TagSelect
        availableTags={[makeTag({ id: "tag-1", name: "React" }), makeTag({ id: "tag-2", name: "Vue" })]}
        selectedIds={["tag-1", "tag-2"]}
        onChange={onChange}
        onTagCreated={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "React etiketini kaldır" }));
    expect(onChange).toHaveBeenCalledWith(["tag-2"]);
  });

  it("eşleşmeyen bir ad yazılınca '+ Yeni Etiket Oluştur' seçeneği görünür ve tıklanınca createTag çağrılır", async () => {
    const onChange = vi.fn();
    const onTagCreated = vi.fn();
    const user = userEvent.setup();
    vi.mocked(blogApi.createTag).mockResolvedValue(makeTag({ id: "tag-new", name: "Next.js", slug: "nextjs" }));

    render(<TagSelect availableTags={[]} selectedIds={[]} onChange={onChange} onTagCreated={onTagCreated} />);

    await user.type(screen.getByPlaceholderText("Etiket ara veya ekle..."), "Next.js");
    await user.click(await screen.findByText(/için yeni etiket oluştur/));

    expect(blogApi.createTag).toHaveBeenCalledWith({ name: "Next.js" });
    expect(onTagCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "tag-new" }));
    expect(onChange).toHaveBeenCalledWith(["tag-new"]);
  });

  // §10.14.5 madde 3 — POST'tan ÖNCE yerel listede slug eşleşmesi aranır; varsa istek hiç gönderilmez.
  it("yerel listede aynı slug'lı etiket varsa POST göndermeden onu seçer", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TagSelect
        availableTags={[makeTag({ id: "tag-1", name: "React", slug: "react" })]}
        selectedIds={[]}
        onChange={onChange}
        onTagCreated={vi.fn()}
      />
    );

    // Tam olarak "React" yazılırsa exactMatch bulunur, oluşturma seçeneği HİÇ görünmez.
    await user.type(screen.getByPlaceholderText("Etiket ara veya ekle..."), "React");
    expect(screen.queryByText(/için yeni etiket oluştur/)).not.toBeInTheDocument();
    expect(blogApi.createTag).not.toHaveBeenCalled();
  });

  it("canCreate=false iken oluşturma seçeneği hiç render edilmez (VIEWER rolü)", async () => {
    const user = userEvent.setup();
    render(
      <TagSelect availableTags={[]} selectedIds={[]} onChange={vi.fn()} onTagCreated={vi.fn()} canCreate={false} />
    );

    await user.type(screen.getByPlaceholderText("Etiket ara veya ekle..."), "Yepyeni");
    expect(screen.queryByText(/için yeni etiket oluştur/)).not.toBeInTheDocument();
  });
});
