import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EditBlogPostPage from "@/app/admin/blog/[postId]/page";
import { ApiClientError } from "@/lib/api/error";
import { cleanTranslationLists, computeReadingMinutes, getTranslatedTakeaways, setTranslatedList } from "@/lib/blog/admin-fields";
import { reviewStateFromPost, reviewStateToPayload } from "@/lib/blog/admin-review-state";
import type { BlogCategory, BlogPost, DoctorProfile, Specialty, User } from "@/lib/api/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const auth = vi.hoisted(() => ({ role: "ADMIN" as "ADMIN" | "EDITOR" }));
vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1", role: auth.role } as unknown as User }),
}));
vi.mock("@/lib/api/blog", () => ({
  getPost: vi.fn(),
  updatePost: vi.fn(),
  deletePost: vi.fn(),
  autosavePost: vi.fn(),
  listCategories: vi.fn(),
  listTags: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/api/revisions", () => ({ listPostRevisions: vi.fn(), restorePostRevision: vi.fn() }));
vi.mock("@/lib/api/media", () => ({ listMedia: vi.fn(), updateMediaAltText: vi.fn(), uploadMedia: vi.fn() }));
vi.mock("@/lib/api/locales", () => ({ listAdminLocales: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/api/telehealth", () => ({
  listAdminSpecialties: vi.fn(),
  listAdminDoctors: vi.fn(),
}));
vi.mock("@/lib/api/matcher", () => ({ listAdminCareTopics: vi.fn() }));

const blogApi = await import("@/lib/api/blog");
const revisionsApi = await import("@/lib/api/revisions");
const telehealthApi = await import("@/lib/api/telehealth");
const matcherApi = await import("@/lib/api/matcher");

const SPECIALTY = { id: "sp1", name: "Ortopedi", slug: "orthopaedics" } as Specialty;
const DOCTOR = { id: "d1", title: "Prof. Dr.", fullName: "Hakan Sofu", displayName: "H. Sofu", isActive: true, archivedAt: null } as unknown as DoctorProfile;
const TOPIC = { id: "t1", slug: "knee-pain", isActive: true, translations: { tr: { label: "Diz ağrısı", description: "", synonyms: [] } } };

function makePost(over: Partial<BlogPost> = {}): BlogPost {
  return {
    id: "post-1",
    title: "Başlık",
    slug: "baslik",
    excerpt: null,
    contentHtml: "<p>Eski içerik</p>",
    coverImageUrl: null,
    status: "DRAFT",
    category: null,
    seoTitle: null,
    seoDescription: null,
    ogTitle: null,
    ogImageUrl: null,
    canonicalUrl: null,
    noIndex: false,
    translations: {},
    publishedAt: null,
    scheduledAt: null,
    viewCount: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    deletedAt: null,
    authorId: null,
    author: null,
    seoScore: 0,
    seoScoreIssues: [],
    localizations: [],
    tags: [],
    ...over,
  };
}

function resolvedParams<T>(value: T): Promise<T> {
  const promise = Promise.resolve(value) as Promise<T> & { status?: string; value?: T };
  promise.status = "fulfilled";
  promise.value = value;
  return promise;
}

async function renderPage() {
  render(<EditBlogPostPage params={resolvedParams({ postId: "post-1" })} />);
  await screen.findByText("Eski içerik");
}

beforeEach(() => {
  auth.role = "ADMIN";
  vi.mocked(blogApi.getPost).mockReset();
  vi.mocked(blogApi.updatePost).mockReset().mockResolvedValue(makePost());
  vi.mocked(blogApi.listCategories).mockResolvedValue([]);
  vi.mocked(revisionsApi.listPostRevisions).mockResolvedValue({ items: [], meta: { nextCursor: null } });
  vi.mocked(telehealthApi.listAdminSpecialties).mockResolvedValue([SPECIALTY]);
  vi.mocked(telehealthApi.listAdminDoctors).mockResolvedValue({ items: [DOCTOR], meta: { nextCursor: null } });
  vi.mocked(matcherApi.listAdminCareTopics).mockResolvedValue([TOPIC] as never);
});

describe("Paket Z1 — admin blog editörü", () => {
  it("uzmanlık, hekim ve konu listelerini yükler; inceleme durumu rozeti gösterilir", async () => {
    vi.mocked(blogApi.getPost).mockResolvedValue(makePost({ medicalReviewStatus: "pending" }));
    await renderPage();
    const panel = await screen.findByTestId("blog-review-panel");
    expect(await within(panel).findByRole("option", { name: "Ortopedi" })).toBeInTheDocument();
    expect(await within(panel).findByRole("option", { name: "Prof. Dr. H. Sofu" })).toBeInTheDocument();
    expect(within(screen.getByTestId("blog-review-status")).getByText("Onay bekliyor")).toBeInTheDocument();
  });

  it("changes_requested: hekimin notu ve tarih gösterilir", async () => {
    vi.mocked(blogApi.getPost).mockResolvedValue(
      makePost({ medicalReviewStatus: "changes_requested", medicalReviewNote: "Doz bilgisini düzeltin", lastReviewedAt: "2026-10-01T00:00:00.000Z" })
    );
    await renderPage();
    expect(await screen.findByTestId("blog-review-note")).toHaveTextContent("Doz bilgisini düzeltin");
    expect(within(screen.getByTestId("blog-review-status")).getByText("Değişiklik istendi")).toBeInTheDocument();
    expect(screen.getByTestId("blog-review-status")).toHaveTextContent("Son onay:");
  });

  it("'not_required' seçeneği yalnızca ADMIN ve tıbbi olmayan kategoride; EDITOR göremez", async () => {
    const nonMedical: BlogCategory = { id: "c1", name: "Travel", slug: "travel", createdAt: "2026-01-01", isMedical: false };
    vi.mocked(blogApi.listCategories).mockResolvedValue([nonMedical]);
    vi.mocked(blogApi.getPost).mockResolvedValue(makePost({ category: nonMedical }));
    await renderPage();
    expect(await screen.findByRole("option", { name: "Hekim onayı gerekmiyor" })).toBeInTheDocument();
  });

  it("tıbbi kategoride (ya da kategorisizde) 'not_required' seçeneği yok", async () => {
    vi.mocked(blogApi.getPost).mockResolvedValue(makePost());
    await renderPage();
    await screen.findByTestId("blog-review-panel");
    expect(screen.queryByRole("option", { name: "Hekim onayı gerekmiyor" })).toBeNull();
  });

  it("EDITOR tıbbi olmayan kategoride bile 'not_required' seçemez", async () => {
    auth.role = "EDITOR";
    const nonMedical: BlogCategory = { id: "c1", name: "Travel", slug: "travel", createdAt: "2026-01-01", isMedical: false };
    vi.mocked(blogApi.listCategories).mockResolvedValue([nonMedical]);
    vi.mocked(blogApi.getPost).mockResolvedValue(makePost({ category: nonMedical }));
    await renderPage();
    await screen.findByTestId("blog-review-panel");
    expect(screen.queryByRole("option", { name: "Hekim onayı gerekmiyor" })).toBeNull();
  });

  it("okuma süresi önizlemesi içerikten hesaplanır", async () => {
    const words = Array.from({ length: 450 }, (_, i) => `kelime${i}`).join(" ");
    vi.mocked(blogApi.getPost).mockResolvedValue(makePost({ contentHtml: `<p>${words}</p>` }));
    render(<EditBlogPostPage params={resolvedParams({ postId: "post-1" })} />);
    expect(await screen.findByTestId("blog-reading-preview")).toHaveTextContent("3 dk");
  });

  it("yayın 422: 'Medical review approval required' alan hatası olarak inceleme durumu alanının altında gösterilir", async () => {
    const user = userEvent.setup();
    vi.mocked(blogApi.getPost).mockResolvedValue(makePost());
    vi.mocked(blogApi.updatePost).mockRejectedValue(
      new ApiClientError(422, {
        code: "VALIDATION_ERROR",
        message: "Yazı hekim onayı olmadan yayınlanamaz veya zamanlanamaz.",
        details: { medicalReviewStatus: ["Medical review approval required"] },
      })
    );
    await renderPage();
    await user.selectOptions(screen.getByLabelText("Durum"), "PUBLISHED");
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    const field = await screen.findByLabelText("Durumu değiştir");
    await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"));
    const error = within(screen.getByTestId("blog-review-status")).getByRole("alert");
    expect(error).toHaveTextContent("Medical review approval required");
    expect(field).toHaveAccessibleDescription("Medical review approval required");
  });

  it("kayıt gövdesi Z1 alanlarını taşır; statusWrite boşsa medicalReviewStatus gönderilmez", async () => {
    const user = userEvent.setup();
    vi.mocked(blogApi.getPost).mockResolvedValue(makePost({ specialtyId: "sp1", reviewerDoctorId: "d1", keyTakeaways: ["Bir"], isFeatured: true }));
    await renderPage();
    await user.click(screen.getByRole("button", { name: "Madde ekle" }));
    await user.type(screen.getAllByLabelText("Madde")[1]!, "İki");
    await user.click(screen.getByRole("button", { name: "Soru ekle" }));
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(blogApi.updatePost).toHaveBeenCalled());
    const body = vi.mocked(blogApi.updatePost).mock.calls[0]![1];
    expect(body).toMatchObject({ specialtyId: "sp1", reviewerDoctorId: "d1", keyTakeaways: ["Bir", "İki"], faq: [], references: [], isFeatured: true, careTopicIds: [] });
    expect(body).not.toHaveProperty("medicalReviewStatus");
  });
});

describe("Paket Z1 — admin yardımcıları", () => {
  it("okuma süresi: en az 1, 200 kelime/dk, etiket ve varlıklar sayılmaz", () => {
    expect(computeReadingMinutes("")).toBe(1);
    expect(computeReadingMinutes("<p>kısa</p>")).toBe(1);
    expect(computeReadingMinutes(`<p>${"a ".repeat(201)}</p>`)).toBe(2);
    expect(computeReadingMinutes("<p>&nbsp;&amp;</p><style>x y z</style>")).toBe(1);
  });

  it("çeviri listeleri: yazma, boşalınca anahtar silme, temizleme", () => {
    let t = setTranslatedList({}, "de", "keyTakeaways", ["Eins", " "]);
    expect(getTranslatedTakeaways(t, "de")).toEqual(["Eins", " "]);
    expect(cleanTranslationLists(t).de!.keyTakeaways).toEqual(["Eins"]);
    t = setTranslatedList(t, "de", "keyTakeaways", []);
    expect(t).toEqual({});
    const withTitle = { de: { title: "T", faq: [{ question: " ", answer: "x" }] } };
    expect(cleanTranslationLists(withTitle)).toEqual({ de: { title: "T" } });
  });

  it("payload: uzmanlık/hekim boşsa null; statusWrite yalnızca doluyken eklenir", () => {
    const base = reviewStateFromPost(makePost());
    expect(reviewStateToPayload(base)).toMatchObject({ specialtyId: null, reviewerDoctorId: null, careTopicIds: [], isFeatured: false });
    expect(reviewStateToPayload(base)).not.toHaveProperty("medicalReviewStatus");
    expect(reviewStateToPayload({ ...base, statusWrite: "not_required" })).toMatchObject({ medicalReviewStatus: "not_required" });
  });
});
