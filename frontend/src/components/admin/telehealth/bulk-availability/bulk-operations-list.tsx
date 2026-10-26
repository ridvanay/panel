"use client";

import { useState } from "react";
import { Undo2 } from "lucide-react";
import type { BulkOperation } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TURKEY_TIME_ZONE } from "@/lib/dual-time";

const SOURCE_LABELS: Record<BulkOperation["source"], string> = { CSV: "Excel (CSV)", TEMPLATE: "Haftalık şablon", TIME_OFF: "Toplu izin" };
const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: TURKEY_TIME_ZONE });

function summaryText(op: BulkOperation) {
  const s = op.summary;
  const parts = [`${op.doctorCount} doktor`];
  if (s.rulesAdded || s.rulesRemoved) parts.push(`${s.rulesAdded} saat eklendi, ${s.rulesRemoved} kaldırıldı`);
  if (s.timeOffAdded) parts.push(`${s.timeOffAdded} izin eklendi`);
  return parts.join(" · ");
}

/** Paket Q — "Son toplu işlemler" + geri alma. Engellenen geri almada sunucunun değişiklik listesi gösterilir. */
export function BulkOperationsList({
  operations,
  onUndo,
  undoBlocked,
  undoingId,
}: {
  operations: BulkOperation[] | null;
  onUndo: (operation: BulkOperation) => void;
  undoBlocked: { operationId: string; changes: string[] } | null;
  undoingId: string | null;
}) {
  const [pending, setPending] = useState<BulkOperation | null>(null);
  return (
    <section className="space-y-3" data-testid="bulk-operations">
      <h2 className="text-base font-semibold">Son toplu işlemler</h2>
      {operations === null && <p className="text-sm text-foreground/50">Yükleniyor…</p>}
      {operations?.length === 0 && <p className="text-sm text-foreground/50">Henüz toplu işlem yapılmadı.</p>}
      {undoBlocked && (
        <Alert variant="error">
          <p className="font-medium">Geri alma durduruldu: bu işlemden sonra elle değiştirilmiş kayıtlar var.</p>
          <ul className="list-disc ps-5 text-sm">
            {undoBlocked.changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Alert>
      )}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {operations?.map((op) => (
          <li key={op.id} className="flex flex-wrap items-center gap-3 p-3 text-sm" data-testid="bulk-operation-row">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {SOURCE_LABELS[op.source]}
                {op.fileName ? ` — ${op.fileName}` : ""}
              </p>
              <p className="text-foreground/60">
                {dateFormatter.format(new Date(op.createdAt))} TSİ · {op.actorEmail ?? "—"} · {summaryText(op)}
              </p>
              {op.summary.doctorNames.length > 0 && <p className="truncate text-xs text-foreground/50">{op.summary.doctorNames.join(", ")}</p>}
            </div>
            {op.undoneAt ? (
              <Badge tone="neutral">Geri alındı</Badge>
            ) : (
              <Button type="button" size="sm" variant="outline" loading={undoingId === op.id} onClick={() => setPending(op)}>
                <Undo2 className="h-4 w-4" />
                Geri al
              </Button>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title="Toplu işlem geri alınsın mı?"
        description="Haftalık saatler bu işlemden önceki hâline döner ve bu işlemle eklenen izinler silinir. Randevulara dokunulmaz."
        confirmText="Geri al"
        tone="warning"
        onConfirm={() => {
          if (pending) onUndo(pending);
          setPending(null);
        }}
      />
    </section>
  );
}
