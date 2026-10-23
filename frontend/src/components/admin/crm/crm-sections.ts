import { Activity, Search, Filter, Flame, Globe2, Inbox, LayoutDashboard, Link2, MousePointerClick, Network, Settings, Share2, Users, type LucideIcon } from "lucide-react";

/** Paket N — CRM ekranları (sekme sırası). Her aşama kendi ekranlarını ekler. */
export interface CrmSection {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const CRM_SECTIONS: CrmSection[] = [
  { href: "/admin/crm", label: "Genel Bakış", icon: LayoutDashboard },
  { href: "/admin/crm/live", label: "Şu An Sitede", icon: Activity },
  { href: "/admin/crm/leads", label: "Talepler", icon: Inbox },
  { href: "/admin/crm/funnel", label: "Hasta Yolculuğu", icon: Filter },
  { href: "/admin/crm/visitors", label: "Ziyaretçiler", icon: Users },
  { href: "/admin/crm/pages", label: "Sayfa Haritası", icon: Network },
  { href: "/admin/crm/sources", label: "Kaynaklar", icon: Share2 },
  { href: "/admin/crm/audience", label: "Ülke ve Dil", icon: Globe2 },
  { href: "/admin/crm/heatmap", label: "Isı Haritası", icon: Flame },
  { href: "/admin/crm/clicks", label: "Tıklamalar", icon: MousePointerClick },
  { href: "/admin/crm/keywords", label: "Anahtar Kelimeler", icon: Search },
  { href: "/admin/crm/utm", label: "UTM Oluşturucu", icon: Link2 },
  { href: "/admin/crm/settings", label: "Ayarlar", icon: Settings },
];
