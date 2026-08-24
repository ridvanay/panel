"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertCircle, ChevronLeft, Copy, Receipt } from "lucide-react";
import * as usersApi from "@/lib/api/users";
import type { Order } from "@/lib/api/types";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { formatPriceFromCents } from "@/lib/format-price";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from "@/lib/order-status";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

interface OrderDetailClientProps {
  orderId: string;
}

/**
 * `/hesabim/siparislerim/{orderId}` içerik istemcisi — §customer-portal §2.1/§6, design-notes §4.
 * Kargo takip bloğu YALNIZCA `trackingNumber` doluysa render edilir (`PAID`/erken durumlarda
 * hiç görünmez). PDF fatura/e-Arşiv üretimi KAPSAM DIŞIDIR.
 */
export function OrderDetailClient({ orderId }: OrderDetailClientProps) {
  const localize = useLocalizePath();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setOrder(null);
    setError(null);
    try {
      const data = await usersApi.getMyOrder(orderId);
      setOrder(data);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, [orderId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  function copyTracking() {
    if (!order?.trackingNumber) return;
    navigator.clipboard.writeText(order.trackingNumber).then(
      () => toast.success("Takip numarası panoya kopyalandı."),
      () => toast.error("Panoya kopyalanamadı.")
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href={localize("/hesabim/siparislerim")}
        className="inline-flex items-center gap-1 text-sm text-foreground/60 transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Siparişlerim
      </Link>

      {error && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      {!error && order === null && (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-[var(--site-primary)]" />
        </div>
      )}

      {!error && order && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-muted text-foreground/50">
              <Receipt className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-foreground">{order.orderNumber}</h2>
              <p className="mt-0.5 text-sm text-foreground/60">{dateFormatter.format(new Date(order.createdAt))}</p>
            </div>
            <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
          </div>

          {order.trackingNumber && (
            <Card>
              <div>
                <p className="mb-1.5 text-sm font-medium text-foreground">Kargo Takip Numarası</p>
                <div className="flex items-center gap-2">
                  <div className="break-all rounded-lg border border-border bg-surface-muted p-3 font-mono text-sm text-foreground/90">
                    {order.trackingNumber}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={copyTracking}
                    aria-label="Takip numarasını kopyala"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                {order.shippingCarrier && (
                  <p className="mt-1.5 text-sm text-foreground/60">Taşıyıcı: {order.shippingCarrier}</p>
                )}
                {order.shippedAt && (
                  <p className="mt-1.5 text-sm text-foreground/60">
                    Kargoya verildi: {dateFormatter.format(new Date(order.shippedAt))}
                  </p>
                )}
                {order.deliveredAt && (
                  <p className="mt-1.5 text-sm text-foreground/60">
                    Teslim edildi: {dateFormatter.format(new Date(order.deliveredAt))}
                  </p>
                )}
              </div>
            </Card>
          )}

          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ürün</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Birim Fiyat</TableHead>
                  <TableHead className="text-right">Adet</TableHead>
                  <TableHead className="text-right">Toplam</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium text-foreground">{item.productTitle}</TableCell>
                    <TableCell className="text-foreground/60">{item.productSku ?? "—"}</TableCell>
                    <TableCell className="text-right">{formatPriceFromCents(item.unitPriceCents, order.currency)}</TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell className="text-right">{formatPriceFromCents(item.lineTotalCents, order.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Card className="ml-auto max-w-xs space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground/60">Ara Toplam</span>
              <span className="text-foreground">{formatPriceFromCents(order.subtotalCents, order.currency)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground/60">İndirim</span>
              <span className="text-foreground">-{formatPriceFromCents(order.discountCents, order.currency)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground/60">Vergi</span>
              <span className="text-foreground">{formatPriceFromCents(order.taxCents, order.currency)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2 text-base font-semibold">
              <span className="text-foreground">Toplam</span>
              <span className="text-foreground">{formatPriceFromCents(order.totalCents, order.currency)}</span>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
