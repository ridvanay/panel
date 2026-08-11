"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Image as ImageIcon, Search, UploadCloud } from "lucide-react";
import * as mediaApi from "@/lib/api/media";
import type { Media, MediaFolder } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { MediaFolderTree } from "@/components/admin/media/media-folder-tree";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import {
  ALL_FILES_SELECTION,
  toMediaFolderQueryParam,
  type MediaFolderSelection,
} from "@/lib/media-folder-tree";

interface MediaPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (media: Media) => void;
}

/**
 * Medya kütüphanesinden görsel seçmek (tek tıkla seç-ve-kapat) veya bilgisayardan yeni bir
 * görsel yükleyip otomatik seçmek için modal. Tasarım kararları: `.claude/design-notes-media-picker.md`
 * + `.claude/design-notes-media-folders.md` Karar 9 (sol sütun — klasör ağacının kompakt/salt-okunur
 * varyantı, `MediaFolderTree mode="picker"`).
 */
export function MediaPicker({ open, onOpenChange, onSelect }: MediaPickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Media[] | null>(null);
  // Karar 9 — "Tüm Dosyalar" seçiliyken çekilen TAM liste; sabit girişlerin (Tüm Dosyalar/
  // Kategorisiz) sayaç rozetleri İÇİN saklanır, kullanıcı başka bir klasöre geçse bile korunur.
  const [libraryMedia, setLibraryMedia] = useState<Media[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [folders, setFolders] = useState<MediaFolder[] | null>(null);
  const [foldersError, setFoldersError] = useState<string | null>(null);
  // Karar 9 — modal HER AÇILIŞTA "Tüm Dosyalar" ile başlar, önceki filtre state'ini hatırlamaz.
  const [selectedFolderId, setSelectedFolderId] = useState<MediaFolderSelection>(ALL_FILES_SELECTION);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const load = useCallback(async (folderId: MediaFolderSelection) => {
    setLoadError(null);
    try {
      const page = await mediaApi.listMedia({ folderId: toMediaFolderQueryParam(folderId) });
      setItems(page.items);
      if (folderId === ALL_FILES_SELECTION) setLibraryMedia(page.items);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  const loadFolders = useCallback(async () => {
    try {
      const list = await mediaApi.listMediaFolders();
      setFolders(list);
      setFoldersError(null);
    } catch (err) {
      setFoldersError(friendlyErrorMessage(err));
    }
  }, []);

  // Modal her açıldığında güncel listeyi VE klasör ağacını getirir — Karar 9 gereği HER ZAMAN
  // "Tüm Dosyalar" ile (kapanışta sıfırlanan `selectedFolderId`, bkz. `handleOpenChange`).
  useEffect(() => {
    if (!open) return;
    (async () => {
      await Promise.all([load(ALL_FILES_SELECTION), loadFolders()]);
    })();
  }, [open, load, loadFolders]);

  /** Karar 9 — satıra tıklamak = o klasöre filtrelemek; modal KAPANMAZ (seçim değil, filtre). */
  function handleSelectFolder(folderId: MediaFolderSelection) {
    setSelectedFolderId(folderId);
    void load(folderId);
  }

  // Modal kapanışında arama/hata/klasör filtresi durumunu sıfırlar ki bir sonraki açılışta temiz
  // başlasın (Karar 9 — "Tüm Dosyalar" varsayılanı).
  function handleOpenChange(next: boolean) {
    if (!next) {
      setQuery("");
      setUploadError(null);
      setSelectedFolderId(ALL_FILES_SELECTION);
    }
    onOpenChange(next);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploadError(null);
    setUploading(true);
    try {
      // §10.11.4 — modal bir klasör filtreliyken yüklenen görsel doğrudan o klasöre düşer.
      const uploadFolderId =
        selectedFolderId === ALL_FILES_SELECTION || selectedFolderId === "none" ? null : selectedFolderId;
      const media = await mediaApi.uploadMedia(file, uploadFolderId);
      onSelect(media);
      onOpenChange(false);
      toast.success("Görsel yüklendi.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setUploadError(message);
      toast.error(message);
    } finally {
      setUploading(false);
    }
  }

  function handlePick(media: Media) {
    onSelect(media);
    onOpenChange(false);
  }

  const normalizedQuery = query.trim().toLowerCase();
  const filteredItems = items?.filter((media) => media.filename.toLowerCase().includes(normalizedQuery)) ?? null;
  const totalCount = libraryMedia?.length ?? 0;
  const uncategorizedCount = libraryMedia?.filter((m) => m.folderId === null).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* Karar 9 (design-notes-media-folders.md) — `max-w-3xl` → `max-w-4xl`: sol klasör sütunu eklendiği için grid sıkışmasın. */}
      <DialogContent className="max-w-4xl p-0 gap-0">
        <div className="flex max-h-[85vh] flex-col">
          <DialogHeader className="p-4 pb-3">
            <DialogTitle>Görsel Seç</DialogTitle>
            <DialogDescription>Kütüphaneden bir görsel seçin veya yeni bir görsel yükleyin.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 pb-3">
            <InputGroup className="w-full sm:max-w-xs">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="Dosya adına göre ara…"
                aria-label="Dosya adına göre ara"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </InputGroup>
            <Button type="button" variant="secondary" loading={uploading} onClick={() => fileInputRef.current?.click()}>
              <UploadCloud className="h-4 w-4" />
              Yükle
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              aria-label="Bilgisayardan görsel yükle"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {uploadError && (
            <div className="px-4 pt-3">
              <Alert variant="error">{uploadError}</Alert>
            </div>
          )}

          {/* Karar 9 — içerik alanı yatay olarak ikiye bölünür: sol kompakt klasör ağacı + sağ grid. */}
          <div className="flex min-h-[320px] flex-1 overflow-hidden">
            <div className="w-44 shrink-0 overflow-y-auto border-r border-border p-2">
              {foldersError ? (
                <div className="space-y-2">
                  <Alert variant="error">{foldersError}</Alert>
                  <Button type="button" variant="outline" size="sm" onClick={() => loadFolders()}>
                    Tekrar dene
                  </Button>
                </div>
              ) : folders === null ? (
                <div className="flex justify-center py-6">
                  <Spinner className="h-5 w-5 text-primary" />
                </div>
              ) : (
                <MediaFolderTree
                  mode="picker"
                  folders={folders}
                  selectedFolderId={selectedFolderId}
                  onSelectFolder={handleSelectFolder}
                  totalCount={totalCount}
                  uncategorizedCount={uncategorizedCount}
                  onFoldersChange={loadFolders}
                />
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {loadError ? (
                <div className="space-y-3">
                  <Alert variant="error">{loadError}</Alert>
                  <Button type="button" variant="outline" size="sm" onClick={() => load(selectedFolderId)}>
                    Tekrar dene
                  </Button>
                </div>
              ) : items === null ? (
                <div className="flex justify-center py-12">
                  <Spinner className="h-6 w-6 text-primary" />
                </div>
              ) : items.length === 0 ? (
                <EmptyState
                  icon={ImageIcon}
                  title="Henüz görsel yüklenmedi"
                  description="Bilgisayarınızdan bir görsel yükleyerek başlayın."
                  action={
                    <Button type="button" onClick={() => fileInputRef.current?.click()}>
                      Görsel Yükle
                    </Button>
                  }
                />
              ) : filteredItems && filteredItems.length === 0 ? (
                <EmptyState
                  icon={Search}
                  title="Sonuç bulunamadı"
                  description={`"${query}" ile eşleşen bir görsel yok.`}
                  className="border-none p-8"
                />
              ) : (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {filteredItems!.map((media) => (
                    <button
                      key={media.id}
                      type="button"
                      onClick={() => handlePick(media)}
                      aria-label={`${media.filename} seç`}
                      title={media.filename}
                      className="aspect-square overflow-hidden rounded-lg border border-border transition hover:scale-[1.03] hover:ring-2 hover:ring-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- yüklenen/harici görsel URL'si, next/image remotePatterns henüz tanımlı değil */}
                      <img src={media.url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
