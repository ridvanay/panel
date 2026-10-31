"use client";

import { useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Package } from "lucide-react";
import { withdrawPackageHealthConsent, type CrmPackageInquiry } from "@/lib/api/crm";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/components/admin/crm/crm-ui";

/**
 * Paket X — CRM talep ayrıntısında paket talebi paneli. Not YALNIZCA varsa gösterilir ve sağlık
 * bilgisi içerebileceği uyarısı taşır; anonimleştirilmiş talepte rozet görünür.
 */
export function PackageInquiryCard({ leadId, inquiry, onChanged }: { leadId: string; inquiry: CrmPackageInquiry; onChanged?: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const canWithdraw = Boolean(inquiry.note || inquiry.consentHealthAt);

  async function withdraw() {
    setBusy(true);
    try {
      await withdrawPackageHealthConsent(leadId);
      toast.success("Sağlık onayı geri çekildi; not silindi.");
      setConfirmOpen(false);
      onChanged?.();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const title = inquiry.packageTitle || inquiry.packageSlug || "Silinmiş paket";
  return (
    <Card className="space-y-3" data-testid="package-inquiry-card">
      <div className="flex flex-wrap items-center gap-2">
        <Package className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-semibold">Paket talebi</h3>
        <span className="text-xs text-foreground/50">#{inquiry.number}</span>
        {inquiry.anonymizedAt && <Badge tone="neutral">Anonimleştirildi</Badge>}
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="inline text-foreground/60">Paket: </dt>
          <dd className="inline" dir="auto">
            {inquiry.packageId ? (
              <Link href={`/admin/packages?edit=${inquiry.packageId}`} className="font-medium text-primary underline-offset-2 hover:underline" aria-label={`${title} paketini admin panelde aç`}>
                {title}
              </Link>
            ) : (
              title
            )}
          </dd>
        </div>
        <div>
          <dt className="inline text-foreground/60">Tarih aralığı: </dt>
          <dd className="inline" dir="auto">
            {inquiry.preferredDates || "—"}
          </dd>
        </div>
        <div>
          <dt className="inline text-foreground/60">Kişi sayısı: </dt>
          <dd className="inline">{inquiry.travellers ?? "—"}</dd>
        </div>
        <div>
          <dt className="inline text-foreground/60">İletişim onayı: </dt>
          <dd className="inline">{inquiry.consentContactAt ? formatDateTime(inquiry.consentContactAt) : "—"}</dd>
        </div>
        <div>
          <dt className="inline text-foreground/60">Sağlık verisi onayı: </dt>
          <dd className="inline">{inquiry.consentHealthAt ? formatDateTime(inquiry.consentHealthAt) : "—"}</dd>
        </div>
        <div>
          <dt className="inline text-foreground/60">Onay metni sürümü: </dt>
          <dd className="inline font-mono" dir="ltr">
            {inquiry.consentTextVersion || "—"}
          </dd>
        </div>
      </dl>

      {inquiry.note && (
        <section aria-label="Hasta notu" className="space-y-1.5" data-testid="package-inquiry-note">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground/60">Not</h4>
          <Alert variant="warning">Bu not sağlık bilgisi içerebilir; yalnızca talebi yanıtlamak için kullanın ve paylaşmayın.</Alert>
          <p className="whitespace-pre-wrap rounded-lg border border-border p-3 text-sm" dir="auto">
            {inquiry.note}
          </p>
        </section>
      )}

      {canWithdraw && (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
            Sağlık onayını geri çek (notu sil)
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Sağlık onayı geri çekilsin mi?"
        description="Hasta sağlık bilgisi onayını geri çektiyse kullanın. Not kalıcı olarak silinir."
        confirmText="Geri çek ve notu sil"
        tone="danger"
        loading={busy}
        onConfirm={() => void withdraw()}
      />
    </Card>
  );
}
