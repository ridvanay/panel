"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { AlertCircle, Receipt } from "lucide-react";
import * as usersApi from "@/lib/api/users";
import type { Order } from "@/lib/api/types";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { formatPriceFromCents } from "@/lib/format-price";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from "@/lib/order-status";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

/**
 * `/hesabim/siparislerim` içerik istemcisi — §customer-portal §2.1. `GET /users/me/orders`
 * ROL GUARD'I TAŞIMAZ (sahiplik filtresi yeterlidir); bir `USER` bu sekmeyi görürse HARD 403
 * DEĞİL, "henüz siparişiniz yok" boş durumu gösterilir (§10.21 §7.4).
 */
export function OrdersListClient() {
  const localize = useLocalizePath();

  const [orders, setOrders] = useState<Order[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setOrders(null);
    setError(null);
    try {
      const page = await usersApi.getMyOrders();
      setOrders(page.items);
      setNextCursor(page.meta.nextCursor);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await usersApi.getMyOrders({ cursor: nextCursor });
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
      <div>
        <h2 className="text-base font-semibold text-foreground">Siparişlerim</h2>
        <p className="mt-1 text-sm text-foreground/60">Geçmiş siparişlerinizin listesi ve durumları.</p>
      </div>

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

      {!error && orders === null ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-[var(--site-primary)]" />
        </div>
      ) : !error && orders && orders.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Henüz siparişiniz yok"
          description="Bir sipariş verdiğinizde burada görünecek."
          action={
            <Link
              href={localize("/products")}
              className="inline-flex items-center rounded-lg bg-[var(--site-button)] px-4 py-2 text-sm font-medium text-[var(--site-button-text)] transition-all duration-300 hover:opacity-85"
            >
              Ürünlere göz at
            </Link>
          }
        />
      ) : !error && orders ? (
        <>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <Card className="overflow-hidden p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sipariş No</TableHead>
                    <TableHead>Tarih</TableHead>
                    <TableHead>Tutar</TableHead>
                    <TableHead>Durum</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={localize(`/hesabim/siparislerim/${order.id}`)}
                          className="text-[var(--site-link,var(--foreground))] underline-offset-2 hover:underline"
                        >
                          {order.orderNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="text-foreground/60">{dateFormatter.format(new Date(order.createdAt))}</TableCell>
                      <TableCell>{formatPriceFromCents(order.totalCents, order.currency)}</TableCell>
                      <TableCell>
                        <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </motion.div>

          {nextCursor && (
            <div className="flex justify-center">
              <Button variant="outline" loading={loadingMore} onClick={handleLoadMore}>
                Daha fazla yükle
              </Button>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
