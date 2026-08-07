"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, ChevronLeft, XCircle } from "lucide-react";
import * as ordersApi from "@/lib/api/orders";
import type { Order, OrderStatus } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { formatPriceFromCents } from "@/lib/format-price";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from "@/lib/order-status";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

export default function AdminOrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);

  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setOrder(await ordersApi.getOrder(orderId));
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, [orderId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function handleStatusChange(status: OrderStatus) {
    setUpdating(true);
    try {
      const updated = await ordersApi.updateOrderStatus(orderId, { status });
      setOrder(updated);
      toast.success("Sipariş durumu güncellendi.");
      setCancelDialogOpen(false);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setUpdating(false);
    }
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </span>
        </Alert>
        <Button variant="outline" onClick={() => load()}>
          Tekrar Dene
        </Button>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-16">
      <div>
        <Link
          href="/admin/orders"
          className="inline-flex items-center gap-1 text-sm text-foreground/60 transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Siparişler
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="admin-h1">Sipariş {order.orderNumber}</h1>
            <p className="mt-1 admin-text-secondary">{dateFormatter.format(new Date(order.createdAt))}</p>
          </div>
          <Badge tone={ORDER_STATUS_TONE[order.status]} size="lg">
            {ORDER_STATUS_LABELS[order.status]}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {order.status === "PENDING" && (
            <Button variant="destructive" onClick={() => setCancelDialogOpen(true)}>
              <XCircle className="h-4 w-4" />
              İptal Et
            </Button>
          )}
          {order.status === "PAID" && (
            <Button loading={updating} onClick={() => handleStatusChange("FULFILLED")}>
              <CheckCircle2 className="h-4 w-4" />
              Tamamlandı Olarak İşaretle
            </Button>
          )}
        </div>
      </div>

      {order.errorSummary && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {order.errorSummary}
          </span>
        </Alert>
      )}

      <Card className="space-y-1">
        <h2 className="admin-h2">Müşteri</h2>
        <p className="text-sm text-foreground">{order.customerName ?? "—"}</p>
        <p className="text-sm text-foreground/60">{order.customerEmail}</p>
      </Card>

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

      <ConfirmDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        title="Siparişi iptal et"
        description={`"${order.orderNumber}" numaralı siparişi iptal etmek istediğinize emin misiniz?`}
        confirmText="İptal Et"
        destructive
        loading={updating}
        onConfirm={() => handleStatusChange("CANCELLED")}
      />
    </div>
  );
}
