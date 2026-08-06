"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { AlertCircle, TrendingUp } from "lucide-react";
import { flattenTopContent, useTopContent } from "@/hooks/use-stats";
import type { StatsRangeQuery } from "@/lib/api/stats";
import type { TopContentType } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const TOP_CONTENT_TYPE_LABELS: Record<TopContentType, string> = {
  page: "Sayfa",
  post: "Blog Yazısı",
};

function contentHref(item: { contentType: TopContentType; id: string }): string {
  return item.contentType === "page" ? `/admin/pages/${item.id}` : `/admin/blog/${item.id}`;
}

interface TopContentListProps {
  range: StatsRangeQuery;
  rangeLabel?: string;
}

/** `GET /admin/stats/top-content` — EDITOR+ADMIN, cursor sayfalı ("daha fazla yükle"). */
export function TopContentList({ range, rangeLabel }: TopContentListProps) {
  const query = useTopContent(range);
  const items = flattenTopContent(query.data?.pages);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: "easeOut" }}>
      <Card className="overflow-hidden p-0">
        <div className="p-6 pb-0">
          <h2 className="text-sm font-medium text-foreground">En çok görüntülenen içerik</h2>
          <p className="text-xs text-foreground/60">{rangeLabel ?? "Seçili aralık"} · sayfa ve blog yazısı görüntülenme sıralaması</p>
        </div>

        <div className="p-6">
          {query.isError ? (
            <Alert variant="error">
              <span className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {friendlyErrorMessage(query.error)}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
                  Tekrar Dene
                </Button>
              </span>
            </Alert>
          ) : query.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={TrendingUp}
              title="Henüz veri yok"
              description="Seçili aralıkta hiçbir içerik görüntülenmedi."
              className="border-none p-6"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>İçerik</TableHead>
                  <TableHead>Tür</TableHead>
                  <TableHead className="text-right">Görüntülenme</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={`${item.contentType}-${item.id}`}>
                    <TableCell className="max-w-[280px] truncate font-medium text-foreground">
                      <Link href={contentHref(item)} className="admin-link">
                        {item.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge tone={item.contentType === "page" ? "primary" : "neutral"}>{TOP_CONTENT_TYPE_LABELS[item.contentType]}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-foreground/70">{item.views.toLocaleString("tr-TR")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {query.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                Daha fazla yükle
              </Button>
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  );
}
