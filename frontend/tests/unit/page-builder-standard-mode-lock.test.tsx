import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PageBuilderPage from "@/app/admin/pages/[pageId]/page";
import type { SitePage, User } from "@/lib/api/types";

/**
 * Kullanıcı kararı (orkestratör, 2026-08-23) — standart kullanıcı (`canUseAdvancedBuilder: false`)
 * `editMode` NE OLURSA OLSUN (FREEFORM DAHİL) serbest tuvale (`BuilderCanvas`) asla erişemez,
 * yalnızca `TemplateEditorView` görür. Bu, `.claude/architect-scope-page-editor-roles.md` §5
 * madde 3'teki ("editMode: TEMPLATE gelişmiş kullanıcıyı kısıtlamaz... sayfa geneli bir kilit
 * DEĞİLDİR") nüansının standart kullanıcı YÖNÜNDE bilinçli olarak sıkılaştırılmasıdır — o kural
 * gelişmiş kullanıcı için hâlâ geçerlidir (bkz. altındaki "gelişmiş kullanıcı" testi).
 *
 * `useAuth` bu dosyada `vi.fn()` olarak mock'lanır (sabit dönüş değeri DEĞİL) — böylece her test
 * kendi kullanıcı/yetenek kombinasyonunu bağımsız olarak ayarlayabilir.
 */

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
  useAuth: vi.fn(),
}));

const pagesApi = await import("@/lib/api/pages");
const revisionsApi = await import("@/lib/api/revisions");
const authContext = await import("@/context/auth-context");

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "editor@example.com",
    name: "Test Editör",
    avatarUrl: null,
    role: "EDITOR",
    canUseAdvancedBuilder: false,
    ...overrides,
  } as User;
}

function makePage(overrides: Partial<SitePage> = {}): SitePage {
  return {
    id: "page-1",
    title: "Başlangıç Sayfası",
    slug: "baslangic-sayfasi",
    status: "DRAFT",
    editMode: "FREEFORM",
    blocks: [
      {
        id: "root-1",
        type: "container",
        settings: {
          layout: "boxed",
          direction: "column",
          justifyContent: "start",
          alignItems: "stretch",
          gap: 16,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
          background: { type: "none" },
        },
        children: [
          { id: "heading-1", type: "heading", data: { text: "Orijinal Başlık", level: 2, align: "left", underline: false } },
        ],
      },
    ],
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
 * (Vitest + jsdom + React 19) suspense retry'ı asla flush edilmiyor — React'in "usable"
 * protokolünü (`thenable.status === 'fulfilled'`) kullanan önceden-çözülmüş bir thenable ile
 * aşılır (bkz. `edit-page-scheduled-publish.test.tsx`'teki AYNI notun tekrarı).
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

describe("PageBuilderPage — standart kullanıcı kilidi editMode'dan bağımsızdır", () => {
  it("standart kullanıcı: FREEFORM sayfada BuilderCanvas MOUNT EDİLMEZ, TemplateEditorView görünür", async () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      user: makeUser({ canUseAdvancedBuilder: false }),
    } as ReturnType<typeof authContext.useAuth>);
    vi.mocked(pagesApi.getPage).mockResolvedValue(makePage({ editMode: "FREEFORM" }));
    vi.mocked(revisionsApi.listPageRevisions).mockResolvedValue({ items: [], meta: { nextCursor: null } });

    await renderPage();
    await screen.findByDisplayValue("Başlangıç Sayfası");

    // TemplateEditorView kanıtı — sade form açıklaması + "Bölüm 1" kartı.
    expect(
      screen.getByText("İçerik alanlarını doldurun — yapı bu şablonda sabittir.")
    ).toBeInTheDocument();
    expect(screen.getByText("Bölüm 1", { exact: true })).toBeInTheDocument();
    // `Field` (`components/ui/field.tsx`) zorunlu alanlarda etikete `*` işaretini AYNI metin
    // düğümüne ekler (`label.textContent === "Başlık metni*"`) — bu yüzden regex ile eşleşiyoruz.
    expect(screen.getByLabelText(/^Başlık metni/)).toHaveValue("Orijinal Başlık");

    // BuilderCanvas kanıtı YOK — sürükle tutamacı hiç render edilmemiş.
    expect(screen.queryAllByLabelText(/^Sürükle: /)).toHaveLength(0);
    expect(screen.queryByLabelText("Konteyner ayarları")).not.toBeInTheDocument();
  });

  it("standart kullanıcı: TEMPLATE sayfada da (mevcut davranışla tutarlı) TemplateEditorView görünür", async () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      user: makeUser({ canUseAdvancedBuilder: false }),
    } as ReturnType<typeof authContext.useAuth>);
    vi.mocked(pagesApi.getPage).mockResolvedValue(makePage({ editMode: "TEMPLATE" }));
    vi.mocked(revisionsApi.listPageRevisions).mockResolvedValue({ items: [], meta: { nextCursor: null } });

    await renderPage();
    await screen.findByDisplayValue("Başlangıç Sayfası");

    expect(
      screen.getByText("İçerik alanlarını doldurun — yapı bu şablonda sabittir.")
    ).toBeInTheDocument();
    expect(screen.queryAllByLabelText(/^Sürükle: /)).toHaveLength(0);
  });

  it("gelişmiş kullanıcı: FREEFORM sayfada BuilderCanvas görünür (regresyon kontrolü)", async () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      user: makeUser({ canUseAdvancedBuilder: true }),
    } as ReturnType<typeof authContext.useAuth>);
    vi.mocked(pagesApi.getPage).mockResolvedValue(makePage({ editMode: "FREEFORM" }));
    vi.mocked(revisionsApi.listPageRevisions).mockResolvedValue({ items: [], meta: { nextCursor: null } });

    await renderPage();
    await screen.findByDisplayValue("Başlangıç Sayfası");

    expect(
      screen.queryByText("İçerik alanlarını doldurun — yapı bu şablonda sabittir.")
    ).not.toBeInTheDocument();
    // BuilderCanvas kanıtı — konteyner + başlık için sürükle tutamaçları.
    expect(screen.getAllByLabelText(/^Sürükle: /).length).toBeGreaterThan(0);
  });

  it("gelişmiş kullanıcı: TEMPLATE sayfada da BuilderCanvas görünür (§5 madde 3 — mod gelişmiş kullanıcıyı kısıtlamaz)", async () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      user: makeUser({ canUseAdvancedBuilder: true }),
    } as ReturnType<typeof authContext.useAuth>);
    vi.mocked(pagesApi.getPage).mockResolvedValue(makePage({ editMode: "TEMPLATE" }));
    vi.mocked(revisionsApi.listPageRevisions).mockResolvedValue({ items: [], meta: { nextCursor: null } });

    await renderPage();
    await screen.findByDisplayValue("Başlangıç Sayfası");

    expect(screen.getAllByLabelText(/^Sürükle: /).length).toBeGreaterThan(0);
    expect(screen.getByText("Şablon Modu", { exact: true })).toBeInTheDocument();
  });
});
