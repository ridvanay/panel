"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Receipt } from "lucide-react";
import * as ordersApi from "@/lib/api/orders";
import type { Order, OrderStatus } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeading } from "@/components/admin/page-heading";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { formatPriceFromCents } from "@/lib/format-price";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from "@/lib/order-status";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "">("");
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (status: OrderStatus | "") => {
    setOrders(null);
    setError(null);
    try {
      const page = await ordersApi.listOrders({ status: status || undefined });
      setOrders(page.items);
      setNextCursor(page.meta.nextCursor);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load(statusFilter);
    })();
  }, [statusFilter, load]);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await ordersApi.listOrders({ cursor: nextCursor, status: statusFilter || undefined });
      setOrders((prev) => [...(prev ?? []), ...page.items]);
      setNextCursor(page.meta.nextCursor);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeading icon={Receipt} title="Siparişler" description="Tüm siparişlerin listesi." />

      <div className="flex flex-wrap items-center gap-3">
        <Select
          aria-label="Duruma göre filtrele"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as OrderStatus | "")}
          className="w-48"
        >
          <option value="">Tüm durumlar</option>
          {(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((status) => (
            <option key={status} value={status}>
              {ORDER_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </div>

      {error && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load(statusFilter)}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      {orders === null ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : orders.length === 0 ? (
        <EmptyState icon={Receipt} title="Henüz sipariş yok" description="Bu filtreyle eşleşen bir sipariş bulunamadı." />
      ) : (
        <>
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sipariş No</TableHead>
                  <TableHead>Tarih</TableHead>
                  <TableHead>Müşteri</TableHead>
                  <TableHead>Tutar</TableHead>
                  <TableHead>Durum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Link href={`/admin/orders/${order.id}`} className="font-medium text-primary hover:underline">
                        {order.orderNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{dateFormatter.format(new Date(order.createdAt))}</TableCell>
                    <TableCell>{order.customerEmail}</TableCell>
                    <TableCell>{formatPriceFromCents(order.totalCents, order.currency)}</TableCell>
                    <TableCell>
                      <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {nextCursor && (
            <div className="flex justify-center">
              <Button variant="outline" loading={loadingMore} onClick={handleLoadMore}>
                Daha fazla yükle
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
