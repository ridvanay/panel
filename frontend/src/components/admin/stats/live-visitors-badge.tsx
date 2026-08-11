"use client";

import { memo } from "react";
import { useLiveVisitors } from "@/hooks/use-stats";

/**
 * "Şu an sayfa görüntüleyen" rozeti — `useLiveVisitors` (TanStack Query `refetchInterval: 5000`)
 * ile 5 saniyede bir `getLiveVisitors()` çeker.
 *
 * Dürüstlük notu: bilerek "Online kullanıcılar" gibi abartılı bir etiket KULLANMIYORUZ,
 * çünkü backend yalnızca son birkaç dakikada bir sayfa görüntüleme kaydı üretmiş
 * ziyaretçileri sayıyor — gerçek zamanlı bir "bağlı kullanıcı" bilgisi değil.
 *
 * Hata durumunda sessizce gizlenir: bu küçük bir widget, sayfayı bloklayan bir hata
 * göstermemeli.
 */
// `memo` gerekçesi: bkz. visitor-chart.tsx üstündeki not — bu rozet 5sn'de bir kendi
// polling'iyle güncelleniyor, `AdminDashboardPage`'in `summary` state'i değiştikçe de
// gereksiz yere yeniden render edilmesin diye.
export const LiveVisitorsBadge = memo(function LiveVisitorsBadge() {
  const { data, isError } = useLiveVisitors();

  if (isError || data === undefined) return null;

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-surface-muted px-3 py-1.5 text-xs font-medium text-foreground/70">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-success opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
      </span>
      {data.count.toLocaleString("tr-TR")} kişi şu an sayfa görüntülüyor
    </span>
  );
});
