"use client";

import { Fragment, type ReactNode } from "react";
import { motion } from "framer-motion";
import { LockKeyhole, Monitor } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { blockRegistry } from "@/lib/page-builder/registry";
import { TEMPLATE_EDITABLE_FIELDS } from "@/lib/page-builder/template-fields";
import { updateNode } from "@/lib/page-builder/containers";
import type { ContentBlock, PageNode } from "@/lib/page-builder/types";
import { BlockRenderer } from "@/components/site/blocks";
import { TemplateBlockFields } from "./template-block-fields";

/**
 * design-notes-page-builder-standard-mode.md §2.1-§2.8 — Standart/Yazar modu için "sade form
 * ekranı + salt-okunur canlı önizleme". `BuilderCanvas`'ın YENİDEN kullanılması BİLİNÇLİ olarak
 * reddedildi (Karar 2) — bu, ayrı ve bağımsız bir üst-seviye bileşendir. `nodes`/`onChange`
 * imzası `BuilderCanvas` ile BİREBİR aynı — aynı `activeNodes`/`setActiveNodes` state'i, aynı
 * autosave/`handleSave` akışı hiçbir değişiklik olmadan çalışır.
 */

/** Bir içerik bloğunun şablon modunda EN AZ bir alanı düzenlenebilir mi (fail-closed). */
function isEditableBlock(block: ContentBlock): boolean {
  return (TEMPLATE_EDITABLE_FIELDS[block.type] ?? []).length > 0;
}

/** §2.4 algoritması — bir düğümün alt ağacındaki (kendisi dahil, iç içe konteynerler dahil)
 *  TÜM editable içerik bloklarını doküman sırasında, `depth` bilgisiyle toplar. `depth` yalnızca
 *  2. seviye ve sonrası için (§2.4.1 opsiyonel ince girinti çizgisi) kullanılır — 1 = kökteki
 *  Bölüm konteynerinin doğrudan çocuğu. */
function collectEditableBlocks(node: PageNode, depth: number, acc: { block: ContentBlock; depth: number }[]): void {
  if (node.type === "container") {
    for (const child of node.children) collectEditableBlocks(child, depth + 1, acc);
    return;
  }
  if (isEditableBlock(node)) acc.push({ block: node, depth });
}

/** `blockRegistry` (DEĞİŞMEDEN reuse) üzerinden ikon+etiket — §2.4.1. */
function FieldGroupHeader({ block }: { block: ContentBlock }) {
  const { icon: Icon, label } = blockRegistry[block.type];
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 text-foreground/40" />
      <span className="text-xs font-medium uppercase tracking-wide text-foreground/50">{label}</span>
    </div>
  );
}

/** §2.4.1 — kök konteyner içindeki editable blokları düz akışta, "Bölüm N" kartı içinde gösterir. */
function SectionCard({
  sectionIndex,
  blocks,
  onChangeBlock,
}: {
  sectionIndex: number;
  blocks: { block: ContentBlock; depth: number }[];
  onChangeBlock: (block: ContentBlock) => void;
}) {
  return (
    <Card className="space-y-4">
      <p className="text-xs font-medium uppercase tracking-wide text-foreground/40">Bölüm {sectionIndex}</p>
      {blocks.map(({ block, depth }, i) => (
        <div
          key={block.id}
          className={cn(i > 0 && "border-t border-border/40 pt-4", depth >= 2 && "border-l-2 border-border/30 pl-3")}
        >
          <FieldGroupHeader block={block} />
          <div className="mt-2">
            <TemplateBlockFields block={block} onChange={onChangeBlock} />
          </div>
        </div>
      ))}
    </Card>
  );
}

/** §2.4 madde 3 — kök seviyesinde "gevşek" (konteynersiz) bir editable blok, Bölüm kartı OLMADAN
 *  doğal sayfa sırasında render edilir (zaten `chrome="page"`, kendi boşluğuna sahip). */
function LooseFieldGroup({ block, onChangeBlock }: { block: ContentBlock; onChangeBlock: (block: ContentBlock) => void }) {
  return (
    <div className="space-y-2">
      <FieldGroupHeader block={block} />
      <TemplateBlockFields block={block} onChange={onChangeBlock} />
    </div>
  );
}

