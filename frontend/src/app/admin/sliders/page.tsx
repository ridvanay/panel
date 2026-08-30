"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { AlertCircle, AlertTriangle, Code2, Copy, ExternalLink, GalleryHorizontal, MoreVertical, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import * as slidersApi from "@/lib/api/sliders";
import type { SliderSummary, SliderUsage } from "@/lib/sliders/types";
import { buildSliderShortcode } from "@/lib/sliders/shortcode";
import { ApiClientError } from "@/lib/api/error";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeading } from "@/components/admin/page-heading";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

interface UsageConflict {
  slider: SliderSummary;
  usedBy: SliderUsage[];
}

/**
 * `DELETE /admin/sliders/{id}` `409` gövdesi `error.details.usedBy: SliderUsage[]` taşır
 * (bkz. openapi.yaml) — `ApiClientError.details` genel tipi (`Record<string,string[]>`)
 * doğrulama-hatası şeklini varsayar, bu yüzden gerçek çalışma-zamanı şekli burada AYRICA
 * okunur (backend kontratı tek doğruluk kaynağı, istemci tip tanımı BURADA daraltılır).
 */
function extractUsedBy(err: ApiClientError): SliderUsage[] {
  const details = err.details as unknown as { usedBy?: SliderUsage[] } | undefined;
  return Array.isArray(details?.usedBy) ? details.usedBy : [];
}

type TabFilter = "active" | "trashed";

function relativeDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function AdminSlidersListPage() {
  const router = useRouter();
  const [items, setItems] = useState<SliderSummary[] | null>(null);
  const [counts, setCounts] = useState({ active: 0, trashed: 0 });
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabFilter>("active");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SliderSummary | null>(null);
  const [permanentTarget, setPermanentTarget] = useState<SliderSummary | null>(null);
  const [permanentBusy, setPermanentBusy] = useState(false);
  const [usageConflict, setUsageConflict] = useState<UsageConflict | null>(null);
  const [forceDeleting, setForceDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      let cursor: string | undefined;
      const collected: SliderSummary[] = [];
      let nextCounts = { active: 0, trashed: 0 };
      while (true) {
        const result = await slidersApi.listSliders({ cursor, trashed: "include", limit: 100 });
        collected.push(...result.items);
        nextCounts = result.meta.counts;
        if (!result.meta.nextCursor) break;
        cursor = result.meta.nextCursor;
      }
      setItems(collected);
      setCounts(nextCounts);
      setError(null);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const visible = useMemo(() => {
    if (!items) return [];
    const byTab = items.filter((s) => (tab === "trashed" ? s.deletedAt !== null : s.deletedAt === null));
    const query = search.trim().toLowerCase();
    if (!query) return byTab;
    return byTab.filter((s) => s.name.toLowerCase().includes(query) || s.slug.toLowerCase().includes(query));
  }, [items, tab, search]);

  async function handleCreate() {
    setCreating(true);
    try {
      const created = await slidersApi.createSlider({ name: "Yeni Slider" });
      toast.success("Slider oluşturuldu.");
      router.push(`/admin/sliders/${created.id}`);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
      setCreating(false);
    }
  }

  /** §9.2.8 architect — Hero Studio üst çubuğundaki "Kısa Kod" düğmesiyle AYNI kopyalama/toast
   *  davranışı (`app/admin/settings/security/page.tsx` iki-geri-çağırmalı deseni). */
  function handleCopyShortcode(slider: SliderSummary) {
    navigator.clipboard.writeText(buildSliderShortcode(slider.id)).then(
      () => toast.success("Kısa kod kopyalandı! Bu kodu herhangi bir sayfada veya blog yazısında metin içine yapıştırabilirsiniz."),
      () => toast.error("Kısa kod panoya kopyalanamadı.")
    );
  }

  async function handleDuplicate(slider: SliderSummary) {
    setBusyId(slider.id);
    try {
      const copy = await slidersApi.duplicateSlider(slider.id);
      toast.success("Slider kopyalandı.");
      await load();
      router.push(`/admin/sliders/${copy.id}`);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(slider: SliderSummary) {
    setBusyId(slider.id);
    try {
      await slidersApi.restoreSlider(slider.id);
      toast.success("Slider geri yüklendi.");
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmTrash() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setBusyId(target.id);
    try {
      await slidersApi.deleteSlider(target.id);
      toast.success("Slider çöpe taşındı.");
      setDeleteTarget(null);
      await load();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        // §4.3 architect — referans koruması: kullanan sayfaların listesini göster, force ile
        // devam etme seçeneği sun (kilitlenmiş bir onay diyaloğu yerine).
        setDeleteTarget(null);
        setUsageConflict({ slider: target, usedBy: extractUsedBy(err) });
      } else {
        toast.error(friendlyErrorMessage(err));
        setDeleteTarget(null);
      }
    } finally {
      setBusyId(null);
    }
  }

  async function confirmForceDelete() {
    if (!usageConflict) return;
    setForceDeleting(true);
    try {
      await slidersApi.deleteSlider(usageConflict.slider.id, true);
      toast.success("Slider çöpe taşındı.");
      setUsageConflict(null);
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setForceDeleting(false);
    }
  }

  async function confirmPermanentDelete() {
    if (!permanentTarget) return;
    setPermanentBusy(true);
    try {
      await slidersApi.permanentDeleteSlider(permanentTarget.id);
      toast.success("Slider kalıcı olarak silindi.");
      setPermanentTarget(null);
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setPermanentBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeading
        icon={GalleryHorizontal}
        title="Slider'lar"
        description="Hero Studio ile çok katmanlı slayt gösterileri oluşturun; sayfalarınıza 'Gelişmiş Slider' bloğuyla gömün."
        actions={
          <Button type="button" onClick={handleCreate} loading={creating}>
            <Plus className="h-4 w-4" />
            Yeni Slider
          </Button>
        }
      />

      {error && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      {items === null ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : items.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <EmptyState
            icon={GalleryHorizontal}
            title="Henüz slider yok"
            description="İlk Hero Studio slider'ınızı oluşturarak başlayın."
            action={
              <Button type="button" onClick={handleCreate} loading={creating}>
                <Plus className="h-4 w-4" />
                Yeni Slider
              </Button>
            }
          />
        </motion.div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs value={tab} onValueChange={(v) => setTab(v as TabFilter)}>
              <TabsList>
                <TabsTrigger value="active">Aktif ({counts.active})</TabsTrigger>
                <TabsTrigger value="trashed">Çöp ({counts.trashed})</TabsTrigger>
              </TabsList>
            </Tabs>

            <InputGroup className="w-full sm:max-w-xs border-2 border-border bg-muted">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="Ada veya slug'a göre ara..."
                aria-label="Slider ara"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </InputGroup>
          </div>

          {visible.length === 0 ? (
            <EmptyState icon={Search} title="Sonuç bulunamadı" description="Arama kriterlerinize uyan bir slider yok." />
          ) : (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="rounded-xl border border-border bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Önizleme</TableHead>
                    <TableHead>Ad</TableHead>
                    <TableHead className="w-28">Slayt</TableHead>
                    <TableHead className="w-40">Güncellendi</TableHead>
                    <TableHead className="w-10 text-right">İşlemler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((slider) => {
                    const busy = busyId === slider.id;
                    return (
                      <TableRow key={slider.id}>
                        <TableCell>
                          {slider.previewImageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- küçük liste önizlemesi, next/image gerekmez
                            <img src={slider.previewImageUrl} alt="" className="h-10 w-16 rounded-md border border-border object-cover" />
                          ) : (
                            <span className="flex h-10 w-16 items-center justify-center rounded-md border border-dashed border-border text-foreground/30">
                              <GalleryHorizontal className="h-4 w-4" />
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {tab === "trashed" ? (
                            <span className="font-medium text-foreground">{slider.name}</span>
                          ) : (
                            <Link href={`/admin/sliders/${slider.id}`} className="font-medium text-primary hover:underline">
                              {slider.name}
                            </Link>
                          )}
                          <p className="text-xs text-foreground/50">/{slider.slug}</p>
                        </TableCell>
                        <TableCell>
                          <Badge tone="neutral" size="sm">
                            {slider.slideCount} slayt
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-foreground/60">{relativeDate(slider.updatedAt)}</TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`${slider.name} için işlemler`} disabled={busy} />}>
                              <MoreVertical className="h-4 w-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {tab === "active" ? (
                                <>
                                  <DropdownMenuItem render={<Link href={`/admin/sliders/${slider.id}`} />}>
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    Hero Studio&apos;da Aç
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleCopyShortcode(slider)}>
                                    <Code2 className="h-3.5 w-3.5" />
                                    Kısa Kodu Kopyala
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => void handleDuplicate(slider)}>
                                    <Copy className="h-3.5 w-3.5" />
                                    Kopyala
                                  </DropdownMenuItem>
                                  <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(slider)}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                    Çöpe Taşı
                                  </DropdownMenuItem>
                                </>
                              ) : (
                                <>
                                  <DropdownMenuItem onClick={() => void handleRestore(slider)}>
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    Geri Yükle
                                  </DropdownMenuItem>
                                  <DropdownMenuItem variant="destructive" onClick={() => setPermanentTarget(slider)}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                    Kalıcı Sil
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </motion.div>
          )}
        </>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Slider'ı çöpe taşı"
        description={
          deleteTarget
            ? `"${deleteTarget.name}" çöpe taşınacak. Bu slider bir sayfada kullanılıyorsa işlem engellenir ve kullanıldığı sayfalar gösterilir.`
            : undefined
        }
        confirmText="Çöpe Taşı"
        tone="warning"
        loading={busyId === deleteTarget?.id}
        onConfirm={confirmTrash}
      />

      <ConfirmDialog
        open={permanentTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPermanentTarget(null);
        }}
        title="Slider'ı kalıcı sil"
        description={permanentTarget ? `"${permanentTarget.name}" kalıcı olarak silinecek. Bu işlem geri alınamaz.` : undefined}
        confirmText="Kalıcı Sil"
        tone="danger"
        loading={permanentBusy}
        onConfirm={confirmPermanentDelete}
      />

      {/* §4.3 architect — 409 referans koruması: kullanan sayfaların listesi + force ile devam. */}
      <Dialog
        open={usageConflict !== null}
        onOpenChange={(open) => {
          if (!open) setUsageConflict(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <div>
                <DialogTitle>Slider kullanımda</DialogTitle>
                <DialogDescription className="mt-1">
                  {usageConflict && (
                    <>
                      &quot;{usageConflict.slider.name}&quot; aşağıdaki {usageConflict.usedBy.length} sayfada kullanılıyor. Yine de
                      çöpe taşırsanız bu sayfalardaki &quot;Gelişmiş Slider&quot; bloğu public sitede sessizce boş görünür (hata
                      vermez).
                    </>
                  )}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-1.5">
            {usageConflict?.usedBy.map((usage) => (
              <li key={usage.blockId} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                <Link
                  href={`/admin/pages/${usage.pageId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 truncate font-medium text-primary hover:underline"
                  title={usage.pageSlug}
                >
                  {usage.pageTitle}
                </Link>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Badge tone="neutral" size="sm">
                    {usage.usageType === "shortcode" ? "kısa kod" : "blok"}
                  </Badge>
                  {usage.isHomePage && (
                    <Badge tone="warning" size="sm">
                      Ana sayfa
                    </Badge>
                  )}
                  {usage.pageDeletedAt && (
                    <Badge tone="neutral" size="sm">
                      Çöpte
                    </Badge>
                  )}
                </span>
              </li>
            ))}
            {usageConflict && usageConflict.usedBy.length === 0 && (
              <li className="px-2 py-1.5 text-sm text-foreground/50">Kullanım listesi alınamadı, yine de zorlayabilirsiniz.</li>
            )}
          </ul>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setUsageConflict(null)}>
              Vazgeç
            </Button>
            <Button type="button" variant="destructive" loading={forceDeleting} onClick={() => void confirmForceDelete()}>
              <Trash2 className="h-3.5 w-3.5" />
              Yine de Çöpe Taşı
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
