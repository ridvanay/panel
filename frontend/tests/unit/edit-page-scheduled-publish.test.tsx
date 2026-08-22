import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PageBuilderPage from "@/app/admin/pages/[pageId]/page";
import type { ContentRevisionSummary, SitePage } from "@/lib/api/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/api/pages", () => ({
  getPage: vi.fn(),
  updatePage: vi.fn(),
  deletePage: vi.fn(),
  autosavePage: vi.fn(),
}));
vi.mock("@/lib/api/revisions", () => ({
  listPageRevisions: vi.fn(),
  restorePageRevision: vi.fn(),
}));
vi.mock("@/lib/api/media", () => ({
  listMedia: vi.fn(),
  updateMediaAltText: vi.fn(),
  uploadMedia: vi.fn(),
}));
vi.mock("@/lib/api/locales", () => ({
  listAdminLocales: vi.fn().mockResolvedValue([
    { code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: true, enabled: true, sortOrder: 0, hreflang: null },
  ]),
}));
vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "admin@example.com", name: "Admin", avatarUrl: null, role: "ADMIN", canUseAdvancedBuilder: true },
  }),
}));

const pagesApi = await import("@/lib/api/pages");
const revisionsApi = await import("@/lib/api/revisions");

function makePage(overrides: Partial<SitePage> = {}): SitePage {
  return {
    id: "page-1",
    title: "Başlangıç Sayfası",
    slug: "baslangic-sayfasi",
    status: "DRAFT",
    editMode: "FREEFORM",
    blocks: [],
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
    isLegalDocument: false,
    ...overrides,
  };
}

/**
 * `use(params)` (App Router sözleşmesi) HER ZAMAN suspend eder ve bu test ortamında
 * (Vitest + jsdom + React 19) suspense retry'ı asla flush edilmiyor (bkz.
 * `edit-blog-post-page.test.tsx`'teki AYNI notun tekrarı) — React'in "usable" protokolünü
 * (`thenable.status === 'fulfilled'`) kullanan önceden-çözülmüş bir thenable ile aşılır.
 */
function resolvedParamsPromise<T>(value: T): Promise<T> {
  const promise = Promise.resolve(value) as Promise<T> & { status?: string; value?: T };
  promise.status = "fulfilled";
  promise.value = value;
  return promise;
}

async function renderPage() {
  const params = resolvedParamsPromise({ pageId: "page-1" });
  return render(<PageBuilderPage params={params} />);
}

describe("PageBuilderPage — zamanlanmış yayın (Faz 4)", () => {
  it("status='SCHEDULED' seçildiğinde datetime-local input görünür, min='şimdi' set edilir; diğer durumlarda gizlidir", async () => {
    vi.mocked(pagesApi.getPage).mockResolvedValue(makePage({ status: "DRAFT" }));
    vi.mocked(revisionsApi.listPageRevisions).mockResolvedValue({ items: [], meta: { nextCursor: null } });

    const user = userEvent.setup();
    await renderPage();
    await screen.findByDisplayValue("Başlangıç Sayfası");

    expect(screen.queryByLabelText(/Yayın tarihi/)).not.toBeInTheDocument();

    const statusSelect = screen.getByLabelText("Durum");
    await user.selectOptions(statusSelect, "SCHEDULED");

    const dateInput = await screen.findByLabelText(/Yayın tarihi/);
    expect(dateInput).toHaveAttribute("type", "datetime-local");
    expect(dateInput).toBeRequired();
    const minAttr = dateInput.getAttribute("min");
    expect(minAttr).toBeTruthy();
    expect(minAttr).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

    await user.selectOptions(statusSelect, "DRAFT");
    expect(screen.queryByLabelText(/Yayın tarihi/)).not.toBeInTheDocument();
  });

  // Faz 0 — regresyon: `BuilderCanvas`'ın da (blog editöründeki `PostEditor` ile AYNI sebep/
  // desen) `editorGeneration` ile tam remount edilmesi gerekir; burada başlık alanı üzerinden
  // (daha basit/kararlı bir gösterge) restore sonrası verinin gerçekten tazelendiği doğrulanır.
  it("bir versiyon restore edildiğinde form YENİ veriyle güncellenir (editorGeneration remount)", async () => {
    const initialPage = makePage({ title: "Eski Başlık" });
    const restoredPage = makePage({ title: "Restore Edilen YENİ Başlık" });

    vi.mocked(pagesApi.getPage).mockResolvedValueOnce(initialPage).mockResolvedValueOnce(restoredPage);
    const revision: ContentRevisionSummary = {
      id: "rev-1",
      editedById: "user-1",
      editedByName: "Test Kullanıcı",
      createdAt: "2026-07-01T00:00:00.000Z",
    };
    vi.mocked(revisionsApi.listPageRevisions).mockResolvedValue({ items: [revision], meta: { nextCursor: null } });
    vi.mocked(revisionsApi.restorePageRevision).mockResolvedValue(restoredPage);

    const user = userEvent.setup();
    await renderPage();
    await screen.findByDisplayValue("Eski Başlık");

    await user.click(screen.getByRole("tab", { name: /Geçmiş Sürümler/ }));
    await user.click(await screen.findByRole("button", { name: /Bu Sürüme Geri Dön/ }));

    const dialog = await screen.findByRole("dialog", { name: "Bu sürüme geri dön" });
    await user.click(within(dialog).getByRole("button", { name: "Geri Dön" }));

    await waitFor(() => {
      expect(revisionsApi.restorePageRevision).toHaveBeenCalledWith("page-1", "rev-1");
    });

    await user.click(screen.getByRole("tab", { name: "İçerik" }));
    await waitFor(() => {
      expect(screen.getByDisplayValue("Restore Edilen YENİ Başlık")).toBeInTheDocument();
    });
  });
});
