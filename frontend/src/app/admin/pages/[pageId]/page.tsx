"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as pagesApi from "@/lib/api/pages";
import type { ContentStatus } from "@/lib/api/types";
import type { Block, BlockType } from "@/lib/page-builder/types";
import { createBlock } from "@/lib/page-builder/registry";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { BlockList } from "@/components/admin/page-builder/block-list";
import { BuilderCanvas } from "@/components/admin/page-builder/builder-canvas";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

export default function PageBuilderPage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = use(params);
  const router = useRouter();

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState<ContentStatus>("DRAFT");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [viewCount, setViewCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const page = await pagesApi.getPage(pageId);
      setTitle(page.title);
      setSlug(page.slug);
      setStatus(page.status);
      setSeoTitle(page.seoTitle ?? "");
      setSeoDescription(page.seoDescription ?? "");
      setBlocks(page.blocks as unknown as Block[]);
      setViewCount(page.viewCount);
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
      await load();
    } catch (err) {
      setSaveError(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Bu sayfayı silmek istediğinize emin misiniz?")) return;
    setDeleting(true);
    try {
      await pagesApi.deletePage(pageId);
      router.push("/admin/pages");
    } catch (err) {
      setSaveError(friendlyErrorMessage(err));
      setDeleting(false);
    }
  }

  if (loadError) {
    return <Alert variant="error">{loadError}</Alert>;
  }

  if (!loaded) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Sayfa Düzenleyici</h1>
          <p className="mt-1 text-sm text-foreground/60">{viewCount.toLocaleString("tr-TR")} görüntülenme</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" loading={deleting} onClick={handleDelete}>
            Sil
          </Button>
          <Button loading={saving} onClick={handleSave}>
            Kaydet
          </Button>
        </div>
      </div>

      {saveError && <Alert variant="error">{saveError}</Alert>}

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
    </div>
  );
}
