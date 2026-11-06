import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContentListEntity, QuickEditValues } from "@/components/admin/content-list/types";
import type { DoctorBlogReviewItem } from "@/lib/api/types";

vi.mock("@/context/locale-alternates-context", () => ({
  useActiveLocaleCode: () => "en",
  useLocalizePath: () => (path: string) => path,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api/blog", () => ({
  getPreviewLink: vi.fn(),
  createPreviewLink: vi.fn(),
  revokePreviewLink: vi.fn(),
  createPreviewSession: vi.fn(),
  createDoctorPreviewSession: vi.fn(),
  listDoctorBlogReviews: vi.fn(),
  approveDoctorBlogReview: vi.fn(),
  requestDoctorBlogChanges: vi.fn(),
}));
vi.mock("@/lib/api/locales", () => ({ listAdminLocales: vi.fn() }));

import { BlogPreviewControls } from "@/components/admin/blog/blog-preview-controls";
import { ContentListTable } from "@/components/admin/content-list/content-list-table";
import { DoctorBlogReviewPanel } from "@/components/site/telehealth/doctor-blog-review-panel";
const blogApi = await import("@/lib/api/blog");
const localesApi = await import("@/lib/api/locales");
const { toast } = await import("sonner");

interface FakeTab {
  opener: unknown;
  location: { href: string };
  close: ReturnType<typeof vi.fn>;
}
let tab: FakeTab;
let openSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  tab = { opener: "x", location: { href: "" }, close: vi.fn() };
  openSpy = vi.fn().mockReturnValue(tab);
  vi.stubGlobal("open", openSpy);
  vi.mocked(blogApi.getPreviewLink).mockReset().mockResolvedValue({ active: false, expiresAt: null, createdAt: null });
  vi.mocked(blogApi.createPreviewLink).mockReset().mockResolvedValue({ token: "s_secret", expiresAt: "2026-11-09T12:00:00.000Z" });
  vi.mocked(blogApi.revokePreviewLink).mockReset().mockResolvedValue(undefined);
  vi.mocked(blogApi.createPreviewSession).mockReset().mockResolvedValue({ token: "p_session", expiresAt: "2026-11-02T12:30:00.000Z" });
  vi.mocked(blogApi.createDoctorPreviewSession).mockReset().mockResolvedValue({ token: "p_doctor", expiresAt: "2026-11-02T12:30:00.000Z" });
  vi.mocked(localesApi.listAdminLocales).mockReset().mockResolvedValue([{ code: "tr", isDefault: true }] as never);
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("Admin editörü — önizleme düğmeleri", () => {
  it("'Önizle': oturum belirteci alınır, yeni sekme varsayılan dil yoluyla açılır", async () => {
    const user = userEvent.setup();
    render(<BlogPreviewControls postId="post-1" defaultLocale="tr" />);
    await user.click(screen.getByRole("button", { name: "Önizle" }));
    await waitFor(() => expect(tab.location.href).toBe("/blog/preview/post-1#t=p_session"));
    expect(openSpy).toHaveBeenCalledWith("", "_blank");
    expect(blogApi.createPreviewSession).toHaveBeenCalledWith("post-1");
    expect(tab.opener).toBeNull();
    expect(tab.close).not.toHaveBeenCalled();
  });

  it("varsayılan dil bilinmiyorsa admin dil listesinden okunur", async () => {
    const user = userEvent.setup();
    vi.mocked(localesApi.listAdminLocales).mockResolvedValue([{ code: "en", isDefault: false }, { code: "tr", isDefault: true }] as never);
    render(<BlogPreviewControls postId="post-1" />);
    await user.click(screen.getByRole("button", { name: "Önizle" }));
    await waitFor(() => expect(tab.location.href).toBe("/blog/preview/post-1#t=p_session"));
    expect(localesApi.listAdminLocales).toHaveBeenCalled();
  });

  it("oturum belirteci alınamazsa açılan boş sekme kapatılır ve hata gösterilir", async () => {
    const user = userEvent.setup();
    vi.mocked(blogApi.createPreviewSession).mockRejectedValue(new Error("boom"));
    render(<BlogPreviewControls postId="post-1" defaultLocale="tr" />);
    await user.click(screen.getByRole("button", { name: "Önizle" }));
    await waitFor(() => expect(tab.close).toHaveBeenCalled());
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(tab.location.href).toBe("");
  });

  it("'Önizleme bağlantısı oluştur': tam adres bir kez gösterilir, kopyalanır, son geçerlilik yazılır", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<BlogPreviewControls postId="post-1" defaultLocale="tr" />);
    await user.click(screen.getByRole("button", { name: "Önizleme bağlantısı oluştur" }));
    const field = (await screen.findByLabelText(/Paylaşılabilir bağlantı/)) as HTMLInputElement;
    expect(field.value).toMatch(/^https?:\/\/[^/]+\/blog\/preview\/post-1#t=s_secret$/);
    expect(field).toHaveAttribute("readonly");
    expect(screen.getByTestId("blog-preview-link-fresh")).toHaveTextContent("Son geçerlilik:");
    await user.click(screen.getByRole("button", { name: "Kopyala" }));
    expect(writeText).toHaveBeenCalledWith(field.value);
    expect(toast.success).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Kopyalandı" })).toBeInTheDocument();
  });

  it("etkin bağlantı varsa durum + son geçerlilik; adres tekrar gösterilmez", async () => {
    vi.mocked(blogApi.getPreviewLink).mockResolvedValue({ active: true, expiresAt: "2026-11-09T12:00:00.000Z", createdAt: "2026-11-02T12:00:00.000Z" });
    render(<BlogPreviewControls postId="post-1" defaultLocale="tr" />);
    const status = await screen.findByTestId("blog-preview-link-status");
    expect(status).toHaveTextContent("Bağlantı etkin");
    expect(status).toHaveTextContent("Son geçerlilik:");
    expect(screen.queryByTestId("blog-preview-link-fresh")).toBeNull();
  });

  it("etkin bağlantı yoksa 'iptal et' gösterilmez", async () => {
    render(<BlogPreviewControls postId="post-1" defaultLocale="tr" />);
    expect(await screen.findByTestId("blog-preview-link-none")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bağlantıyı iptal et" })).toBeNull();
  });

  it("'Bağlantıyı iptal et': onay sonrası DELETE çağrılır ve durum kapanır", async () => {
    const user = userEvent.setup();
    vi.mocked(blogApi.getPreviewLink).mockResolvedValue({ active: true, expiresAt: "2026-11-09T12:00:00.000Z", createdAt: "2026-11-02T12:00:00.000Z" });
    render(<BlogPreviewControls postId="post-1" defaultLocale="tr" />);
    await user.click(await screen.findByRole("button", { name: "Bağlantıyı iptal et" }));
    expect(blogApi.revokePreviewLink).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Bağlantıyı iptal et" }));
    await waitFor(() => expect(blogApi.revokePreviewLink).toHaveBeenCalledWith("post-1"));
    await waitFor(() => expect(screen.queryByTestId("blog-preview-link-status")).toBeNull());
  });

  it("durum yüklenemezse düğmeler yine çalışır", async () => {
    vi.mocked(blogApi.getPreviewLink).mockRejectedValue(new Error("x"));
    render(<BlogPreviewControls postId="post-1" defaultLocale="tr" />);
    expect(await screen.findByText("Bağlantı durumu yüklenemedi.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Önizle" })).toBeEnabled();
  });
});