/**
 * `site/blocks/index.tsx::BlockRenderer` dört blok tipi için (`contact-form`,
 * `featured-products`, `featured-portfolio`, `latest-posts`) React Server Component'i taşır —
 * bu bileşenler backend'den veri çekmek için `async function` olarak tanımlıdır ve YALNIZCA
 * sunucu tarafında render edilebilir. `TemplateEditorView` (bu dosya) `"use client"`tir — Next.js
 * bir Client Component ağacı İÇİNDE async bir bileşeni render etmeye çalışırsa çalışma zamanı
 * hatası verir ("Creating promises inside a Client Component ... is not yet supported").
 *
 * Çözüm `BlockRenderer`'ı DEĞİŞTİRMEK DEĞİL (dosya başlığındaki "AYNEN kullanılır" kararı diğer
 * ~20 blok tipi ve `container` için TAM olarak korunur) — bu dört tipin düğümlerini, gerçek
 * ağaca ulaşmadan ÖNCE, salt-görsel bir yer tutucuyla (statik `custom-html`, İÇERİĞİ TAMAMEN
 * sabit/kendi ürettiğimiz metin — kullanıcı verisi ASLA enterpole edilmez) değiştirmektir.
 */
const SERVER_ONLY_PREVIEW_LABELS: Partial<Record<ContentBlock["type"], string>> = {
  "contact-form": "İletişim Formu",
  "featured-products": "Öne Çıkan Ürünler",
  "featured-portfolio": "Öne Çıkan Projeler",
  "latest-posts": "Son Blog Yazıları",
};

function toPreviewSafeNodes(nodes: PageNode[]): PageNode[] {
  return nodes.map((node) => {
    if (node.type === "container") {
      return { ...node, children: toPreviewSafeNodes(node.children) };
    }
    const label = SERVER_ONLY_PREVIEW_LABELS[node.type];
    if (!label) return node;
    return {
      id: node.id,
      type: "custom-html",
      reveal: node.reveal,
      data: {
        html: `<div class="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border/60 bg-surface-muted/30 px-4 py-6 text-center"><span class="text-xs font-medium text-foreground/50">${label}</span><span class="text-xs text-foreground/40">Canlı sitede gerçek veriyle gösterilir</span></div>`,
      },
    };
  });
}

/** §2.7 — salt-okunur canlı önizleme. Sıfırdan bir render motoru YAZILMAZ, public site render
 *  katmanı (`BlockRenderer`) AYNEN kullanılır (yukarıdaki not — yalnızca sunucuya özgü 4 blok
 *  tipi önizleme öncesi yer tutucuya çevrilir). */
function TemplatePreviewFrame({ nodes }: { nodes: PageNode[] }) {
  const previewNodes = toPreviewSafeNodes(nodes);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground/50">
        <Monitor className="h-3.5 w-3.5" />
        Canlı Önizleme
        <span className="text-foreground/35">— salt okunur</span>
      </div>
      <div className="max-h-[calc(100vh-8rem)] overflow-y-auto rounded-xl border border-border bg-background">
        {/* `pointer-events-none` YALNIZCA iç sarmalayıcıda — dış div'in kendi scroll'u ETKİLENMEZ. */}
        <div className="pointer-events-none select-none">
          <BlockRenderer nodes={previewNodes} chrome="page" />
        </div>
      </div>
    </div>
  );
}

export function TemplateEditorView({
  nodes,
  onChange,
}: {
  nodes: PageNode[];
  onChange: (nodes: PageNode[]) => void;
}) {
  function updateBlock(next: ContentBlock) {
    onChange(updateNode(nodes, next.id, () => next));
  }

  let sectionIndex = 0;
  const rootItems: { key: string; node: ReactNode }[] = [];

  for (const node of nodes) {
    if (node.type === "container") {
      const editableBlocks: { block: ContentBlock; depth: number }[] = [];
      collectEditableBlocks(node, 1, editableBlocks);
      if (editableBlocks.length === 0) continue;
      sectionIndex += 1;
      rootItems.push({
        key: node.id,
        node: <SectionCard sectionIndex={sectionIndex} blocks={editableBlocks} onChangeBlock={updateBlock} />,
      });
      continue;
    }
    if (!isEditableBlock(node)) continue;
    rootItems.push({ key: node.id, node: <LooseFieldGroup block={node} onChangeBlock={updateBlock} /> });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr] xl:grid-cols-[480px_1fr]">
      <div className="min-w-0 space-y-4">
        {rootItems.length === 0 ? (
          <EmptyState
            icon={LockKeyhole}
            title="Düzenlenebilir alan yok"
            description="Bu sayfada değiştirebileceğiniz bir içerik alanı bulunmuyor. Yapısal değişiklikler için gelişmiş bir düzenleyiciden destek isteyin."
          />
        ) : (
          rootItems.map(({ key, node }) => <Fragment key={key}>{node}</Fragment>)
        )}
      </div>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <TemplatePreviewFrame nodes={nodes} />
        </motion.div>
      </div>
    </div>
  );
}
