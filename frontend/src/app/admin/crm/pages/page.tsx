"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import * as crmApi from "@/lib/api/crm";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { CrmDateRange, defaultRange, type DateRangeValue } from "@/components/admin/crm/crm-ui";
import { buildPageTree, flattenPageTree } from "@/lib/crm/page-tree";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

/**
 * Paket N3 — Sayfa Haritası (ağaç görünümü, erişilebilir tablo olarak): görüntüleme, kişi (günlük tekillerin
 * toplamı), ortalama okuma süresi, kaydırma derinliği, giriş sayısı ve temas. Dil öneki ilk seviyededir;
 * varsayılan dilin öneksiz ana sayfası (`/`) ilk satırdadır. Klasörler düğmeyle açılır/kapanır.
 */
export default function CrmPageMapPage() {
  const [range, setRange] = useState<DateRangeValue>(defaultRange("30"));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const pages = useQuery({ queryKey: ["crm-pages", range.from, range.to], queryFn: () => crmApi.getCrmPages(range) });
  const tree = useMemo(() => (pages.data ? buildPageTree(pages.data) : null), [pages.data]);
  // Varsayılan: ilk seviye (dil önekleri) açık, daha derinler kapalı.
  const isOpen = (path: string, depth: number) => (depth < 1 ? !collapsed.has(path) : expanded.has(path));
  const rows = tree ? flattenPageTree(tree, isOpen) : [];

  function toggle(path: string, depth: number) {
    const update = (set: Set<string>) => {
      const next = new Set(set);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    };
    if (depth < 1) setCollapsed(update);
    else setExpanded(update);
  }

  return (
    <div className="space-y-4">
      <CrmDateRange value={range} onChange={setRange} />
      <Card>
        {pages.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : pages.isError ? (
          <Alert variant="error">{friendlyErrorMessage(pages.error)}</Alert>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-foreground/50">Bu aralıkta veri yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <caption className="sr-only">Sayfa haritası</caption>
              <thead>
                <tr className="border-b border-border text-xs text-foreground/60">
                  <th scope="col" className="px-2 py-2 text-start font-medium">Sayfa</th>
                  <th scope="col" className="px-2 py-2 text-end font-medium">Görüntüleme</th>
                  <th scope="col" className="px-2 py-2 text-end font-medium">Kişi</th>
                  <th scope="col" className="px-2 py-2 text-end font-medium">Ort. okuma</th>
                  <th scope="col" className="px-2 py-2 text-end font-medium">Kaydırma</th>
                  <th scope="col" className="px-2 py-2 text-end font-medium">Giriş</th>
                  <th scope="col" className="px-2 py-2 text-end font-medium">Temas</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ node, depth, hasChildren, open }) => {
                  const own = node.own;
                  return (
                    <tr key={node.path} className="border-b border-border/50">
                      <th scope="row" className="px-2 py-1.5 text-start font-normal">
                        <span className="flex min-w-0 items-center gap-1" style={{ paddingInlineStart: `${depth * 1.1}rem` }}>
                          {hasChildren ? (
                            <button
                              type="button"
                              onClick={() => toggle(node.path, depth)}
                              aria-expanded={open}
                              aria-label={`${node.path} ${open ? "daralt" : "genişlet"}`}
                              className="rounded p-0.5 hover:bg-muted"
                            >
                              <ChevronRight className={`h-3.5 w-3.5 transition-transform rtl:-scale-x-100 ${open ? "rotate-90 rtl:-rotate-90" : ""}`} aria-hidden="true" />
                            </button>
                          ) : (
                            <span className="inline-block w-4.5" aria-hidden="true" />
                          )}
                          <span className="truncate font-mono text-xs" dir="ltr" title={node.path}>
                            {node.path === "/" ? "/" : `/${node.segment}`}
                          </span>
                        </span>
                      </th>
                      <td className="px-2 py-1.5 text-end tabular-nums">{node.total.pageviews}</td>
                      <td className="px-2 py-1.5 text-end tabular-nums">{node.total.visitors}</td>
                      <td className="px-2 py-1.5 text-end tabular-nums">{own ? `${own.avgEngagedSeconds} sn` : "—"}</td>
                      <td className="px-2 py-1.5 text-end tabular-nums">{own && own.avgScrollPct !== null ? `%${own.avgScrollPct}` : "—"}</td>
                      <td className="px-2 py-1.5 text-end tabular-nums">{node.total.entries}</td>
                      <td className="px-2 py-1.5 text-end tabular-nums">{node.total.contacts}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
