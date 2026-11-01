import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClientError } from "@/lib/api/error";
import type { DoctorBlogReviewItem } from "@/lib/api/types";

const lang = vi.hoisted(() => ({ code: "en" }));
vi.mock("@/context/locale-alternates-context", () => ({
  useActiveLocaleCode: () => lang.code,
  useLocalizePath: () => (path: string) => path,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api/blog", () => ({
  listDoctorBlogReviews: vi.fn(),
  approveDoctorBlogReview: vi.fn(),
  requestDoctorBlogChanges: vi.fn(),
}));

import { DoctorBlogReviewPanel, REVIEW_NOTE_MAX, validateReviewNote } from "@/components/site/telehealth/doctor-blog-review-panel";
const blogApi = await import("@/lib/api/blog");
const { toast } = await import("sonner");

function item(over: Partial<DoctorBlogReviewItem> = {}): DoctorBlogReviewItem {
  return {
    id: "r1",
    title: "Knee pain guide",
    excerpt: "About knees.",
    status: "DRAFT",
    medicalReviewStatus: "pending",
    medicalReviewNote: null,
    category: { name: "Orthopaedics", slug: "orthopaedics" },
    readingMinutes: 5,
    keyTakeaways: ["Rest helps"],
    contentHtml: "<p>Body text</p>",
    lastReviewedAt: null,
    updatedAt: "2026-10-30T10:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  lang.code = "en";
  vi.mocked(blogApi.listDoctorBlogReviews).mockReset().mockResolvedValue([item(), item({ id: "r2", title: "Hip guide" })]);
  vi.mocked(blogApi.approveDoctorBlogReview).mockReset().mockResolvedValue(item());
  vi.mocked(blogApi.requestDoctorBlogChanges).mockReset().mockResolvedValue(item());
  vi.mocked(toast.success).mockClear();
});

