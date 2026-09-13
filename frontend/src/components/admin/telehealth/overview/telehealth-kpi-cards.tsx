import { StatCard } from "@/components/admin/stats/stat-card";
import { Badge } from "@/components/ui/badge";
import { formatPriceFromCents } from "@/lib/format-price";
import type { TelehealthOverview } from "@/lib/api/types";

interface TelehealthKpiCardsProps {
  data: TelehealthOverview;
}

/**
 * `admin/stats/page.tsx`'teki üst KPI kart grid'iyle AYNI görsel dil (`StatCard`) — beş kart
 * `grid gap-4 sm:grid-cols-2 lg:grid-cols-5` (mevcut stats grid'iyle tutarlı, yalnızca sütun
 * sayısı 5'e çıkarılmış).
 */
export function TelehealthKpiCards({ data }: TelehealthKpiCardsProps) {
  return (
    <div className="space-y-2">
      {data.mixedCurrency && (
        <div>
          <Badge tone="warning">Karışık para birimi — gelir toplamları yaklaşıktır</Badge>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Tamamlanan Seans" value={data.appointments.completed.toLocaleString("tr-TR")} />
        <StatCard
          label="Yaklaşan Randevu"
          value={(data.appointments.scheduled + data.appointments.inProgress).toLocaleString("tr-TR")}
        />
        <StatCard
          label="İptal / Gelmedi"
          value={(data.appointments.cancelled + data.appointments.noShow).toLocaleString("tr-TR")}
        />
        <StatCard label="Ödeme Bekleyen" value={data.appointments.pendingPayment.toLocaleString("tr-TR")} />
        <StatCard
          label="Komisyon Geliri"
          value={formatPriceFromCents(data.revenue.commissionCents, data.currency)}
          delta={{ value: `%${data.commissionRatePercent}`, direction: "up", isGood: true }}
        />
      </div>
    </div>
  );
}
