import type { MediaFolder } from "@/lib/api/types";

/**
 * §10.11 Medya Kütüphanesi — Klasör Sistemi. Sabit seçim değerleri — gerçek klasör id'leri her
 * zaman UUID formatındadır, bu yüzden bu iki sabitle asla çakışmazlar. "Kategorisiz" bir klasör
 * KAYDI DEĞİLDİR (`folderId IS NULL`'ın ta kendisidir, bkz. ARCHITECTURE.md §10.11.1) — bu yüzden
 * `MediaFolder[]` listesinde YER ALMAZ, yalnızca bir seçim/filtre değeridir.
 */
export const ALL_FILES_SELECTION = "all" as const;
export const UNCATEGORIZED_SELECTION = "none" as const;

/** Panelde seçili "klasör" — sabit girişlerden biri ya da gerçek bir `MediaFolder.id` (UUID). */
export type MediaFolderSelection = typeof ALL_FILES_SELECTION | typeof UNCATEGORIZED_SELECTION | (string & {});

export interface MediaFolderNode {
  folder: MediaFolder;
  /** Doğrudan çocukları — derinlik en fazla 2 olduğu için bunların KENDİ çocuğu olamaz. */
  children: MediaFolder[];
}

/**
 * Düz `MediaFolder[]` dizisinden tek geçişte ağaç kurar (kök + doğrudan çocuklar). Sunucu zaten
 * `(parentId NULLS FIRST, name ASC)` sıralı döndüğü için ek bir sıralama gerekmez (bkz.
 * ARCHITECTURE.md §10.11.1). `admin/media/page.tsx` ve `MediaPicker` AYNI fonksiyonu paylaşır —
 * ağaç kurma mantığı iki yerde ayrı ayrı YAZILMAZ.
 */
export function buildMediaFolderTree(folders: MediaFolder[]): MediaFolderNode[] {
  const roots = folders.filter((folder) => folder.parentId === null);
  return roots.map((folder) => ({
    folder,
    children: folders.filter((child) => child.parentId === folder.id),
  }));
}

export interface FlatMediaFolderOption {
  id: string;
  name: string;
  depth: 0 | 1;
}

/** "Klasöre Taşı" gibi düz (girintili) menü listeleri için — kök klasör, ardından çocukları. */
export function flattenMediaFolders(folders: MediaFolder[]): FlatMediaFolderOption[] {
  const tree = buildMediaFolderTree(folders);
  const flat: FlatMediaFolderOption[] = [];
  for (const node of tree) {
    flat.push({ id: node.folder.id, name: node.folder.name, depth: 0 });
    for (const child of node.children) {
      flat.push({ id: child.id, name: child.name, depth: 1 });
    }
  }
  return flat;
}

/** Panel seçimini `GET /admin/media?folderId=` sorgu değerine çevirir — "all" filtresizlik demektir. */
export function toMediaFolderQueryParam(selection: MediaFolderSelection): string | undefined {
  return selection === ALL_FILES_SELECTION ? undefined : selection;
}
