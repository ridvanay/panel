"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Printer } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { BookingInvoice } from "@/lib/api/types";
import { formatPriceFromCents } from "@/lib/format-price";
import { formatDayLabel, formatTime } from "@/lib/telehealth-format";
import { useAuth } from "@/context/auth-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const AUTO_RETRY_DELAY_MS = 700;

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

  /**
   * Bug-fix turu (2026-09-15, frontend-agent) — bu sayfaya `booking-summary-card.tsx`teki fatura
   * linki DÜZ bir `<a href>` (TAM SAYFA yenilemesi) ile ulaşılır. `accessToken` VERİLMEMİŞSE
   * (oturum-bazlı erişim), istek `Authorization: Bearer` header'ına — bellekteki access token'a
   * — güvenir; sayfa TAZE yüklendiğinde bu token henüz refresh-cookie'den geri yüklenmemiş
   * olabilir (`AuthProvider` `status === "loading"`). Bu durumda `load()` ÇAĞRILMAZ, `auth.status`
   * `"authenticated"`/`"unauthenticated"`e geçince (settled) tetiklenir. `accessToken` VERİLMİŞSE
   * (misafir/magic-link, public erişim) auth context'in beklenmesine hiç GEREK YOK.
   */
  const auth = useAuth();
  const waitingForSession = !accessToken && auth.status === "loading";
  /**
   * Başarısız deneme SAYACI (state — bir `ref` DEĞİL: render sırasında bir ref'in `.current`ını
   * OKUMAK React kurallarını ihlal eder, `code-quality-agent`ın lint kuralı bunu hata olarak
   * işaretler). `0` → henüz hiç deneme yok/ilk yükleme sürüyor, `1` → İLK deneme başarısız oldu
   * (otomatik sessiz tekrar deneme BEKLENİYOR), `2+` → tekrar deneme de başarısız oldu, gerçek
   * hata ekranı gösterilir. Başarıda `0`a sıfırlanır.
   */
  const [failedAttempts, setFailedAttempts] = useState(0);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await telehealthApi.getBookingInvoice(bookingId, accessToken);
      setInvoice(result);
      setFailedAttempts(0);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
      setFailedAttempts((prev) => prev + 1);
    }
  }, [bookingId, accessToken]);

  useEffect(() => {
    if (waitingForSession) return;
    (async () => {
      await load();
    })();
  }, [load, waitingForSession]);

  // Kullanıcının açıkça istediği otomatik 1 kez sessiz tekrar deneme — auth-bekleme düzeltmesi
  // yarış durumunu ORTADAN KALDIRIR, ama ağdaki geçici tekil hatalara karşı ek bir güvenlik ağı.
  // `failedAttempts === 1` KOŞULU sonsuz döngüyü ÖNLER: yalnızca TAM OLARAK ilk başarısız denemede
  // bir kez tetiklenir (`0`/ilk yükleme VEYA `2+`/ikinci-ve-sonrası başarısız denemede TETİKLENMEZ).
  useEffect(() => {
    if (failedAttempts !== 1 || waitingForSession) return;
    const timer = setTimeout(() => {
      void load();
    }, AUTO_RETRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [failedAttempts, waitingForSession, load]);

  // `failedAttempts < 2` iken (henüz otomatik tekrar deneme YAPILMADI/sürüyor) ilk hata SESSİZCE
  // gizlenir, iskelet gösterilmeye devam eder — kullanıcı hiçbir hata GÖRMEZ.
  if (waitingForSession || (invoice === null && failedAttempts < 2)) {
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
