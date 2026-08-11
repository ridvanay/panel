"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  AlertCircle,
  Copy,
  Download,
  Folder,
  FolderInput,
  FolderMinus,
  FolderOpen,
  FolderTree,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Search,
  UploadCloud,
} from "lucide-react";
import * as mediaApi from "@/lib/api/media";
import type { Media, MediaFolder } from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/select";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MediaPreviewDialog } from "@/components/admin/media-preview-dialog";
import { MediaListTable } from "@/components/admin/media/media-list-table";
import { MediaFolderTree } from "@/components/admin/media/media-folder-tree";
import { PageHeading } from "@/components/admin/page-heading";
import { ListPagination } from "@/components/admin/list-pagination";
import { useFilteredList } from "@/hooks/use-filtered-list";
import { useMultiSelect } from "@/hooks/use-multi-select";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { exportToCsv } from "@/lib/export-csv";
import { cn } from "@/lib/cn";
import {
  ALL_FILES_SELECTION,
  UNCATEGORIZED_SELECTION,
  flattenMediaFolders,
  type MediaFolderSelection,
} from "@/lib/media-folder-tree";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type FileTypeFilter = "all" | "image/jpeg" | "image/png" | "image/webp" | "image/gif";
type DateRangeFilter = "all" | "today" | "7d" | "30d" | "year";

/** Tarih aralığı filtresi — `createdAt` verilen aralığa düşüyor mu (yerel saat dilimine göre takvim günü/yılı). */
function isWithinDateRange(createdAt: string, range: DateRangeFilter): boolean {
  const created = new Date(createdAt);
  const now = new Date();

  if (range === "today") {
    return (
      created.getFullYear() === now.getFullYear() &&
      created.getMonth() === now.getMonth() &&
      created.getDate() === now.getDate()
    );
  }
  if (range === "7d") {
    return now.getTime() - created.getTime() <= 7 * 86400000;
  }
  if (range === "30d") {
    return now.getTime() - created.getTime() <= 30 * 86400000;
  }
  if (range === "year") {
    return created.getFullYear() === now.getFullYear();
  }
  return true;
}

interface UploadProgress {
  total: number;
  done: number;
}

const galleryContainerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04 },
  },
};

const galleryItemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

