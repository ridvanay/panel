"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as pagesApi from "@/lib/api/pages";
import type { ContentStatus } from "@/lib/api/types";
import type { Block, BlockType } from "@/lib/page-builder/types";
import { createBlock } from "@/lib/page-builder/registry";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BlockList } from "@/components/admin/page-builder/block-list";
import { BuilderCanvas } from "@/components/admin/page-builder/builder-canvas";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { AlertCircle, ChevronLeft } from "lucide-react";

interface PageSnapshot {
  title: string;
  slug: string;
  status: ContentStatus;
  seoTitle: string;
  seoDescription: string;
  blocks: Block[];
}

export default function PageBuilderPage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = use(params);
  const router = useRouter();

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState<ContentStatus>("DRAFT");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [viewCount, setViewCount] = useState(0);
  const [snapshot, setSnapshot] = useState<PageSnapshot | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await pagesApi.getPage(pageId);
      const loadedBlocks = page.blocks as unknown as Block[];
      setTitle(page.title);
      setSlug(page.slug);
      setStatus(page.status);
      setSeoTitle(page.seoTitle ?? "");
      setSeoDescription(page.seoDescription ?? "");
      setBlocks(loadedBlocks);
      setViewCount(page.viewCount);
      setSnapshot({
        title: page.title,
        slug: page.slug,
        status: page.status,
        seoTitle: page.seoTitle ?? "",
        seoDescription: page.seoDescription ?? "",
        blocks: loadedBlocks,
      });
      setLoaded(true);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, [pageId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const hasUnsavedChanges = useMemo(() => {
    if (!snapshot) return false;
    return (
      title !== snapshot.title ||
      slug !== snapshot.slug ||
      status !== snapshot.status ||
      seoTitle !== snapshot.seoTitle ||
      seoDescription !== snapshot.seoDescription ||
      JSON.stringify(blocks) !== JSON.stringify(snapshot.blocks)
    );
  }, [title, slug, status, seoTitle, seoDescription, blocks, snapshot]);

  function addBlock(type: BlockType) {
    setBlocks((prev) => [...prev, createBlock(type)]);
  }

  async function handleSave() {
    setSaveError(null);
    setSaving(true);
    try {
      await pagesApi.updatePage(pageId, {
        title,
        slug,
        status,
        seoTitle: seoTitle || null,
        seoDescription: seoDescription || null,
        blocks: blocks as unknown as Record<string, unknown>[],
      });
      toast.success("Sayfa kaydedildi.");
      await load();
    } catch (err) {
      setSaveError(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await pagesApi.deletePage(pageId);
      toast.success("Sayfa silindi.");
      router.push("/admin/pages");
    } catch (err) {
      setSaveError(friendlyErrorMessage(err));
      setDeleting(false);
    }
  }

  if (loadError) {
    return (
      <Alert variant="error">
        <span className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {loadError}
        </span>
      </Alert>
    );
  }

  if (!loaded) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      <div>
        <Link
          href="/admin/pages"
          className="inline-flex items-center gap-1 text-sm text-foreground/60 transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Sayfalar
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Sayfa Düzenleyici</h1>
            <p className="mt-1 text-sm text-foreground/60">{viewCount.toLocaleString("tr-TR")} görüntülenme</p>
          </div>
          {hasUnsavedChanges && (
            <Badge tone="primary">
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-primary" />
              Kaydedilmemiş değişiklik
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setDeleteDialogOpen(true)}>
            Sil
          </Button>
        </div>
      </div>

      {saveError && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {saveError}
          </span>
        </Alert>
      )}

      <Card className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="title" label="Başlık" required>
            {(inputProps) => <Input {...inputProps} required value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field id="slug" label="Slug (URL)" required>
            {(inputProps) => <Input {...inputProps} required value={slug} onChange={(e) => setSlug(e.target.value)} />}
          </Field>
        </div>

        <Field id="status" label="Durum">
          {(inputProps) => (
            <Select {...inputProps} value={status} onChange={(e) => setStatus(e.target.value as ContentStatus)}>
              <option value="DRAFT">Taslak</option>
              <option value="PUBLISHED">Yayında</option>
            </Select>
          )}
        </Field>

        <Field id="seoTitle" label="SEO başlığı">
          {(inputProps) => <Input {...inputProps} value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} />}
        </Field>
        <Field id="seoDescription" label="SEO açıklaması">
          {(inputProps) => (
            <Textarea {...inputProps} value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} rows={2} />
          )}
        </Field>
      </Card>

      <div>
        <h2 className="text-base font-semibold text-foreground">İçerik blokları</h2>
        <p className="mt-1 text-sm text-foreground/60">Sayfaya blok ekleyin ve sırasını düzenleyin.</p>
        <div className="mt-4">
          <BlockList onAdd={addBlock} />
        </div>
        <div className="mt-4">
          <BuilderCanvas blocks={blocks} onChange={setBlocks} />
        </div>
      </div>

      <div className="sticky bottom-6 z-10 flex justify-end">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
          {saving && <span className="text-xs text-foreground/60">Kaydediliyor…</span>}
          <Button loading={saving} onClick={handleSave}>
            Kaydet
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Sayfayı sil"
        description="Bu sayfayı silmek istediğinize emin misiniz? Bu işlem geri alınamaz."
        confirmText="Sil"
        destructive
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
