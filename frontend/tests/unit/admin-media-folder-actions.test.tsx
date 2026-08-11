import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminMediaPage from "@/app/admin/media/page";
import type { Media, MediaFolder, Page } from "@/lib/api/types";

/**
 * §10.11 Medya Kütüphanesi — Klasör Sistemi + Gelişmiş Çoklu Seçim. Sayfa seviyesinde entegrasyon
 * testleri — qa-agent kullanıcı odak noktaları #2 (klasör silme sonrası UI güncellemesi) ve #3
 * (toplu taşıma), artı ek boşluk taraması (klasör değişince seçim temizlenir, arama kutusu
 * odaktayken Ctrl+A native davranışı bozmaz). backend-agent/frontend-agent'ın smoke testleri
 * (a11y-admin-media.test.tsx) bunları kapsamıyordu.
 */

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api/media", () => ({
  listMedia: vi.fn(),
  uploadMedia: vi.fn(),
  deleteMedia: vi.fn(),
  listMediaFolders: vi.fn(),
  createMediaFolder: vi.fn(),
  updateMediaFolder: vi.fn(),
  deleteMediaFolder: vi.fn(),
  moveMedia: vi.fn(),
}));

const mediaApi = await import("@/lib/api/media");

function makeMedia(overrides: Partial<Media> = {}): Media {
  return {
    id: "media-1",
    url: "https://example.com/media/urun.png",
    filename: "urun.png",
    mimeType: "image/png",
    sizeBytes: 1024,
    altText: null,
    width: null,
    height: null,
    folderId: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function toPage(items: Media[]): Page<Media> {
  return { items, meta: { nextCursor: null } };
}

/**
 * Klasör satırına tıklar — `getByRole("button", { name: /^X/ })` YETERSİZ çünkü aynı ⋮ menü
 * butonunun `aria-label`'ı da ("X için işlemler") AYNI önekle başlıyor ve regex'i belirsizleştirir.
 * Satırın kendi metin düğümünden (`<span>`) en yakın `<button>`'ı bulmak tektir.
 */
async function clickFolderRow(user: ReturnType<typeof userEvent.setup>, name: string) {
  const label = await screen.findByText(name, { selector: "span" });
  const button = label.closest("button");
  if (!button) throw new Error(`"${name}" klasör satırı butonu bulunamadı.`);
  await user.click(button);
}

describe("AdminMediaPage — klasör silme sonrası UI güncellemesi (§10.11.3, odak #2)", () => {
  it("seçili klasör silindiğinde: Tüm Dosyalar'a döner, içindeki görsel LİSTEDEN KAYBOLMAZ (Kategorisiz'e düşer)", async () => {
    const folder: MediaFolder = {
      id: "folder-1",
      name: "Ürün Görselleri",
      parentId: null,
      mediaCount: 1,
      createdAt: "2026-08-01T09:00:00.000Z",
    };
    let folderDeleted = false;

    vi.mocked(mediaApi.listMedia).mockImplementation(async (params) => {
      const item = makeMedia({ folderId: folderDeleted ? null : "folder-1" });
      if (params?.folderId === undefined) return toPage([item]);
      if (params.folderId === "folder-1") return toPage(folderDeleted ? [] : [item]);
      return toPage([]);
    });
    vi.mocked(mediaApi.listMediaFolders).mockImplementation(async () => (folderDeleted ? [] : [folder]));
    vi.mocked(mediaApi.deleteMediaFolder).mockImplementation(async () => {
      folderDeleted = true;
    });

    const user = userEvent.setup();
    render(<AdminMediaPage />);

    // Başlangıçta "Tüm Dosyalar" görünümünde görsel görünür.
    expect(await screen.findByText("urun.png")).toBeInTheDocument();

    // Klasöre gir (aktif görünüm artık "Ürün Görselleri").
    await clickFolderRow(user, "Ürün Görselleri");
    await waitFor(() => expect(mediaApi.listMedia).toHaveBeenCalledWith({ folderId: "folder-1" }));

    // Sol panelde ⋮ menüsünü aç, "Sil"e tıkla.
    await user.click(screen.getByRole("button", { name: "Ürün Görselleri için işlemler" }));
    await user.click(await screen.findByRole("menuitem", { name: "Sil" }));

    // Onay diyaloğu doğru sayısal etkiyi gösterir.
    const dialog = await screen.findByRole("dialog", { name: "Klasörü sil" });
    expect(within(dialog).getByText(/1 görsel Kategorisiz'e taşınacak/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Sil" }));

    await waitFor(() => expect(mediaApi.deleteMediaFolder).toHaveBeenCalledWith("folder-1"));

    // Klasör artık sol panelde YOK.
    await waitFor(() => expect(screen.queryByText("Ürün Görselleri")).not.toBeInTheDocument());

    // Görsel HÂLÂ listede — kaybolmadı, sadece Kategorisiz'e düştü.
    expect(await screen.findByText("urun.png")).toBeInTheDocument();
  });
});

describe("AdminMediaPage — toplu taşıma (§10.11.5, odak #3)", () => {
  it("'Klasöre Taşı' → hedef klasör seçilince moveMedia doğru argümanlarla çağrılır, seçim temizlenir, liste yenilenir", async () => {
    const folder: MediaFolder = {
      id: "folder-1",
      name: "Hedef Klasör",
      parentId: null,
      mediaCount: 0,
      createdAt: "2026-08-01T09:00:00.000Z",
    };
    const items = [makeMedia({ id: "media-a", filename: "a.png" }), makeMedia({ id: "media-b", filename: "b.png" })];

    vi.mocked(mediaApi.listMedia).mockResolvedValue(toPage(items));
    vi.mocked(mediaApi.listMediaFolders).mockResolvedValue([folder]);
    vi.mocked(mediaApi.moveMedia).mockResolvedValue({ folderId: folder.id, requestedCount: 1, movedCount: 1, skippedIds: [] });

    const user = userEvent.setup();
    render(<AdminMediaPage />);

    await screen.findByText("a.png");
    await user.click(screen.getByRole("checkbox", { name: "a.png öğesini seç" }));
    expect(await screen.findByText("1 seçili")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Klasöre Taşı/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Hedef Klasör" }));

    await waitFor(() => expect(mediaApi.moveMedia).toHaveBeenCalledWith(["media-a"], "folder-1"));

    // Seçim temizlenir — seçim çubuğu kaybolur.
    await waitFor(() => expect(screen.queryByText("1 seçili")).not.toBeInTheDocument());

    // Liste yenilenir — `moveMedia` sonrası `listMedia` en az bir kez daha çağrılmış olmalı.
    expect(vi.mocked(mediaApi.listMedia).mock.calls.length).toBeGreaterThan(1);
  });

  it("'Klasöre Taşı' → 'Kategorisiz' seçilince moveMedia folderId=null ile çağrılır", async () => {
    const folder: MediaFolder = {
      id: "folder-1",
      name: "Hedef Klasör",
      parentId: null,
      mediaCount: 0,
      createdAt: "2026-08-01T09:00:00.000Z",
    };
    const items = [makeMedia({ id: "media-a", filename: "a.png", folderId: "folder-1" })];

    vi.mocked(mediaApi.listMedia).mockResolvedValue(toPage(items));
    vi.mocked(mediaApi.listMediaFolders).mockResolvedValue([folder]);
    vi.mocked(mediaApi.moveMedia).mockResolvedValue({ folderId: null, requestedCount: 1, movedCount: 1, skippedIds: [] });

    const user = userEvent.setup();
    render(<AdminMediaPage />);

    await screen.findByText("a.png");
    await user.click(screen.getByRole("checkbox", { name: "a.png öğesini seç" }));
    await user.click(screen.getByRole("button", { name: /Klasöre Taşı/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Kategorisiz" }));

    await waitFor(() => expect(mediaApi.moveMedia).toHaveBeenCalledWith(["media-a"], null));
  });
});

describe("AdminMediaPage — ek boşluk taraması", () => {
  it("klasör değiştirildiğinde mevcut seçim TEMİZLENİR", async () => {
    const folder: MediaFolder = {
      id: "folder-1",
      name: "Başka Klasör",
      parentId: null,
      mediaCount: 0,
      createdAt: "2026-08-01T09:00:00.000Z",
    };
    const items = [makeMedia({ id: "media-a", filename: "a.png" })];

    vi.mocked(mediaApi.listMedia).mockResolvedValue(toPage(items));
    vi.mocked(mediaApi.listMediaFolders).mockResolvedValue([folder]);

    const user = userEvent.setup();
    render(<AdminMediaPage />);

    await screen.findByText("a.png");
    await user.click(screen.getByRole("checkbox", { name: "a.png öğesini seç" }));
    expect(await screen.findByText("1 seçili")).toBeInTheDocument();

    // Farklı bir klasöre geç.
    await clickFolderRow(user, "Başka Klasör");

    await waitFor(() => expect(screen.queryByText("1 seçili")).not.toBeInTheDocument());
  });

  it("arama kutusu odaktayken Ctrl+A sayfa geneli seçimi TETİKLEMEZ (native metin seçimi korunur)", async () => {
    const items = [
      makeMedia({ id: "media-a", filename: "a.png" }),
      makeMedia({ id: "media-b", filename: "b.png" }),
    ];
    vi.mocked(mediaApi.listMedia).mockResolvedValue(toPage(items));
    vi.mocked(mediaApi.listMediaFolders).mockResolvedValue([]);

    const user = userEvent.setup();
    render(<AdminMediaPage />);

    await screen.findByText("a.png");

    const searchInput = screen.getByRole("textbox", { name: "Dosya adına göre ara" });
    await user.click(searchInput);
    await user.keyboard("{Control>}a{/Control}");

    // Hiçbir öğe seçilmedi — toplu işlem çubuğu görünmemeli.
    expect(screen.queryByText(/seçili$/)).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "a.png öğesini seç" })).not.toBeChecked();
  });

  it("medya ızgarası odaktayken Ctrl+A o an görünen TÜM öğeleri seçer (arama kutusuyla kontrast)", async () => {
    const items = [
      makeMedia({ id: "media-a", filename: "a.png" }),
      makeMedia({ id: "media-b", filename: "b.png" }),
    ];
    vi.mocked(mediaApi.listMedia).mockResolvedValue(toPage(items));
    vi.mocked(mediaApi.listMediaFolders).mockResolvedValue([]);

    const user = userEvent.setup();
    render(<AdminMediaPage />);

    await screen.findByText("a.png");

    const grid = screen.getByRole("group", { name: "Medya ızgarası" });
    grid.focus();
    await user.keyboard("{Control>}a{/Control}");

    expect(await screen.findByText("2 seçili")).toBeInTheDocument();
  });
});
