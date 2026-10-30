"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Link2, UserSearch } from "lucide-react";
import * as matcherApi from "@/lib/api/matcher";
import type { MatcherDemandReport } from "@/lib/api/matcher";
import type { Specialty } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

/**
 * Paket W-ek — "Talep var, hekim yok": son 90 günde seçilen/aramadan seçilen ama koordinatöre giden
 * konular, doğal uzmanlık ipucuna göre gruplu. Hekim alındığında aynı ekrandan o ipucundaki konular tek
 * seferde yeni uzmanlığa bağlanır (yalnızca ADMIN).
 */
export function MatcherDemandCard({ specialties, canEdit, onChanged }: { specialties: Specialty[]; canEdit: boolean; onChanged: () => void }) {
  const [report, setReport] = useState<MatcherDemandReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assignHint, setAssignHint] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setReport(await matcherApi.getMatcherDemandReport(90));
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  return (
    <Card className="space-y-3" data-testid="matcher-demand-report">
      <div className="flex items-center gap-2">
        <UserSearch className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="admin-h2">Talep var, hekim yok (son 90 gün)</h2>
      </div>
      <p className="admin-text-secondary">
        Koordinatöre giden konular, bizde hekimi olmayan doğal uzmanlığa (ipucu) göre gruplu. Sayı = sihirbazda seçim + aramadan seçim. Hangi branşta hekim alınacağına karar vermek için.
      </p>
      {error && <Alert variant="error">{error}</Alert>}
      {!report && !error && (
        <div className="flex justify-center py-6">
          <Spinner className="h-5 w-5 text-primary" />
        </div>
      )}
      {report && report.groups.length === 0 && <p className="text-sm text-foreground/60">Koordinatöre giden konu yok.</p>}
      {report && report.groups.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {report.groups.map((group) => (
            <li key={group.hint ?? "__none__"} className="p-3" data-testid="matcher-demand-group">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{group.hint ?? "İpucu yok"}</span>
                  <span className="text-foreground/60">
                    {group.requests} talep · {group.topics.length} konu
                  </span>
                  {canEdit && group.hint && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="ms-auto"
                      onClick={(e) => {
                        e.preventDefault();
                        setAssignHint(group.hint);
                      }}
                      data-testid="matcher-demand-assign"
                    >
                      <Link2 className="h-4 w-4" aria-hidden="true" />
                      Uzmanlığa bağla
                    </Button>
                  )}
                </summary>
                <ul className="mt-2 space-y-0.5 text-xs text-foreground/70">
                  {group.topics.map((t) => (
                    <li key={t.id}>
                      {t.label} <span className="font-mono text-foreground/40">{t.slug}</span> — {t.selections} seçim, {t.searchPicks} arama
                    </li>
                  ))}
                </ul>
              </details>
              {assignHint === group.hint && group.hint && (
                <BulkAssignForm
                  hint={group.hint}
                  topicCount={group.topics.length}
                  specialties={specialties}
                  onCancel={() => setAssignHint(null)}
                  onDone={() => {
                    setAssignHint(null);
                    void load();
                    onChanged();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function BulkAssignForm({
  hint,
  topicCount,
  specialties,
  onCancel,
  onDone,
}: {
  hint: string;
  topicCount: number;
  specialties: Specialty[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const [specialtyId, setSpecialtyId] = useState("");
  const [weight, setWeight] = useState(70);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const specialty = specialties.find((s) => s.id === specialtyId);

  async function apply() {
    setBusy(true);
    try {
      const res = await matcherApi.bulkAssignMatcherHint({ hint, specialtyId, weight });
      toast.success(`${res.updated} konu ${specialty?.name ?? "uzmanlığa"} bağlandı.`);
      onDone();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md bg-surface-muted p-3 text-sm" data-testid="matcher-bulk-assign">
      <label className="block space-y-1">
        <span className="font-medium">Uzmanlık</span>
        <select value={specialtyId} onChange={(e) => setSpecialtyId(e.target.value)} className="h-9 rounded-md border border-border bg-background px-2">
          <option value="">Seçin</option>
          {specialties.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block w-24 space-y-1">
        <span className="font-medium">Ağırlık</span>
        <Input type="number" min={1} max={100} value={weight} onChange={(e) => setWeight(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
      </label>
      <Button type="button" size="sm" disabled={!specialtyId} onClick={() => setConfirming(true)}>
        {topicCount} konuyu bağla
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Vazgeç
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Toplu uzmanlık bağlama"
        description={`“${hint}” ipucu olan ${topicCount} konu ${specialty?.name ?? ""} uzmanlığına ${weight} ağırlıkla bağlanacak. Var olan ağırlık güncellenir. Bu konular artık seed tarafından güncellenmez (admin değişikliği sayılır).`}
        confirmText="Bağla"
        loading={busy}
        onConfirm={apply}
      />
    </div>
  );
}