function makeItem(over: Partial<ContentListEntity> = {}): ContentListEntity {
  return {
    id: "item-1",
    title: "Taslak Yazı",
    slug: "taslak-yazi",
    status: "DRAFT",
    deletedAt: null,
    authorId: null,
    author: null,
    seoScore: 80,
    seoScoreIssues: [],
    publishedAt: null,
    updatedAt: "2026-01-02T00:00:00.000Z",
    viewCount: 0,
    ...over,
  };
}
const quick: QuickEditValues = { title: "", slug: "", status: "DRAFT" };
const tableProps = {
  activeFilter: "all" as const,
  isAdmin: true,
  selectedIds: new Set<string>(),
  onToggleSelect: vi.fn(),
  onToggleSelectAll: vi.fn(),
  allSelected: false,
  editingId: null,
  quickEditValues: quick,
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
  editHref: (i: ContentListEntity) => `/admin/blog/${i.id}`,
  viewHref: (i: ContentListEntity) => `/blog/${i.slug}`,
};

describe("Admin blog listesi — Önizle", () => {
  it("yalnızca yayında olmayan satırlarda 'Önizle' vardır ve tıklayınca o yazıyla çağrılır", async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    const items = [makeItem(), makeItem({ id: "item-2", title: "Zamanlı", status: "SCHEDULED" }), makeItem({ id: "item-3", title: "Yayında", status: "PUBLISHED" })];
    render(<ContentListTable items={items} {...tableProps} onPreview={onPreview} />);
    // Masaüstü tablo ve mobil kart birlikte render edilir: masaüstü satırı butondur.
    const buttons = screen.getAllByRole("button", { name: "Önizle" });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[0]!);
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: "item-1" }));
    await user.click(buttons[1]!);
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ id: "item-2" }));
    expect(onPreview).not.toHaveBeenCalledWith(expect.objectContaining({ id: "item-3" }));
  });

  it("onPreview verilmezse (Sayfalar/Ürünler/Portföy) 'Önizle' çıkmaz", () => {
    render(<ContentListTable items={[makeItem()]} {...tableProps} />);
    expect(screen.queryByRole("button", { name: "Önizle" })).toBeNull();
  });

  it("çöpteki satırda 'Önizle' çıkmaz", () => {
    render(<ContentListTable items={[makeItem({ deletedAt: "2026-01-03T00:00:00.000Z" })]} {...tableProps} activeFilter="trashed" onPreview={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Önizle" })).toBeNull();
  });
});

