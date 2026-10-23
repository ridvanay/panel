"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import * as crmApi from "@/lib/api/crm";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { CrmDateRange, defaultRange, type DateRangeValue } from "@/components/admin/crm/crm-ui";
import { buildPageTree, type PageTreeNode } from "@/lib/crm/page-tree";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

/**
 * Paket N3 — Sayfa Haritası (ağaç): görüntüleme, kişi (günlük tekillerin toplamı), ortalama okuma süresi,
 * kaydırma derinliği, giriş sayısı ve temas. Dil öneki ilk seviyededir (/tr, /en, /ar…).
 */
export default function CrmPageMapPage() {
  const [range, setRange] = useState<DateRangeValue>(defaultRange("30"));
  const pages = useQuery({ queryKey: ["crm-pages", range.from, range.to], queryFn: () => crmApi.getCrmPages(range) });
  const tree = useMemo(() => (pages.data ? buildPageTree(pages.data) : null), [pages.data]);

  return (
    <div className="space-y-4">
      <CrmDateRange value={range} onChange={setRange} />
      <Card>
        {pages.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : pages.isError ? (
          <Alert variant="error">{friendlyErrorMessage(pages.error)}</Alert>
        ) : !tree || tree.children.length === 0 ? (
          <p className="py-8 text-center text-sm text-foreground/50">Bu aralıkta veri yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <div role="tree" aria-label="Sayfa haritası" className="min-w-[44rem] text-sm">
              <div className="grid grid-cols-[minmax(14rem,1fr)_repeat(6,5.5rem)] gap-2 border-b border-border px-2 py-2 text-xs font-medium text-foreground/60">
                <span>Sayfa</span>
                <span className="text-end">Görüntüleme</span>
                <span className="text-end">Kişi</span>
                <span className="text-end">Ort. okuma</span>
                <span className="text-end">Kaydırma</span>
                <span className="text-end">Giriş</span>
                <span className="text-end">Temas</span>
              </div>
              {tree.children.map((node) => (
                <TreeRow key={node.path} node={node} depth={0} />
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function TreeRow({ node, depth }: { node: PageTreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  const own = node.own;
  return (
    <div role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={false}>
      <div className="grid grid-cols-[minmax(14rem,1fr)_repeat(6,5.5rem)] items-center gap-2 border-b border-border/50 px-2 py-1.5">
        <span className="flex min-w-0 items-center gap-1" style={{ paddingInlineStart: `${depth * 1.1}rem` }}>
          {hasChildren ? (
            <button type="button" onClick={() => setOpen(!open)} aria-label={open ? "Daralt" : "Genişlet"} className="rounded p-0.5 hover:bg-muted">
              <ChevronRight className={`h-3.5 w-3.5 transition-transform rtl:-scale-x-100 ${open ? "rotate-90 rtl:-rotate-90" : ""}`} aria-hidden="true" />
            </button>
          ) : (
            <span className="inline-block w-4.5" aria-hidden="true" />
          )}
          <span className="truncate font-mono text-xs" dir="ltr" title={node.path}>
            /{node.segment}
          </span>
        </span>
        <span className="text-end tabular-nums">{node.total.pageviews}</span>
        <span className="text-end tabular-nums">{node.total.visitors}</span>
        <span className="text-end tabular-nums">{own ? `${own.avgEngagedSeconds} sn` : "—"}</span>
        <span className="text-end tabular-nums">{own && own.avgScrollPct !== null ? `%${own.avgScrollPct}` : "—"}</span>
        <span className="text-end tabular-nums">{node.total.entries}</span>
        <span className="text-end tabular-nums">{node.total.contacts}</span>
      </div>
      {hasChildren && open && (
        <div role="group">
          {node.children.map((child) => (
            <TreeRow key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
