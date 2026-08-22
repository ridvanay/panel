import { Eye, PencilSparkles, ShieldCheck, SquarePen, type LucideIcon } from "lucide-react";
import type { SiteRole } from "@/lib/api/types";

/**
 * §10.20 — Rol/yetenek rozetleri. `.claude/architect-scope-page-editor-roles.md` §1.2 tablosu
 * BİREBİR (kaynak) + `.claude/design-notes-page-builder-standard-mode.md` Karar 3 (ikon/ton
 * seçimi — BAĞLAYICI, ui-designer kararı). Hem `/admin/users` (yetenek sütunu) hem gerekirse
 * başka bir ekranda AYNI kaynaktan okunur — `admin/users/page.tsx`teki `roleLabels` (çıplak rol
 * adı, dropdown seçenekleri için) BU yardımcının YERİNE geçmez, onu tamamlar.
 */
export interface RoleBadgeInfo {
  label: string;
  icon: LucideIcon;
  tone: "primary" | "neutral";
  solid: boolean;
}

/**
 * `role === "ADMIN"` → `solid`: ADMIN sistemdeki en yüksek yetki seviyesi ve
 * `canUseAdvancedBuilder`e bakılmaksızın HER ZAMAN gelişmiş — görsel ağırlıkta da bunu yansıtır.
 * Diğer üç durum `soft` (`solid: false`) — projedeki mevcut soft-varsayılan rozet kullanım
 * yoğunluğuyla tutarlı (bkz. design-notes Karar 3 gerekçesi).
 */
export function getRoleBadgeInfo(user: { role: SiteRole; canUseAdvancedBuilder: boolean }): RoleBadgeInfo {
  if (user.role === "ADMIN") {
    return { label: "Yönetici", icon: ShieldCheck, tone: "primary", solid: true };
  }
  if (user.role === "EDITOR" && user.canUseAdvancedBuilder) {
    return { label: "Editör (Gelişmiş Düzenleyici)", icon: PencilSparkles, tone: "primary", solid: false };
  }
  if (user.role === "EDITOR") {
    return { label: "Yazar (Standart Düzenleyici)", icon: SquarePen, tone: "neutral", solid: false };
  }
  return { label: "İzleyici", icon: Eye, tone: "neutral", solid: false };
}
