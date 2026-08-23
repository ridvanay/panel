import { ShieldCheck, ShieldHalf, ShoppingBag, SquarePen, User as UserIcon, type LucideIcon } from "lucide-react";
import type { SiteRole } from "@/lib/api/types";

/**
 * §10.21 (`.claude/architect-scope-rbac-5-tier.md` §1.2) — Rol rozetleri. Etiketler BAĞLAYICI
 * ve tek kaynaktır; her ajan/ekran AYNISINI kullanır. Yetenek bayrağı (`advancedBuilderEnabled`)
 * kaldırıldığı için (§3) rozet artık SALT rolden türer — ikinci bir "gelişmiş/standart" ekseni
 * YOKTUR. Hem `/admin/users` hem başka bir ekranda AYNI kaynaktan okunur — `admin/users/page.tsx`
 * teki `roleLabels` (çıplak rol adı, dropdown seçenekleri için) BU yardımcının YERİNE geçmez,
 * onu tamamlar.
 */
export interface RoleBadgeInfo {
  label: string;
  icon: LucideIcon;
  tone: "primary" | "neutral";
  solid: boolean;
}

/**
 * Görsel ağırlık ayrıcalık sırasını yansıtır (ADMIN → USER, azalan): `ADMIN` `solid` +
 * `primary` (sistemdeki en yüksek yetki), `MANAGER` `soft` + `primary` (panelin geri kalanı,
 * ADMIN'e en yakın), `EDITOR`/`CUSTOMER`/`USER` `soft` + `neutral`. Mevcut projedeki
 * soft-varsayılan rozet kullanım yoğunluğuyla tutarlı — yeni bir ton/renk İCAT EDİLMEDİ (yalnızca
 * `Badge` bileşeninin var olan `primary`/`neutral` tonları kullanılıyor).
 */
export function getRoleBadgeInfo(user: { role: SiteRole }): RoleBadgeInfo {
  switch (user.role) {
    case "ADMIN":
      return { label: "Süper Yönetici", icon: ShieldCheck, tone: "primary", solid: true };
    case "MANAGER":
      return { label: "Yönetici", icon: ShieldHalf, tone: "primary", solid: false };
    case "EDITOR":
      return { label: "Editör", icon: SquarePen, tone: "neutral", solid: false };
    case "CUSTOMER":
      return { label: "Müşteri", icon: ShoppingBag, tone: "neutral", solid: false };
    case "USER":
      return { label: "Standart Üye", icon: UserIcon, tone: "neutral", solid: false };
  }
}
