import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MediaFolderTree } from "@/components/admin/media/media-folder-tree";
import type { MediaFolder } from "@/lib/api/types";
import { ALL_FILES_SELECTION } from "@/lib/media-folder-tree";

/**
 * §10.11.3 Silme semantiği — qa-agent odak noktası #2. Backend-agent'ın `media.test.ts` testleri
 * FK `onDelete: SetNull` yan etkisini (Kategorisiz'e düşme/köke çıkma) DB seviyesinde zaten
 * doğruluyor (bkz. media.test.ts "ADMIN klasörü siler..."). Bu dosya FRONTEND tarafını kapatır:
 * onay diyaloğundaki sayısal etki metni doğru mu, ve silme sonrası "seçili klasör silindiyse Tüm
 * Dosyalar'a dön" davranışı doğru tetikleniyor mu (bkz. media-folder-tree.tsx::handleDeleteFolder).
 */

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api/media", () => ({
  createMediaFolder: vi.fn(),
  updateMediaFolder: vi.fn(),
  deleteMediaFolder: vi.fn(),
}));

const mediaApi = await import("@/lib/api/media");

function makeFolder(overrides: Partial<MediaFolder> = {}): MediaFolder {
  return {
    id: "folder-1",
    name: "Ürün Görselleri",
    parentId: null,
    mediaCount: 0,
    createdAt: "2026-08-01T09:00:00.000Z",
    ...overrides,
  };
}

async function openDeleteDialog(folderLabel: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: `${folderLabel} için işlemler` }));
  await user.click(await screen.findByRole("menuitem", { name: "Sil" }));
  return { user, dialog: await screen.findByRole("dialog", { name: "Klasörü sil" }) };
}

describe("MediaFolderTree — klasör silme (§10.11.3)", () => {
  it("alt klasörü olmayan bir klasör için sadece görsel sayısını gösterir", async () => {
    const folder = makeFolder({ mediaCount: 3 });
    render(
      <MediaFolderTree
        folders={[folder]}
        selectedFolderId={ALL_FILES_SELECTION}
        onSelectFolder={vi.fn()}
        totalCount={3}
        uncategorizedCount={0}
        onFoldersChange={vi.fn()}
      />
    );

    const { dialog } = await openDeleteDialog("Ürün Görselleri");
    expect(within(dialog).getByText('"Ürün Görselleri" klasörünü silmek istediğinize emin misiniz? 3 görsel Kategorisiz\'e taşınacak.')).toBeInTheDocument();
    // Alt klasör yok — "alt klasör en üst seviyeye çıkacak" metni GÖRÜNMEMELİ.
    expect(within(dialog).queryByText(/alt klasör/)).not.toBeInTheDocument();
  });

  it("0 görsel için de doğru sayıyı gösterir (tekil/çoğul ayrımı yapılmaz, sabit metin)", async () => {
    const folder = makeFolder({ mediaCount: 0 });
    render(
      <MediaFolderTree
        folders={[folder]}
        selectedFolderId={ALL_FILES_SELECTION}
        onSelectFolder={vi.fn()}
        totalCount={0}
        uncategorizedCount={0}
        onFoldersChange={vi.fn()}
      />
    );

    const { dialog } = await openDeleteDialog("Ürün Görselleri");
    expect(within(dialog).getByText(/^"Ürün Görselleri" klasörünü silmek istediğinize emin misiniz\? 0 görsel Kategorisiz'e taşınacak\.$/)).toBeInTheDocument();
  });

  it("alt klasörü olan bir klasör için hem görsel hem alt klasör sayısını gösterir", async () => {
    const root = makeFolder({ id: "root", name: "Kök", mediaCount: 2 });
    const child = makeFolder({ id: "child", name: "Alt", parentId: "root", mediaCount: 0 });
    render(
      <MediaFolderTree
        folders={[root, child]}
        selectedFolderId={ALL_FILES_SELECTION}
        onSelectFolder={vi.fn()}
        totalCount={2}
        uncategorizedCount={0}
        onFoldersChange={vi.fn()}
      />
    );

    const { dialog } = await openDeleteDialog("Kök");
    expect(
      within(dialog).getByText('"Kök" klasörünü silmek istediğinize emin misiniz? 2 görsel Kategorisiz\'e taşınacak, 1 alt klasör en üst seviyeye çıkacak.')
    ).toBeInTheDocument();
  });

  it("SEÇİLİ klasör silinince Tüm Dosyalar'a dönülür (onSelectFolder çağrılır) ve liste yenilenir", async () => {
    vi.mocked(mediaApi.deleteMediaFolder).mockResolvedValue(undefined);
    const onSelectFolder = vi.fn();
    const onFoldersChange = vi.fn().mockResolvedValue(undefined);
    const folder = makeFolder({ mediaCount: 1 });

    render(
      <MediaFolderTree
        folders={[folder]}
        selectedFolderId={folder.id}
        onSelectFolder={onSelectFolder}
        totalCount={1}
        uncategorizedCount={0}
        onFoldersChange={onFoldersChange}
      />
    );

    const { user, dialog } = await openDeleteDialog("Ürün Görselleri");
    await user.click(within(dialog).getByRole("button", { name: "Sil" }));

    expect(mediaApi.deleteMediaFolder).toHaveBeenCalledWith(folder.id);
    expect(onSelectFolder).toHaveBeenCalledWith(ALL_FILES_SELECTION);
    expect(onFoldersChange).toHaveBeenCalled();
  });

  it("SEÇİLİ OLMAYAN bir klasör silinince onSelectFolder çağrılmaz, sadece liste yenilenir", async () => {
    vi.mocked(mediaApi.deleteMediaFolder).mockResolvedValue(undefined);
    const onSelectFolder = vi.fn();
    const onFoldersChange = vi.fn().mockResolvedValue(undefined);
    const folder = makeFolder({ mediaCount: 1 });

    render(
      <MediaFolderTree
        folders={[folder]}
        selectedFolderId={ALL_FILES_SELECTION}
        onSelectFolder={onSelectFolder}
        totalCount={1}
        uncategorizedCount={0}
        onFoldersChange={onFoldersChange}
      />
    );

    const { user, dialog } = await openDeleteDialog("Ürün Görselleri");
    await user.click(within(dialog).getByRole("button", { name: "Sil" }));

    expect(mediaApi.deleteMediaFolder).toHaveBeenCalledWith(folder.id);
    expect(onSelectFolder).not.toHaveBeenCalled();
    expect(onFoldersChange).toHaveBeenCalled();
  });
});
