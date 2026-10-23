import { Filter, Inbox, LayoutDashboard, Link2, Settings, type LucideIcon } from "lucide-react";

/** Paket N — CRM ekranları (sekme sırası). Her aşama kendi ekranlarını ekler. */
export interface CrmSection {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const CRM_SECTIONS: CrmSection[] = [
  { href: "/admin/crm", label: "Genel Bakış", icon: LayoutDashboard },
  { href: "/admin/crm/leads", label: "Talepler", icon: Inbox },
  { href: "/admin/crm/funnel", label: "Hasta Yolculuğu", icon: Filter },
  { href: "/admin/crm/utm", label: "UTM Oluşturucu", icon: Link2 },
  { href: "/admin/crm/settings", label: "Ayarlar", icon: Settings },
];
