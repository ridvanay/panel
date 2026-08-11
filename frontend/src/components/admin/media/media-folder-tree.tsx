"use client";

import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { toast } from "sonner";
import type { LucideProps } from "lucide-react";
import {
  Folder,
  FolderInput,
  FolderMinus,
  FolderOpen,
  FolderPlus,
  Images,
  MoreVertical,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";
import * as mediaApi from "@/lib/api/media";
import type { MediaFolder } from "@/lib/api/types";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import {
  ALL_FILES_SELECTION,
  UNCATEGORIZED_SELECTION,
  buildMediaFolderTree,
  type MediaFolderSelection,
} from "@/lib/media-folder-tree";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface MediaFolderTreeProps {
  folders: MediaFolder[];
  selectedFolderId: MediaFolderSelection;
  onSelectFolder: (selection: MediaFolderSelection) => void;
  totalCount: number;
  uncategorizedCount: number;
  /**
   * `"manage"` (varsayılan) — admin medya sayfası: arama, "+ Yeni Klasör", satır `⋮` menüsü (yeniden
   * adlandır/alt klasör/taşı/sil) AÇIK. `"picker"` — `MediaPicker` içindeki kompakt/salt-okunur
   * varyant (Karar 9, design-notes-media-folders.md): tek etkileşim "satıra tıklamak = filtrelemek".
   */
  mode?: "manage" | "picker";
  /** Klasör CRUD işlemlerinden sonra listeyi (güncel `mediaCount` dahil) yeniden çekmek için. */
  onFoldersChange: () => void | Promise<void>;
  className?: string;
}

/** Karar 4/7 — hem "+ Yeni Klasör" hem "Yeniden Adlandır" AYNI satır-içi giriş desenini kullanır. */
function InlineFolderNameRow({
  depth,
  icon: Icon,
  initialValue = "",
  onSubmit,
  onCancel,
}: {
  depth: 0 | 1;
  icon: ComponentType<LucideProps>;
  initialValue?: string;
  onSubmit: (value: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    const trimmed = value.trim();
    if (!trimmed) {
      // Kazara boş kayıt önlenir — sessizce iptal, hiçbir istek gitmez.
      onCancel();
      return;
    }
    setBusy(true);
    const shouldClose = await onSubmit(trimmed);
    setBusy(false);
    // 409 (isim çakışması) — satır AÇIK kalır, input odakta kalır, kullanıcı düzeltip tekrar dener.
    if (!shouldClose) return;
  }

  return (
    <div
      className={cn(
        "flex h-9 items-center gap-2 rounded-md border border-primary/40 bg-primary/5 pr-2",
        depth === 0 ? "pl-3" : "pl-8"
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-primary" />
      <Input
        autoFocus
        aria-label="Klasör adı"
        className="h-7 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
        placeholder="Klasör adı"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => {
          if (busy) return;
          onCancel();
        }}
      />
    </div>
  );
}

interface FolderRowProps {
  label: string;
  count: number;
  depth: 0 | 1;
  /**
   * Karar 2/3 — GERÇEK klasör satırlarında (`Folder`) aktifken `FolderOpen`'a döner; sabit
   * girişlerde (`Images`/`FolderMinus`) bu swap OLMAZ, kendi ikonu her zaman sabit kalır —
   * çağıran taraf hangisini istediğine göre `icon`/`activeIcon` verir.
   */
  icon: ComponentType<LucideProps>;
  activeIcon?: ComponentType<LucideProps>;
  isActive: boolean;
  dimmed?: boolean;
  onSelect: () => void;
  actions?: ReactNode;
}

function FolderRow({ label, count, depth, icon: Icon, activeIcon, isActive, dimmed = false, onSelect, actions }: FolderRowProps) {
  const ActiveIcon = isActive && activeIcon ? activeIcon : Icon;
  return (
    <div className={cn("group relative flex items-center", dimmed && "opacity-60")}>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-md pr-2 text-sm transition-colors",
          depth === 0 ? "pl-3" : "pl-8",
          isActive
            ? "bg-primary/10 font-medium text-primary"
            : "text-foreground/80 hover:bg-surface-muted hover:text-foreground"
        )}
      >
        <ActiveIcon className={cn("h-4 w-4 shrink-0", !isActive && "text-foreground/40")} />
        <span className="flex-1 truncate text-left">{label}</span>
        <Badge tone="neutral" size="sm">
          {count}
        </Badge>
        {actions && <span className="w-6 shrink-0" aria-hidden="true" />}
      </button>
      {actions && <div className="absolute right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">{actions}</div>}
    </div>
  );
}

/**
 * Klasör ağacı paneli — admin medya sayfasının sol paneli VE `MediaPicker`in kompakt varyantı
 * AYNI component'i paylaşır (design-notes-media-folders.md Karar 1/9). Tasarım kararları BİREBİR
 * bu dokümandan uygulanmıştır; burada YENİ bir görsel karar VERİLMEZ.
 */
export function MediaFolderTree({
  folders,
  selectedFolderId,
  onSelectFolder,
  totalCount,
  uncategorizedCount,
  mode = "manage",
  onFoldersChange,
  className,
}: MediaFolderTreeProps) {
  const [query, setQuery] = useState("");
  // "root" = kökte oluşturuluyor, aksi halde bir kök klasörün id'si (o klasörün altına alt klasör).
  const [createTarget, setCreateTarget] = useState<"root" | string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MediaFolder | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const tree = useMemo(() => buildMediaFolderTree(folders), [folders]);
  const rootFolders = useMemo(() => folders.filter((f) => f.parentId === null), [folders]);

  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = mode === "manage" && normalizedQuery.length > 0;

  // Karar 5 — arama aktifken filtreleme: kendi adı eşleşen kök tam opaklıkta; sadece bir çocuğu
  // eşleşen kök bağlam için soluk (ama tıklanabilir) gösterilir; eşleşmeyen çocuklar HER ZAMAN
  // gizlenir (kökün kendisi eşleşse bile).
  const visibleTree = useMemo(() => {
    if (!isSearching) return tree.map((node) => ({ ...node, dimmed: false }));
    return tree
      .map((node) => {
        const selfMatch = node.folder.name.toLowerCase().includes(normalizedQuery);
        const matchedChildren = node.children.filter((c) => c.name.toLowerCase().includes(normalizedQuery));
        if (!selfMatch && matchedChildren.length === 0) return null;
        return { folder: node.folder, children: matchedChildren, dimmed: !selfMatch };
      })
      .filter((node): node is { folder: MediaFolder; children: MediaFolder[]; dimmed: boolean } => node !== null);
  }, [tree, isSearching, normalizedQuery]);

  const showAllFiles = !isSearching || "tüm dosyalar".includes(normalizedQuery);
  const showUncategorized = !isSearching || "kategorisiz".includes(normalizedQuery);
  const noResults = isSearching && !showAllFiles && !showUncategorized && visibleTree.length === 0;

  async function handleCreate(name: string, parentId: string | null): Promise<boolean> {
    try {
      await mediaApi.createMediaFolder({ name, parentId });
      setCreateTarget(null);
      await onFoldersChange();
      return true;
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        toast.error("Bu isimde bir klasör zaten var.");
      } else {
        toast.error(friendlyErrorMessage(err));
      }
      return false;
    }
  }

  async function handleRename(folderId: string, name: string): Promise<boolean> {
    try {
      await mediaApi.updateMediaFolder(folderId, { name });
      setRenamingId(null);
      await onFoldersChange();
      return true;
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        toast.error("Bu isimde bir klasör zaten var.");
      } else {
        toast.error(friendlyErrorMessage(err));
      }
      return false;
    }
  }

  async function handleMoveFolder(folderId: string, parentId: string | null) {
    try {
      await mediaApi.updateMediaFolder(folderId, { parentId });
      toast.success("Klasör taşındı.");
      await onFoldersChange();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    }
  }

  async function handleDeleteFolder() {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    try {
      await mediaApi.deleteMediaFolder(pendingDelete.id);
      toast.success("Klasör silindi.");
      setPendingDelete(null);
      // Silinen klasör (veya çocuğu) seçiliyse "Tüm Dosyalar"a dön — artık var olmayan bir
      // klasöre bakmaya devam etmesin.
      if (selectedFolderId === pendingDelete.id) onSelectFolder(ALL_FILES_SELECTION);
      await onFoldersChange();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setDeleteBusy(false);
    }
  }

  const childCountOfPendingDelete = pendingDelete ? folders.filter((f) => f.parentId === pendingDelete.id).length : 0;

  function folderActionsMenu(folder: MediaFolder, depth: 0 | 1) {
    const moveDestinations = depth === 0 ? rootFolders.filter((f) => f.id !== folder.id) : [];
    const showMoveSubmenu = depth === 1 || moveDestinations.length > 0;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button type="button" variant="ghost" size="icon-xs" aria-label={`${folder.name} için işlemler`} />
          }
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setRenamingId(folder.id)}>
            <Pencil className="h-4 w-4" /> Yeniden Adlandır
          </DropdownMenuItem>
          {depth === 0 && (
            <DropdownMenuItem onClick={() => setCreateTarget(folder.id)}>
              <FolderPlus className="h-4 w-4" /> Alt Klasör Ekle
            </DropdownMenuItem>
          )}
          {showMoveSubmenu && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput className="h-4 w-4" /> Taşı
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {depth === 1 && (
                  <DropdownMenuItem onClick={() => handleMoveFolder(folder.id, null)}>Kök Düzeye Taşı</DropdownMenuItem>
                )}
                {depth === 0 &&
                  moveDestinations.map((f) => (
                    <DropdownMenuItem key={f.id} onClick={() => handleMoveFolder(folder.id, f.id)}>
                      {f.name} altına taşı
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setPendingDelete(folder)}>
            <Trash2 className="h-4 w-4" /> Sil
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const manage = mode === "manage";

  return (
    <div className={className}>
      {manage && (
        <div className="mb-3 flex items-center justify-between">
          <h2 className="admin-h2">Klasörler</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Yeni klasör"
            onClick={() => setCreateTarget("root")}
          >
            <FolderPlus className="h-4 w-4" />
          </Button>
        </div>
      )}

      {manage && (
        <InputGroup className="mb-3">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Klasör ara…"
            aria-label="Klasör ara"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>
      )}

      {noResults ? (
        <EmptyState icon={Search} title="Sonuç bulunamadı" description={`"${query}" ile eşleşen bir klasör yok.`} className="border-none p-6" />
      ) : (
        <>
          <div className="space-y-0.5">
            {showAllFiles && (
              <FolderRow
                label="Tüm Dosyalar"
                count={totalCount}
                depth={0}
                icon={Images}
                isActive={selectedFolderId === ALL_FILES_SELECTION}
                onSelect={() => onSelectFolder(ALL_FILES_SELECTION)}
              />
            )}
            {showUncategorized && (
              <FolderRow
                label="Kategorisiz"
                count={uncategorizedCount}
                depth={0}
                icon={FolderMinus}
                isActive={selectedFolderId === UNCATEGORIZED_SELECTION}
                onSelect={() => onSelectFolder(UNCATEGORIZED_SELECTION)}
              />
            )}
          </div>

          {(showAllFiles || showUncategorized) && <div className="my-2 border-t border-border/60" />}

          {manage && createTarget === "root" && (
            <InlineFolderNameRow depth={0} icon={FolderPlus} onSubmit={(name) => handleCreate(name, null)} onCancel={() => setCreateTarget(null)} />
          )}

          <div className="space-y-0.5">
            {visibleTree.map((node) => (
              <div key={node.folder.id}>
                {renamingId === node.folder.id ? (
                  <InlineFolderNameRow
                    depth={0}
                    icon={Pencil}
                    initialValue={node.folder.name}
                    onSubmit={(name) => handleRename(node.folder.id, name)}
                    onCancel={() => setRenamingId(null)}
                  />
                ) : (
                  <FolderRow
                    label={node.folder.name}
                    count={node.folder.mediaCount}
                    depth={0}
                    icon={Folder}
                    activeIcon={FolderOpen}
                    isActive={selectedFolderId === node.folder.id}
                    dimmed={node.dimmed}
                    onSelect={() => onSelectFolder(node.folder.id)}
                    actions={manage ? folderActionsMenu(node.folder, 0) : undefined}
                  />
                )}
                {node.children.map((child) =>
                  renamingId === child.id ? (
                    <InlineFolderNameRow
                      key={child.id}
                      depth={1}
                      icon={Pencil}
                      initialValue={child.name}
                      onSubmit={(name) => handleRename(child.id, name)}
                      onCancel={() => setRenamingId(null)}
                    />
                  ) : (
                    <FolderRow
                      key={child.id}
                      label={child.name}
                      count={child.mediaCount}
                      depth={1}
                      icon={Folder}
                      activeIcon={FolderOpen}
                      isActive={selectedFolderId === child.id}
                      onSelect={() => onSelectFolder(child.id)}
                      actions={manage ? folderActionsMenu(child, 1) : undefined}
                    />
                  )
                )}
                {manage && createTarget === node.folder.id && (
                  <InlineFolderNameRow
                    depth={1}
                    icon={FolderPlus}
                    onSubmit={(name) => handleCreate(name, node.folder.id)}
                    onCancel={() => setCreateTarget(null)}
                  />
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Klasörü sil"
        description={
          pendingDelete
            ? `"${pendingDelete.name}" klasörünü silmek istediğinize emin misiniz? ${pendingDelete.mediaCount} görsel Kategorisiz'e taşınacak${
                childCountOfPendingDelete > 0 ? `, ${childCountOfPendingDelete} alt klasör en üst seviyeye çıkacak` : ""
              }.`
            : undefined
        }
        confirmText="Sil"
        destructive
        loading={deleteBusy}
        onConfirm={handleDeleteFolder}
      />
    </div>
  );
}
