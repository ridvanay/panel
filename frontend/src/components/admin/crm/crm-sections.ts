import { LayoutDashboard, Settings, type LucideIcon } from "lucide-react";

/** Paket N — CRM ekranları (sekme sırası). Her aşama kendi ekranlarını ekler. */
export interface CrmSection {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const CRM_SECTIONS: CrmSection[] = [
  { href: "/admin/crm", label: "Genel Bakış", icon: LayoutDashboard },
  { href: "/admin/crm/settings", label: "Ayarlar", icon: Settings },
];
