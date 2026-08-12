"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * §10.12.8 — `/admin/navigation` ve `/admin/settings`'te KOPYALANMIŞ olan
 * `beforeunload` + capture-phase link tıklaması + `window.confirm` desenini tek bir yere
 * çıkarır. Üçüncü bir kopya (`/admin/appearance`, dokuz bölümlü panel) bu tekrarı
 * sürdürülemez kılacağı için ARCHITECTURE.md §10.12.8 bu refactor'ü bu görevin kapsamına
 * dahil eder — davranış BİREBİR aynı kalır, sadece kod paylaşılır.
 */
export const UNSAVED_CHANGES_WARNING = "Kaydedilmemiş değişiklikleriniz var. Yine de ayrılmak istiyor musunuz?";

export interface UseUnsavedChangesGuardOptions {
  /** `false` iken hiçbir efekt/uyarı devrede değildir (temiz durum). */
  enabled: boolean;
  /** Varsayılan `UNSAVED_CHANGES_WARNING` — çağıran taraf farklı bir metin isterse geçebilir. */
  message?: string;
}

export interface UseUnsavedChangesGuardResult {
  /** Uygulama-içi geçişler (ör. sekme değişimi) için: onaylanırsa `true`, vazgeçilirse `false` döner. */
  confirmDiscard: () => boolean;
}

/**
 * Kaydedilmemiş değişiklik varken:
 * 1. Sekme kapatma/yenileme/tamamen ayrılma girişiminde tarayıcının native `beforeunload` uyarısını gösterir.
 * 2. `/admin` altındaki bir bağlantıya (capture-phase) tıklanınca `window.confirm` ile onay ister — Next.js App
 *    Router'da global bir route-change event'i olmadığı için bu şekilde yakalanır.
 * 3. Uygulama-içi geçişler (ör. `Tabs.onValueChange`) `confirmDiscard()`'ı senkron çağırıp dönen değere göre karar verir.
 */
export function useUnsavedChangesGuard({
  enabled,
  message = UNSAVED_CHANGES_WARNING,
}: UseUnsavedChangesGuardOptions): UseUnsavedChangesGuardResult {
  const pathname = usePathname();

  useEffect(() => {
    if (!enabled) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    function handleDocumentClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const link = target?.closest("a");
      const href = link?.getAttribute("href");
      if (!href || !href.startsWith("/admin") || href === pathname) return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [enabled, pathname, message]);

  function confirmDiscard(): boolean {
    if (!enabled) return true;
    return window.confirm(message);
  }

  return { confirmDiscard };
}
