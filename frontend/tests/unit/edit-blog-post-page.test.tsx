import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EditBlogPostPage from "@/app/admin/blog/[postId]/page";
import type { BlogPost, ContentRevisionSummary } from "@/lib/api/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/api/blog", () => ({
  getPost: vi.fn(),
  updatePost: vi.fn(),
  deletePost: vi.fn(),
  autosavePost: vi.fn(),
  listCategories: vi.fn(),
}));
vi.mock("@/lib/api/revisions", () => ({
  listPostRevisions: vi.fn(),
  restorePostRevision: vi.fn(),
}));
vi.mock("@/lib/api/media", () => ({
  listMedia: vi.fn(),
  updateMediaAltText: vi.fn(),
  uploadMedia: vi.fn(),
}));

const blogApi = await import("@/lib/api/blog");
const revisionsApi = await import("@/lib/api/revisions");

function makePost(overrides: Partial<BlogPost> = {}): BlogPost {
  return {
    id: "post-1",
    title: "Başlangıç Başlığı",
    slug: "baslangic-basligi",
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
    ...overrides,
  };
}

/**
 * `use(params)` (App Router sözleşmesi) HER ZAMAN suspend eder — `Promise.then()` her zaman
 * bir mikrotask gerektirir, ilişkili Suspense sınırının tekrar render tetiklenmesi ise bu
 * test ortamında (Vitest + jsdom + React 19) GERÇEKLEŞMEZ (`@testing-library/react`'in `render()`'ı
 * `use()`'un bekleyen promise'i çözdüğü retry'ı asla flush etmiyor — Next.js'in kendi Vitest
 * rehberi de zaten "async component'ler için unit test DESTEKLENMİYOR, E2E kullanın" diyor).
 * Bunu aşmak için React'in "usable" protokolünü (`thenable.status === 'fulfilled'` →
 * `use()` HİÇ suspend ETMEDEN `thenable.value`'yu senkron döner) kullanan, ÖNCEDEN ÇÖZÜLMÜŞ
 * bir thenable üretilir — bkz. react-dom `trackUsedThenable`.
 */
function resolvedParamsPromise<T>(value: T): Promise<T> {
  const promise = Promise.resolve(value) as Promise<T> & { status?: string; value?: T };
  promise.status = "fulfilled";
  promise.value = value;
  return promise;
}

async function renderPage() {
  const params = resolvedParamsPromise({ postId: "post-1" });
  return render(<EditBlogPostPage params={params} />);
}

describe("EditBlogPostPage", () => {
  // Faz 0 — regresyon testi: versiyon restore sonrası editörün gerçekten YENİ içeriği
  // göstermesi. `PostEditor` TipTap'i uncontrolled kullanır (`content` yalnızca ilk mount'ta
  // okunur); bug fix'in özü `editorGeneration` sayacının restore sonrası artırılıp `key`'e
  // dahil edilerek editörün TAM REMOUNT edilmesiydi (bkz. post-editor.tsx yorumları,
  // `[postId]/page.tsx::editorGeneration`).
  it("bir versiyon restore edildiğinde PostEditor YENİ içeriği gösterir (editorGeneration remount)", async () => {
    const initialPost = makePost({ contentHtml: "<p>Eski içerik</p>" });
    const restoredPost = makePost({ contentHtml: "<p>Restore edilen YENİ içerik</p>" });

    vi.mocked(blogApi.getPost).mockResolvedValueOnce(initialPost).mockResolvedValueOnce(restoredPost);
    vi.mocked(blogApi.listCategories).mockResolvedValue([]);

    const revision: ContentRevisionSummary = {
      id: "rev-1",
      editedById: "user-1",
      editedByName: "Test Kullanıcı",
      createdAt: "2026-07-01T00:00:00.000Z",
    };
    vi.mocked(revisionsApi.listPostRevisions).mockResolvedValue({ items: [revision], meta: { nextCursor: null } });
    vi.mocked(revisionsApi.restorePostRevision).mockResolvedValue(restoredPost);

    const user = userEvent.setup();
    await renderPage();

    // İlk yükleme — eski içerik editörde görünür.
    await screen.findByText("Eski içerik");

    await user.click(screen.getByRole("tab", { name: /Geçmiş Sürümler/ }));
    await user.click(await screen.findByRole("button", { name: /Bu Sürüme Geri Dön/ }));

    // ConfirmDialog açılır — "Geri Dön" ile onayla.
    const dialog = await screen.findByRole("dialog", { name: "Bu sürüme geri dön" });
    await user.click(within(dialog).getByRole("button", { name: "Geri Dön" }));

    await waitFor(() => {
      expect(revisionsApi.restorePostRevision).toHaveBeenCalledWith("post-1", "rev-1");
    });

    // Restore sonrası `load()` tekrar çağrılır (2. `getPost` çağrısı) ve editör YENİ içeriği
    // göstermelidir — remount olmasaydı (bug'ın ASIL hâli) eski "Eski içerik" ekranda kalırdı.
    await user.click(screen.getByRole("tab", { name: "İçerik" }));
    await waitFor(() => {
      expect(screen.getByText("Restore edilen YENİ içerik")).toBeInTheDocument();
    });
    expect(screen.queryByText("Eski içerik")).not.toBeInTheDocument();
  });

  // Faz 4 — zamanlanmış yayın UI'ı.
  describe("zamanlanmış yayın (Faz 4)", () => {
    it("status='SCHEDULED' seçildiğinde datetime-local input görünür, min='şimdi' set edilir; diğer durumlarda gizlidir", async () => {
      vi.mocked(blogApi.getPost).mockResolvedValue(makePost({ status: "DRAFT" }));
      vi.mocked(blogApi.listCategories).mockResolvedValue([]);
      vi.mocked(revisionsApi.listPostRevisions).mockResolvedValue({ items: [], meta: { nextCursor: null } });

      const user = userEvent.setup();
      await renderPage();
      await screen.findByText("Eski içerik");

      // DRAFT iken tarih alanı gizli.
      expect(screen.queryByLabelText(/Yayın tarihi/)).not.toBeInTheDocument();

      const statusSelect = screen.getByLabelText("Durum");
      await user.selectOptions(statusSelect, "SCHEDULED");

      const dateInput = await screen.findByLabelText(/Yayın tarihi/);
      expect(dateInput).toHaveAttribute("type", "datetime-local");
      expect(dateInput).toBeRequired();
      // `min` — geçmiş bir tarihin istemci tarafında engellenmesi için "şimdi" değerine set edilir.
      const minAttr = dateInput.getAttribute("min");
      expect(minAttr).toBeTruthy();
      expect(minAttr).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

      // PUBLISHED'e geri dönülünce tarih alanı tekrar gizlenir.
      await user.selectOptions(statusSelect, "PUBLISHED");
      expect(screen.queryByLabelText(/Yayın tarihi/)).not.toBeInTheDocument();
    });

    it("mevcut bir SCHEDULED yazı yüklendiğinde tarih alanı baştan görünür ve önceki scheduledAt ile doludur", async () => {
      vi.mocked(blogApi.getPost).mockResolvedValue(
        makePost({ status: "SCHEDULED", scheduledAt: "2027-01-15T10:30:00.000Z" })
      );
      vi.mocked(blogApi.listCategories).mockResolvedValue([]);
      vi.mocked(revisionsApi.listPostRevisions).mockResolvedValue({ items: [], meta: { nextCursor: null } });

      await renderPage();
      await screen.findByText("Eski içerik");

      const dateInput = await screen.findByLabelText(/Yayın tarihi/);
      expect((dateInput as HTMLInputElement).value).not.toBe("");
    });
  });
});
