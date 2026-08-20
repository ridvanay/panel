import {
  Award,
  BarChart3,
  Bell,
  Book,
  Briefcase,
  Building2,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  Compass,
  CreditCard,
  Flag,
  Gem,
  Gift,
  GraduationCap,
  Handshake,
  Heart,
  Home,
  Key,
  Layers,
  Lightbulb,
  Lock,
  Mail,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  Rocket,
  Settings,
  ShieldCheck,
  Smile,
  Sparkles,
  Star,
  Target,
  ThumbsUp,
  TrendingUp,
  Truck,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * §Faz "Temel Elemanlar" — İkon Kutusu / Buton bloklarının ikon seçicisi. Küratörlü, KAPALI bir
 * allowlist — güvenlik gereği admin girdisinden (bir isim string'i) ASLA dinamik import/require
 * yapılmaz, yalnızca bu sabit `Record`ta bir lookup. Bilinmeyen/eski (silinmiş) bir isim
 * `resolveIcon` ile güvenli bir varsayılana düşer, ASLA hata fırlatmaz veya boş render etmez.
 */
export const ICON_OPTIONS: Record<string, LucideIcon> = {
  Sparkles,
  ShieldCheck,
  Zap,
  Star,
  Heart,
  ThumbsUp,
  CheckCircle2,
  Award,
  Rocket,
  Gift,
  Gem,
  Lightbulb,
  Target,
  TrendingUp,
  Users,
  Compass,
  Flag,
  Bell,
  MessageCircle,
  Camera,
  Book,
  GraduationCap,
  Briefcase,
  Home,
  Building2,
  Handshake,
  Layers,
  Clock,
  Calendar,
  Mail,
  Phone,
  MapPin,
  Lock,
  Key,
  Settings,
  Wrench,
  Package,
  Truck,
  CreditCard,
  BarChart3,
  Smile,
};

export const ICON_OPTION_NAMES = Object.keys(ICON_OPTIONS);

export const DEFAULT_ICON_NAME = "Sparkles";

/** Kayıtlı bir bloktaki (JSON'dan gelen, güvenilmez) `icon` adını güvenli bir bileşene çevirir. */
export function resolveIcon(name: string | undefined): LucideIcon {
  return (name && ICON_OPTIONS[name]) || ICON_OPTIONS[DEFAULT_ICON_NAME]!;
}
