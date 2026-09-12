"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Printer } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { BookingInvoice } from "@/lib/api/types";
import { formatPriceFromCents } from "@/lib/format-price";
import { formatDayLabel, formatTime } from "@/lib/telehealth-format";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7.0 madde 11 (bağlayıcı) — `Invoice`
 * TABLOSU YOKTUR; bu, PAID bir booking'in TÜRETİLMİŞ görünümüdür. Etiket "Ödeme Belgesi (bilgi
 * amaçlıdır)" — "Fatura" DEĞİL (e-Fatura/GİB entegrasyonu yoktur). PDF üretimi sunucuda
 * YAPILMAZ, tarayıcının yazdırma stiliyle çözülür.
 */
export function PatientBookingInvoicePanel({ bookingId, accessToken }: { bookingId: string; accessToken?: string }) {
  const [invoice, setInvoice] = useState<BookingInvoice | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await telehealthApi.getBookingInvoice(bookingId, accessToken);
      setInvoice(result);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, [bookingId, accessToken]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  if (invoice === null && !loadError) {
    return <Skeleton className="h-64 w-full rounded-[var(--site-radius)]" />;
  }

  if (loadError || !invoice) {
    return (
      <Alert variant="error">
        <span className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {loadError}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            Tekrar Dene
          </Button>
        </span>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-xl font-semibold text-foreground">Ödeme Belgesi (bilgi amaçlıdır)</h1>
        <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4" aria-hidden="true" />
          Yazdır
        </Button>
      </div>

      <div className="rounded-[var(--site-radius)] border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-foreground/50">Rezervasyon No</p>
            <p className="text-sm font-medium text-foreground">{invoice.bookingNumber}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-foreground/50">Düzenlenme Tarihi</p>
            <p className="text-sm font-medium text-foreground">{new Intl.DateTimeFormat("tr-TR", { dateStyle: "long" }).format(new Date(invoice.issuedAt))}</p>
          </div>
        </div>

        <div className="my-4 grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-foreground/50">Satıcı</p>
            <p className="text-sm text-foreground">{invoice.seller.name}</p>
          </div>
          <div>
            <p className="text-xs text-foreground/50">Alıcı</p>
            <p className="text-sm text-foreground">{invoice.buyer.name}</p>
            <p className="text-xs text-foreground/60">{invoice.buyer.email}</p>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-foreground/50">
              <th className="py-2">Açıklama</th>
              <th className="py-2">Tarih</th>
              <th className="py-2 text-right">Tutar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {invoice.lines.map((line, idx) => (
              <tr key={idx}>
                <td className="py-2 text-foreground">{line.description}</td>
                <td className="py-2 text-foreground/70">
                  {formatDayLabel(line.startsAt, timeZone)} · {formatTime(line.startsAt, timeZone)}
                </td>
                <td className="py-2 text-right text-foreground">{formatPriceFromCents(line.unitPriceCents, invoice.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex items-baseline justify-between border-t border-border pt-4">
          <span className="text-sm font-semibold text-foreground">Toplam</span>
          <span className="text-xl font-semibold text-foreground">{formatPriceFromCents(invoice.totalCents, invoice.currency)}</span>
        </div>

        <p className="mt-6 text-xs text-foreground/50">{invoice.disclaimer}</p>
      </div>
    </div>
  );
}