describe("Paket Z1 — doktor paneli Medical review kuyruğu", () => {
  it("yüklenirken skeleton, sonra atanan yazılar listelenir", async () => {
    render(<DoctorBlogReviewPanel />);
    expect(screen.getByTestId("doctor-blog-review-skeleton")).toBeInTheDocument();
    expect(await screen.findAllByTestId("doctor-blog-review-item")).toHaveLength(2);
    expect(screen.getByRole("heading", { level: 1, name: "Medical review" })).toBeInTheDocument();
    expect(screen.getAllByText("Awaiting review")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Hip guide" })).toBeInTheDocument();
  });

  it("boş durum", async () => {
    vi.mocked(blogApi.listDoctorBlogReviews).mockResolvedValue([]);
    render(<DoctorBlogReviewPanel />);
    expect(await screen.findByTestId("doctor-blog-review-empty")).toHaveTextContent("No articles are waiting for your review.");
  });

  it("hata durumu yeniden dene ile toparlanır", async () => {
    const user = userEvent.setup();
    vi.mocked(blogApi.listDoctorBlogReviews).mockRejectedValueOnce(new ApiClientError(500, { code: "INTERNAL_ERROR" as never, message: "x" }));
    render(<DoctorBlogReviewPanel />);
    const retry = await screen.findByRole("button", { name: "Try again" });
    await user.click(retry);
    expect(await screen.findAllByTestId("doctor-blog-review-item")).toHaveLength(2);
  });

  it("önizleme: Key takeaways düz metin ve içerik; tekrar tıklayınca gizlenir", async () => {
    const user = userEvent.setup();
    vi.mocked(blogApi.listDoctorBlogReviews).mockResolvedValue([item({ keyTakeaways: ["<b>x</b>"] })]);
    render(<DoctorBlogReviewPanel />);
    const toggle = await screen.findByRole("button", { name: "Preview the article" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    const preview = screen.getByTestId("doctor-blog-review-preview");
    expect(preview).toHaveTextContent("Body text");
    expect(preview).toHaveTextContent("<b>x</b>");
    await user.click(screen.getByRole("button", { name: "Hide the preview" }));
    expect(screen.queryByTestId("doctor-blog-review-preview")).toBeNull();
  });

  it("Approve: API çağrılır, yazı listeden kalkar, bildirim gösterilir", async () => {
    const user = userEvent.setup();
    render(<DoctorBlogReviewPanel />);
    const first = (await screen.findAllByTestId("doctor-blog-review-item"))[0]!;
    await user.click(within(first).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(blogApi.approveDoctorBlogReview).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(screen.getAllByTestId("doctor-blog-review-item")).toHaveLength(1));
    expect(toast.success).toHaveBeenCalledWith("The article was approved.");
  });

  it("Request changes: not zorunlu — boşken API çağrılmaz ve hata gösterilir", async () => {
    const user = userEvent.setup();
    render(<DoctorBlogReviewPanel />);
    const first = (await screen.findAllByTestId("doctor-blog-review-item"))[0]!;
    await user.click(within(first).getByRole("button", { name: "Request changes" }));
    await user.click(within(first).getByRole("button", { name: "Send note" }));
    expect(within(first).getByRole("alert")).toHaveTextContent("Please write a note.");
    await user.type(within(first).getByLabelText("Note for the editorial team"), "   ");
    await user.click(within(first).getByRole("button", { name: "Send note" }));
    expect(blogApi.requestDoctorBlogChanges).not.toHaveBeenCalled();
  });

  it("Request changes: 2000 karakterden uzun not reddedilir", async () => {
    const user = userEvent.setup();
    render(<DoctorBlogReviewPanel />);
    const first = (await screen.findAllByTestId("doctor-blog-review-item"))[0]!;
    await user.click(within(first).getByRole("button", { name: "Request changes" }));
    const box = within(first).getByLabelText("Note for the editorial team");
    await user.click(box);
    await user.paste("a".repeat(REVIEW_NOTE_MAX + 1));
    await user.click(within(first).getByRole("button", { name: "Send note" }));
    expect(within(first).getByRole("alert")).toHaveTextContent("The note can be at most 2000 characters.");
    expect(blogApi.requestDoctorBlogChanges).not.toHaveBeenCalled();
  });

  it("Request changes: geçerli not kırpılarak gönderilir ve yazı listeden kalkar", async () => {
    const user = userEvent.setup();
    render(<DoctorBlogReviewPanel />);
    const first = (await screen.findAllByTestId("doctor-blog-review-item"))[0]!;
    await user.click(within(first).getByRole("button", { name: "Request changes" }));
    await user.type(within(first).getByLabelText("Note for the editorial team"), "  Please fix the dosage.  ");
    await user.click(within(first).getByRole("button", { name: "Send note" }));
    await waitFor(() => expect(blogApi.requestDoctorBlogChanges).toHaveBeenCalledWith("r1", "Please fix the dosage."));
    await waitFor(() => expect(screen.getAllByTestId("doctor-blog-review-item")).toHaveLength(1));
    expect(toast.success).toHaveBeenCalledWith("Your note was sent to the editorial team.");
  });

  it("Vazgeç not alanını kapatır ve API çağrılmaz", async () => {
    const user = userEvent.setup();
    render(<DoctorBlogReviewPanel />);
    const first = (await screen.findAllByTestId("doctor-blog-review-item"))[0]!;
    await user.click(within(first).getByRole("button", { name: "Request changes" }));
    await user.click(within(first).getByRole("button", { name: "Cancel" }));
    expect(within(first).queryByLabelText("Note for the editorial team")).toBeNull();
    expect(within(first).getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("eylem hatası: yazı listede kalır ve uyarı gösterilir", async () => {
    const user = userEvent.setup();
    vi.mocked(blogApi.approveDoctorBlogReview).mockRejectedValue(new ApiClientError(404, { code: "NOT_FOUND", message: "x" }));
    render(<DoctorBlogReviewPanel />);
    const first = (await screen.findAllByTestId("doctor-blog-review-item"))[0]!;
    await user.click(within(first).getByRole("button", { name: "Approve" }));
    expect(await within(first).findByRole("alert")).toBeInTheDocument();
    expect(screen.getAllByTestId("doctor-blog-review-item")).toHaveLength(2);
  });

  it("changes_requested yazıda önceki not ve durum rozeti görünür", async () => {
    vi.mocked(blogApi.listDoctorBlogReviews).mockResolvedValue([item({ medicalReviewStatus: "changes_requested", medicalReviewNote: "Fix dosage" })]);
    render(<DoctorBlogReviewPanel />);
    const card = await screen.findByTestId("doctor-blog-review-item");
    expect(within(card).getByText("Changes requested")).toBeInTheDocument();
    expect(within(card).getByText("Your previous note")).toBeInTheDocument();
    expect(within(card).getByText("Fix dosage")).toBeInTheDocument();
  });

  it("Türkçe arayüz: başlık ve düğmeler çevrilmiş", async () => {
    lang.code = "tr";
    render(<DoctorBlogReviewPanel />);
    expect(await screen.findByRole("heading", { level: 1, name: "Tıbbi inceleme" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Onayla" }).length).toBeGreaterThan(0);
  });

  it("validateReviewNote: 1..2000 karakter", () => {
    expect(validateReviewNote("")).toBe("required");
    expect(validateReviewNote("   ")).toBe("required");
    expect(validateReviewNote("a")).toBeNull();
    expect(validateReviewNote("a".repeat(2000))).toBeNull();
    expect(validateReviewNote("a".repeat(2001))).toBe("tooLong");
  });
});
