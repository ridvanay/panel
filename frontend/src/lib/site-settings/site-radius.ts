import type { SiteBorderRadius } from "@/lib/api/types";

/**
 * `SiteBorderRadius` (kapalı enum, backend/prisma ile AYNI 5 değer) → gerçek px karşılığı.
 * `.claude/architect-scope-theme-typography.md` "Frontend değişiklikleri" bölümü — `(site)/layout.tsx`
 * VE `admin/appearance/page.tsx` önizlemesi bu map'i AYNI şekilde kullanır (`--site-radius`), ui-designer
 * radyo-buton önizlemesi de (design-notes-theme-typography.md §3.1) BİREBİR aynı px değerlerini gösterir.
 */
export const SITE_BORDER_RADIUS_PX: Record<SiteBorderRadius, string> = {
  NONE: "0px",
  SM: "4px",
  MD: "8px",
  LG: "16px",
  FULL: "9999px",
};
