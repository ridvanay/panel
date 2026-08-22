"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { toast } from "sonner";
import { History, RotateCcw } from "lucide-react";
import type { ContentRevisionSummary, Page } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

interface RevisionHistoryProps {
  entityLabel: string;
  loadRevisions: (cursor?: string) => Promise<Page<ContentRevisionSummary>>;
  onRestore: (revisionId: string) => Promise<void>;
  /**
   * §10.20 — `POST .../revisions/{id}/restore` sayfalarda artık `canUseAdvancedBuilder: true`
   * gerektiriyor (Blog'da bu kısıt YOK). Varsayılan `true` — yalnızca `admin/pages/[pageId]/page.tsx`
   * standart kullanıcı için `false` geçer; Blog kullanımı DEĞİŞMEDEN çalışmaya devam eder.
   */
  canRestore?: boolean;
}

/**
 * Sayfa/Blog editörlerinde "Geçmiş Sürümler" sekmesi — bileşen kendi içinde restore
 * API'sini çağırmaz, `onRestore` callback'i alır (parent, hem page hem blog için
 * kendi `revisions.ts` fonksiyonunu bağlar ve restore sonrası formu tazeler).
 */
export function RevisionHistory({ entityLabel, loadRevisions, onRestore, canRestore = true }: RevisionHistoryProps) {
  const [items, setItems] = useState<ContentRevisionSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmRevisionId, setConfirmRevisionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setItems(null);
    setError(null);
    try {
      const page = await loadRevisions();
      setItems(page.items);
      setNextCursor(page.meta.nextCursor);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, [loadRevisions]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await loadRevisions(nextCursor);
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setNextCursor(page.meta.nextCursor);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleConfirmRestore() {
    if (!confirmRevisionId) return;
    setRestoringId(confirmRevisionId);
    try {
      await onRestore(confirmRevisionId);
      toast.success("Sürüm geri yüklendi.");
      setConfirmRevisionId(null);
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setRestoringId(null);
    }
  }

  if (error) {
    return <Alert variant="error">{error}</Alert>;
  }

  if (items === null) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  if (items.length === 0) {
    return <EmptyState icon={History} title="Henüz kayıtlı bir sürüm yok" description={`${entityLabel} güncellendikçe burada geçmiş sürümler listelenecek.`} />;
  }

  return (
    <div className="space-y-4">
      <Card className="divide-y divide-border overflow-hidden p-0">
        {items.map((revision) => (
          <div key={revision.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {revision.editedById === null ? "Silinmiş kullanıcı" : revision.editedByName}
              </p>
              <p className="mt-0.5 text-xs text-foreground/50">
                {formatDistanceToNow(new Date(revision.createdAt), { addSuffix: true, locale: tr })}
              </p>
            </div>
            {canRestore && (
              <Button
                variant="outline"
                size="sm"
                loading={restoringId === revision.id}
                onClick={() => setConfirmRevisionId(revision.id)}
              >
                <RotateCcw className="h-4 w-4" />
                Bu Sürüme Geri Dön
              </Button>
            )}
          </div>
        ))}
      </Card>

      {nextCursor && (
        <div className="flex justify-center">
          <Button variant="outline" loading={loadingMore} onClick={handleLoadMore}>
            Daha fazla yükle
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmRevisionId !== null}
        onOpenChange={(open) => !open && setConfirmRevisionId(null)}
        title="Bu sürüme geri dön"
        description="Bu sürüme geri dönmek istediğinize emin misiniz? Mevcut hâl de bir sürüm olarak saklanacak."
        confirmText="Geri Dön"
        loading={restoringId !== null}
        onConfirm={handleConfirmRestore}
      />
    </div>
  );
}