export default function AdminMediaPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const colorCanvasRef = useRef<HTMLCanvasElement>(null);
  const requestedColorIdsRef = useRef<Set<string>>(new Set());

  // §10.11 Medya Kütüphanesi — Klasör Sistemi. `libraryMedia` folderId'siz TAM listedir (yalnızca
  // "Tüm Dosyalar"/"Kategorisiz" sayaçları İÇİN tutulur); `folderItems` yalnızca gerçek bir
  // klasör/"Kategorisiz" seçiliyken AYRI bir sunucu isteğiyle doldurulur (folderId SUNUCU
  // taraflı filtredir, bkz. ARCHITECTURE.md §10.11.2). `selectedFolder === "all"` iken ekranda
  // `libraryMedia` gösterilir — aynı veri iki kez çekilmez.
  const [libraryMedia, setLibraryMedia] = useState<Media[] | null>(null);
  const [folderItems, setFolderItems] = useState<Media[] | null>(null);
  const [folders, setFolders] = useState<MediaFolder[] | null>(null);
  const [foldersError, setFoldersError] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<MediaFolderSelection>(ALL_FILES_SELECTION);
  const [folderSheetOpen, setFolderSheetOpen] = useState(false);

  const items = selectedFolder === ALL_FILES_SELECTION ? libraryMedia : folderItems;

  const [dominantColors, setDominantColors] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Media | null>(null);
  const [previewMedia, setPreviewMedia] = useState<Media | null>(null);

  // Toplu işlemler için gelişmiş çoklu seçim (§10.11.5) — shift/ctrl/cmd/Ctrl+A, Grid ve Liste
  // görünümleri arasında PAYLAŞILAN tek hook.
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Araç çubuğu: tür/tarih filtresi + görünüm — arama/sayfalama `useFilteredList` üzerinden.
  const [fileTypeFilter, setFileTypeFilter] = useState<FileTypeFilter>("all");
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>("all");
  const [view, setView] = useState<"grid" | "list">("grid");

  const preFiltered = useMemo(() => {
    if (!items) return null;
    return items.filter((m) => {
      if (fileTypeFilter !== "all" && m.mimeType !== fileTypeFilter) return false;
      if (dateRangeFilter !== "all" && !isWithinDateRange(m.createdAt, dateRangeFilter)) return false;
      return true;
    });
  }, [items, fileTypeFilter, dateRangeFilter]);

  const list = useFilteredList(preFiltered, (media, query) => media.filename.toLowerCase().includes(query));
  const visibleIds = useMemo(() => list.items.map((m) => m.id), [list.items]);
  const multiSelect = useMultiSelect(visibleIds);

  // 6 sütun × 4 satırlık bir ızgara sayfası dolduracak şekilde varsayılan sayfa boyutunu override et.
  useEffect(() => {
    list.setPageSize(24);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnızca mount'ta bir kez çalışmalı
  }, []);

  const allSelected = list.items.length > 0 && list.items.every((m) => multiSelect.selectedIds.has(m.id));

  const loadLibrary = useCallback(async () => {
    try {
      const page = await mediaApi.listMedia();
      setLibraryMedia(page.items);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  const loadFolderItems = useCallback(async (folderId: string) => {
    try {
      const page = await mediaApi.listMedia({ folderId });
      setFolderItems(page.items);
    } catch (err) {
      setError(friendlyErrorMessage(err));
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

  /** Yükleme/silme/taşıma gibi mutasyonlardan sonra sayaçları VE aktif görünümü birlikte tazeler. */
  const refreshMediaAndFolders = useCallback(async () => {
    setError(null);
    await Promise.all([
      loadLibrary(),
      selectedFolder === ALL_FILES_SELECTION ? Promise.resolve() : loadFolderItems(selectedFolder),
      loadFolders(),
    ]);
  }, [loadLibrary, loadFolderItems, loadFolders, selectedFolder]);

  useEffect(() => {
    (async () => {
      await Promise.all([loadLibrary(), loadFolders()]);
    })();
  }, [loadLibrary, loadFolders]);

  // Klasör seçimi değiştiğinde (Kategorisiz ya da gerçek bir klasör) sunucudan AYRI bir istekle
  // yeniden çeker — folderId SUNUCU taraflı bir filtredir (bkz. ARCHITECTURE.md §10.11.2).
  useEffect(() => {
    if (selectedFolder === ALL_FILES_SELECTION) return;
    (async () => {
      await loadFolderItems(selectedFolder);
    })();
  }, [selectedFolder, loadFolderItems]);

  function selectFolder(selection: MediaFolderSelection) {
    setSelectedFolder(selection);
    // Klasör değişince seçim state'i temizlenir — görünmeyen öğeler üzerinde toplu işlem yapılmasını önler.
    multiSelect.clear();
    if (selection !== ALL_FILES_SELECTION) setFolderItems(null);
  }

  const totalCount = libraryMedia?.length ?? 0;
  const uncategorizedCount = libraryMedia?.filter((m) => m.folderId === null).length ?? 0;
  const flatFolders = useMemo(() => flattenMediaFolders(folders ?? []), [folders]);

  const activeFolderLabel =
    selectedFolder === ALL_FILES_SELECTION
      ? "Tüm Dosyalar"
      : selectedFolder === UNCATEGORIZED_SELECTION
        ? "Kategorisiz"
        : (folders?.find((f) => f.id === selectedFolder)?.name ?? "Klasör");
  const activeFolderCount =
    selectedFolder === ALL_FILES_SELECTION
      ? totalCount
      : selectedFolder === UNCATEGORIZED_SELECTION
        ? uncategorizedCount
        : (folders?.find((f) => f.id === selectedFolder)?.mediaCount ?? 0);

  // §10.11.4 — bir klasörün içindeyken yüklenen görsel doğrudan o klasöre düşer ("Tüm Dosyalar"/
  // "Kategorisiz" seçiliyken `null` = Kategorisiz, mevcut davranışla birebir aynı).
  const uploadFolderId =
    selectedFolder === ALL_FILES_SELECTION || selectedFolder === UNCATEGORIZED_SELECTION ? null : selectedFolder;

  // Her medya öğesi için baskın rengi paylaşılan, gizli bir canvas üzerinden hesapla.
  useEffect(() => {
    if (!items) return;
    for (const media of items) {
      if (requestedColorIdsRef.current.has(media.id)) continue;
      requestedColorIdsRef.current.add(media.id);

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = colorCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = 10;
        canvas.height = 10;
        ctx.drawImage(img, 0, 0, 10, 10);
        try {
          const data = ctx.getImageData(0, 0, 10, 10).data;
          let r = 0;
          let g = 0;
          let b = 0;
          let count = 0;
          for (let i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count += 1;
          }
          const hex = `#${[r, g, b]
            .map((c) => Math.round(c / count).toString(16).padStart(2, "0"))
            .join("")}`;
          setDominantColors((prev) => ({ ...prev, [media.id]: hex }));
        } catch {
          // CORS nedeniyle canvas "tainted" olduysa güvenli şekilde vazgeç, sahte renk gösterme.
          setDominantColors((prev) => ({ ...prev, [media.id]: null }));
        }
      };
      img.onerror = () => {
        setDominantColors((prev) => ({ ...prev, [media.id]: null }));
      };
      img.src = media.url;
    }
  }, [items]);

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    const skippedCount = files.length - imageFiles.length;
    if (skippedCount > 0) {
      toast.error(
        skippedCount === 1
          ? "1 dosya görsel formatında olmadığı için atlandı."
          : `${skippedCount} dosya görsel formatında olmadığı için atlandı.`
      );
    }
    if (imageFiles.length === 0) return;

    setUploading(true);
    setUploadProgress({ total: imageFiles.length, done: 0 });
    setError(null);

    let successCount = 0;
    let failCount = 0;

    for (const file of imageFiles) {
      try {
        await mediaApi.uploadMedia(file, uploadFolderId);
        successCount += 1;
      } catch (err) {
        failCount += 1;
        setError(friendlyErrorMessage(err));
      } finally {
        setUploadProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
      }
    }

    setUploading(false);
    setUploadProgress(null);

    if (successCount > 0 && failCount === 0) {
      toast.success(successCount === 1 ? "1 görsel yüklendi." : `${successCount} görsel yüklendi.`);
    } else if (successCount > 0 && failCount > 0) {
      toast.success(`${successCount} görsel yüklendi, ${failCount} görsel başarısız oldu.`);
    } else if (failCount > 0) {
      toast.error(failCount === 1 ? "Görsel yüklenemedi." : `${failCount} görsel yüklenemedi.`);
    }

    if (successCount > 0) {
      await refreshMediaAndFolders();
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    // `event.target.files` input'un YAŞAYAN (live) FileList'ine bir referans — aşağıdaki
    // `event.target.value = ""` bu seçimi temizlerken AYNI referansı da boşaltıyordu (length 0
    // oluyordu), bu yüzden dosyalar bir diziye kopyalanıp değeri SIFIRLAMADAN ÖNCE ayrıştırılıyor.
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    await handleFiles(files);
  }

  function handleDragEnter(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    dragCounterRef.current += 1;
    if (event.dataTransfer.types.includes("Files")) {
      setDragActive(true);
    }
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    dragCounterRef.current = Math.max(dragCounterRef.current - 1, 0);
    if (dragCounterRef.current === 0) {
      setDragActive(false);
    }
  }

  async function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    dragCounterRef.current = 0;
    setDragActive(false);
    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      await handleFiles(files);
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    const mediaId = pendingDelete.id;
    setDeletingId(mediaId);
    try {
      await mediaApi.deleteMedia(mediaId);
      toast.success("Görsel silindi.");
      setPendingDelete(null);
      await refreshMediaAndFolders();
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCopy(url: string) {
    await navigator.clipboard.writeText(url);
    toast.success("Görsel URL'si kopyalandı.");
  }

  async function handleBulkDelete() {
    const ids = Array.from(multiSelect.selectedIds);
    setBulkDeleting(true);
    let successCount = 0;
    let failCount = 0;

    for (const id of ids) {
      try {
        await mediaApi.deleteMedia(id);
        successCount += 1;
      } catch {
        failCount += 1;
      }
    }

    setBulkDeleting(false);
    setBulkDeleteConfirmOpen(false);
    multiSelect.clear();
    await refreshMediaAndFolders();

    if (successCount > 0 && failCount === 0) {
      toast.success(successCount === 1 ? "1 görsel silindi." : `${successCount} görsel silindi.`);
    } else if (successCount > 0 && failCount > 0) {
      toast.success(`${successCount} görsel silindi, ${failCount} görsel silinemedi.`);
    } else if (failCount > 0) {
      toast.error(failCount === 1 ? "Görsel silinemedi." : `${failCount} görsel silinemedi.`);
    }
  }

  /** Karar 6 (design-notes-media-folders.md) — seçim çubuğundaki "Klasöre Taşı". */
  async function handleBulkMove(folderId: string | null) {
    const ids = Array.from(multiSelect.selectedIds);
    if (ids.length === 0) return;
    try {
      const result = await mediaApi.moveMedia(ids, folderId);
      toast.success(result.movedCount === 1 ? "1 görsel taşındı." : `${result.movedCount} görsel taşındı.`);
      multiSelect.clear();
      await refreshMediaAndFolders();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    }
  }

  function handleBulkExport() {
    if (!items) return;
    const selectedItems = items.filter((m) => multiSelect.selectedIds.has(m.id));
    if (selectedItems.length === 0) return;
    exportToCsv("secili-medya.csv", selectedItems, [
      { key: "filename", label: "Dosya Adı" },
      { key: "sizeBytes", label: "Boyut", format: (value) => formatSize(value as number) },
      { key: "url", label: "URL" },
    ]);
  }

  const pendingPlaceholderCount = uploadProgress ? Math.max(uploadProgress.total - uploadProgress.done, 0) : 0;
  const isEmptyLibrary = items !== null && items.length === 0 && selectedFolder === ALL_FILES_SELECTION;
  const isEmptyFolder = items !== null && items.length === 0 && selectedFolder !== ALL_FILES_SELECTION;

  function folderPanelContent() {
    if (foldersError) {
      return (
        <div className="space-y-3">
          <Alert variant="error">{foldersError}</Alert>
          <Button type="button" variant="outline" size="sm" onClick={() => loadFolders()}>
            Tekrar dene
          </Button>
        </div>
      );
    }
    if (folders === null) {
      return (
        <div className="flex justify-center py-6">
          <Spinner className="h-5 w-5 text-primary" />
        </div>
      );
    }
    return (
      <MediaFolderTree
        folders={folders}
        selectedFolderId={selectedFolder}
        onSelectFolder={selectFolder}
        totalCount={totalCount}
        uncategorizedCount={uncategorizedCount}
        onFoldersChange={refreshMediaAndFolders}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeading
        icon={ImageIcon}
        title="Medya Kütüphanesi"
        description="Yüklenen görseller ve dosyalar."
        actions={
          <>
            <Button loading={uploading} onClick={() => fileInputRef.current?.click()}>
              Görsel yükle
            </Button>
            <input
              ref={fileInputRef}
              id="media-upload-input"
              type="file"
              accept="image/*"
              multiple
              aria-label="Bilgisayardan görsel yükle"
              className="hidden"
              onChange={handleFileChange}
            />
          </>
        }
      />

      {error && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </span>
        </Alert>
      )}

      <label
        htmlFor="media-upload-input"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-all duration-300",
          dragActive
            ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
            : "border-border/70 bg-surface/70 backdrop-blur-xl hover:border-primary/50 hover:bg-muted/40"
        )}
      >
        <span
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-full transition-colors",
            dragActive ? "bg-primary/10 text-primary" : "bg-muted text-foreground/50"
          )}
        >
          <UploadCloud className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Görselleri buraya sürükleyin</p>
          <p className="text-sm text-foreground/60">veya tıklayıp bilgisayarınızdan seçin</p>
        </div>
        {uploadProgress && (
          <p className="text-xs font-medium text-primary">
            {uploadProgress.done}/{uploadProgress.total} yüklendi
          </p>
        )}
      </label>

      {/* Karar 1 (design-notes-media-folders.md) — iki sütunlu kabuk: sol panel (masaüstü sabit,
          mobil Sheet), sağ panel mevcut araç çubuğu + seçim çubuğu + grid/liste + sayfalama. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="hidden lg:block lg:sticky lg:top-6 lg:w-64 lg:shrink-0">{folderPanelContent()}</div>

        <div className="min-w-0 flex-1 space-y-6">
          <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="lg:hidden"
                aria-label="Klasörleri göster"
                onClick={() => setFolderSheetOpen(true)}
              >
                <FolderTree className="h-4 w-4" />
                {activeFolderLabel}
                <Badge tone="neutral" size="sm">
                  {activeFolderCount}
                </Badge>
              </Button>
              <Select
                aria-label="Dosya türüne göre filtrele"
                className="w-full sm:w-40"
                value={fileTypeFilter}
                onChange={(e) => setFileTypeFilter(e.target.value as FileTypeFilter)}
              >
                <option value="all">Tüm türler</option>
                <option value="image/jpeg">JPEG</option>
                <option value="image/png">PNG</option>
                <option value="image/webp">WEBP</option>
                <option value="image/gif">GIF</option>
              </Select>
              <Select
                aria-label="Yükleme tarihine göre filtrele"
                className="w-full sm:w-40"
                value={dateRangeFilter}
                onChange={(e) => setDateRangeFilter(e.target.value as DateRangeFilter)}
              >
                <option value="all">Tüm zamanlar</option>
                <option value="today">Bugün</option>
                <option value="7d">Son 7 gün</option>
                <option value="30d">Son 30 gün</option>
                <option value="year">Bu yıl</option>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <div
                role="group"
                aria-label="Görünüm seçimi"
                className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-muted p-0.5"
              >
                <Button
                  type="button"
                  variant={view === "grid" ? "secondary" : "ghost"}
                  size="icon-sm"
                  aria-label="Izgara görünümü"
                  aria-pressed={view === "grid"}
                  className={view === "grid" ? "bg-card text-foreground shadow-sm" : "text-foreground/50"}
                  onClick={() => setView("grid")}
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant={view === "list" ? "secondary" : "ghost"}
                  size="icon-sm"
                  aria-label="Liste görünümü"
                  aria-pressed={view === "list"}
                  className={view === "list" ? "bg-card text-foreground shadow-sm" : "text-foreground/50"}
                  onClick={() => setView("list")}
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>
              <InputGroup className="w-full sm:max-w-xs">
                <InputGroupAddon>
                  <Search />
                </InputGroupAddon>
                <InputGroupInput
                  placeholder="Dosya adına göre ara…"
                  aria-label="Dosya adına göre ara"
                  value={list.search}
                  onChange={(e) => list.setSearch(e.target.value)}
                />
              </InputGroup>
            </div>
          </div>

          {multiSelect.selectedIds.size > 0 && (
            <Card className="flex flex-wrap items-center gap-3 p-4">
              <span className="text-sm font-medium text-foreground">{multiSelect.selectedIds.size} seçili</span>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="destructive" size="sm" onClick={() => setBulkDeleteConfirmOpen(true)}>
                  Toplu Sil
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" />}>
                    <FolderInput className="h-4 w-4" />
                    Klasöre Taşı
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => handleBulkMove(null)}>
                      <FolderMinus className="h-4 w-4" /> Kategorisiz
                    </DropdownMenuItem>
                    {flatFolders.length > 0 && <DropdownMenuSeparator />}
                    {flatFolders.map((f) => (
                      <DropdownMenuItem key={f.id} onClick={() => handleBulkMove(f.id)} className={f.depth === 1 ? "pl-6" : undefined}>
                        <Folder className="h-4 w-4" /> {f.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="outline" size="sm" onClick={handleBulkExport}>
                  <Download className="h-4 w-4" />
                  CSV Dışa Aktar
                </Button>
              </div>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => multiSelect.clear()}>
                Seçimi Temizle
              </Button>
            </Card>
          )}

          {items === null && error ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <p className="text-sm text-foreground/70">Medya yüklenemedi.</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => (selectedFolder === ALL_FILES_SELECTION ? loadLibrary() : loadFolderItems(selectedFolder))}
              >
                Tekrar dene
              </Button>
            </div>
          ) : items === null ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-6 w-6 text-primary" />
            </div>
          ) : isEmptyLibrary && pendingPlaceholderCount === 0 ? (
            <EmptyState
              icon={ImageIcon}
              title="Henüz görsel yüklenmedi"
              description="Yukarıdaki alana sürükleyip bırakarak veya tıklayarak görsel yükleyebilirsiniz."
            />
          ) : isEmptyFolder && pendingPlaceholderCount === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="Bu klasörde görsel yok"
              description="Görselleri buraya yükleyerek veya başka bir klasörden taşıyarak ekleyebilirsiniz."
              action={
                <Button type="button" onClick={() => fileInputRef.current?.click()}>
                  Görsel Yükle
                </Button>
              }
            />
          ) : list.filteredCount === 0 && pendingPlaceholderCount === 0 ? (
            <EmptyState
              icon={Search}
              title="Sonuç bulunamadı"
              description={
                list.search ? `"${list.search}" ile eşleşen bir görsel yok.` : "Seçili filtrelerle eşleşen bir görsel yok."
              }
            />
          ) : (
            <div
              role="group"
              aria-label="Medya ızgarası"
              tabIndex={0}
              className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onKeyDown={multiSelect.handleGridKeyDown}
            >
              {view === "grid" ? (
                <motion.div
                  className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
                  variants={galleryContainerVariants}
                  initial="hidden"
                  animate="visible"
                >
                  {Array.from({ length: pendingPlaceholderCount }).map((_, index) => (
                    <motion.div key={`pending-${index}`} variants={galleryItemVariants}>
                      <Card className="space-y-2 p-3">
                        <div className="flex aspect-square w-full items-center justify-center rounded-md bg-muted">
                          <Spinner className="h-6 w-6 text-foreground/40" />
                        </div>
                        <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                        <div className="h-3 w-10 animate-pulse rounded bg-muted" />
                      </Card>
                    </motion.div>
                  ))}
                  {list.items.map((media) => (
                    <motion.div
                      key={media.id}
                      variants={galleryItemVariants}
                      whileHover={{ y: -4 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Card className="space-y-2 p-3">
                        <div className="group relative">
                          <button
                            type="button"
                            onClick={(e) => {
                              // §10.11.5 — shift/ctrl/cmd tıklaması önizlemeyi AÇMAZ, seçime ekler.
                              if (multiSelect.handleItemClick(media.id, e)) return;
                              setPreviewMedia(media);
                            }}
                            aria-label={`${media.filename} önizlemesini aç`}
                            className="block aspect-square w-full cursor-zoom-in overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- yüklenen medya URL'si, next/image remotePatterns henüz tanımlı değil */}
                            <img
                              src={media.url}
                              alt=""
                              loading="eager"
                              onLoad={(e) => e.currentTarget.classList.remove("opacity-0", "blur-sm")}
                              className="h-full w-full object-cover opacity-0 blur-sm transition-[opacity,filter,transform] duration-300 group-hover:scale-105"
                            />
                          </button>
                          {dominantColors[media.id] && (
                            <span
                              className="absolute bottom-2 left-2 h-4 w-4 rounded-full ring-2 ring-white/80"
                              style={{ backgroundColor: dominantColors[media.id]! }}
                              aria-hidden="true"
                            />
                          )}
                          <div
                            className={cn(
                              "absolute top-2 left-2 flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/60 backdrop-blur transition-opacity",
                              multiSelect.selectedIds.has(media.id)
                                ? "opacity-100"
                                : "opacity-0 focus-within:opacity-100 group-hover:opacity-100"
                            )}
                          >
                            <Checkbox
                              aria-label={`${media.filename} öğesini seç`}
                              checked={multiSelect.selectedIds.has(media.id)}
                              onCheckedChange={() => multiSelect.toggle(media.id)}
                              className="border-background/70 text-background data-checked:border-primary"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCopy(media.url)}
                            aria-label={`${media.filename} URL'sini kopyala`}
                            className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/60 text-background opacity-0 backdrop-blur transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                        </div>
                        <p className="truncate text-xs font-medium text-foreground" title={media.filename}>
                          {media.filename}
                        </p>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-foreground/50">
                            {formatSize(media.sizeBytes)}
                            {media.width && media.height ? ` · ${media.width}×${media.height}` : ""}
                          </span>
                          <Button variant="ghost" size="sm" onClick={() => setPendingDelete(media)}>
                            Sil
                          </Button>
                        </div>
                      </Card>
                    </motion.div>
                  ))}
                </motion.div>
              ) : (
                <MediaListTable
                  items={list.items}
                  selectedIds={multiSelect.selectedIds}
                  allSelected={allSelected}
                  onToggleSelect={multiSelect.toggle}
                  onToggleSelectAll={multiSelect.toggleSelectAll}
                  onRowClick={multiSelect.handleItemClick}
                  onCopy={handleCopy}
                  onPreview={(media) => setPreviewMedia(media)}
                  onDelete={(media) => setPendingDelete(media)}
                />
              )}
            </div>
          )}

          {/* Pages/Blog listelerindeki `totalPages > 10` eşiği BİLEREK kopyalanmadı: pageSize burada
              24 (Pages/Blog'daki 10 değil) — o eşikle 240+ görsel yüklenmeden sayfalama hiç görünmez
              ve fazlalık öğeler arayüzden ERİŞİLEMEZ kalırdı (34 görselle gerçek testte doğrulandı:
              24 görünüyor, 10 tanesine ulaşılamıyordu). Sayfalama, birden fazla sayfa OLDUĞU sürece
              gösterilir. */}
          {list.totalPages > 1 && (
            <ListPagination page={list.page} totalPages={list.totalPages} onPageChange={list.setPage} />
          )}
        </div>
      </div>

      {/* Karar 1 — mobil/tablet: aynı `MediaFolderTree` instance-şekli, sadece saran konteyner Sheet. */}
      <Sheet open={folderSheetOpen} onOpenChange={setFolderSheetOpen}>
        <SheetContent side="left" className="w-3/4 p-0 sm:max-w-xs">
          <SheetHeader className="border-b border-border">
            <SheetTitle>Klasörler</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-3">
            {foldersError ? (
              <div className="space-y-3">
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
                folders={folders}
                selectedFolderId={selectedFolder}
                onSelectFolder={(id) => {
                  selectFolder(id);
                  setFolderSheetOpen(false);
                }}
                totalCount={totalCount}
                uncategorizedCount={uncategorizedCount}
                onFoldersChange={refreshMediaAndFolders}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Baskın renk hesaplaması için paylaşılan, görünmez tek canvas. */}
      <canvas ref={colorCanvasRef} className="hidden" />

      <MediaPreviewDialog
        media={previewMedia}
        open={previewMedia !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewMedia(null);
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Görseli sil"
        description={pendingDelete ? `"${pendingDelete.filename}" görselini silmek istediğinize emin misiniz?` : undefined}
        confirmText="Sil"
        destructive
        loading={deletingId === pendingDelete?.id}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={bulkDeleteConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setBulkDeleteConfirmOpen(false);
        }}
        title="Görselleri toplu sil"
        description={`${multiSelect.selectedIds.size} görseli silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`}
        confirmText="Sil"
        destructive
        loading={bulkDeleting}
        onConfirm={handleBulkDelete}
      />
    </div>
  );
}