function review(over: Partial<DoctorBlogReviewItem> = {}): DoctorBlogReviewItem {
  return {
    id: "r1",
    title: "Knee pain guide",
    excerpt: null,
    status: "DRAFT",
    medicalReviewStatus: "pending",
    medicalReviewNote: null,
    category: null,
    readingMinutes: 5,
    keyTakeaways: [],
    contentHtml: "<p>Body</p>",
    lastReviewedAt: null,
    updatedAt: "2026-10-30T10:00:00.000Z",
    ...over,
  };
}

describe("Doktor paneli — Medical review listesinde Preview", () => {
  it("her yazıda 'Preview'; doktor oturum belirteciyle yeni sekmede açılır", async () => {
    const user = userEvent.setup();
    vi.mocked(blogApi.listDoctorBlogReviews).mockResolvedValue([review(), review({ id: "r2", title: "Hip guide" })]);
    render(<DoctorBlogReviewPanel />);
    const hip = await screen.findByRole("button", { name: "Preview: Hip guide" });
    expect(screen.getAllByRole("button", { name: /^Preview: / })).toHaveLength(2);
    await user.click(hip);
    await waitFor(() => expect(tab.location.href).toBe("/blog/preview/r2#t=p_doctor"));
    expect(blogApi.createDoctorPreviewSession).toHaveBeenCalledWith("r2");
    expect(openSpy).toHaveBeenCalledWith("", "_blank");
  });

  it("belirteç alınamazsa sekme kapanır ve yerelleştirilmiş hata gösterilir", async () => {
    const user = userEvent.setup();
    vi.mocked(blogApi.listDoctorBlogReviews).mockResolvedValue([review()]);
    vi.mocked(blogApi.createDoctorPreviewSession).mockRejectedValue(new Error("x"));
    render(<DoctorBlogReviewPanel />);
    await user.click(await screen.findByRole("button", { name: "Preview: Knee pain guide" }));
    expect(await screen.findByText("The preview could not be opened. Please try again.")).toBeInTheDocument();
    expect(tab.close).toHaveBeenCalled();
  });
});
