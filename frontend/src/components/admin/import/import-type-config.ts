import { FileText, Newspaper, Users as UsersIcon, Image as ImageIcon, Globe } from "lucide-react";
import type { ImportJobType } from "@/lib/api/types";

/**
 * İçe aktarma türü başına istemci-taraflı gösterim/ipucu bilgisi (openapi.yaml
 * `POST /admin/import/jobs` açıklamasındaki boyut/kayıt limitleriyle BİREBİR — bkz.
 * ARCHITECTURE.md §10.8.5). Bu limitler yalnızca kullanıcıya ÖNCEDEN ipucu vermek
 * içindir; asıl doğrulama HER ZAMAN sunucudadır (`format` istemciden alınmaz).
 */
export interface ImportTypeConfig {
  type: ImportJobType;
  label: string;
  description: string;
  icon: typeof FileText;
  /** `<input accept>` ipucu — sunucu gerçek doğrulamayı magic bytes ile yapar. */
  accept: string;
  formatHint: string;
  maxSizeLabel: string;
  maxRecordsLabel: string;
}

export const IMPORT_TYPE_CONFIGS: ImportTypeConfig[] = [
  {
    type: "PAGES",
    label: "Sayfalar",
    description: "CSV veya JSON dosyasından statik sayfa içe aktarın.",
    icon: FileText,
    accept: ".csv,.json,text/csv,application/json",
    formatHint: "CSV veya JSON",
    maxSizeLabel: "10 MB",
    maxRecordsLabel: "en fazla 5.000 kayıt",
  },
  {
    type: "BLOG",
    label: "Blog Yazıları",
    description: "CSV veya JSON dosyasından blog yazısı içe aktarın.",
    icon: Newspaper,
    accept: ".csv,.json,text/csv,application/json",
    formatHint: "CSV veya JSON",
    maxSizeLabel: "10 MB",
    maxRecordsLabel: "en fazla 5.000 kayıt",
  },
  {
    type: "WORDPRESS",
    label: "WordPress (WXR)",
    description: "WordPress dışa aktarma dosyasından (.xml) sayfa, yazı ve kategorileri içe aktarın.",
    icon: Globe,
    accept: ".xml,text/xml,application/xml",
    formatHint: "WXR (XML)",
    maxSizeLabel: "50 MB",
    maxRecordsLabel: "en fazla 10.000 öğe",
  },
  {
    type: "USERS",
    label: "Kullanıcılar",
    description: "CSV dosyasından yeni kullanıcı hesapları oluşturun.",
    icon: UsersIcon,
    accept: ".csv,text/csv",
    formatHint: "CSV",
    maxSizeLabel: "10 MB",
    maxRecordsLabel: "en fazla 500 kayıt",
  },
  {
    type: "MEDIA",
    label: "Medya",
    description: "ZIP arşivinden görsel/dosyaları medya kütüphanesine yükleyin.",
    icon: ImageIcon,
    accept: ".zip,application/zip",
    formatHint: "ZIP",
    maxSizeLabel: "100 MB",
    maxRecordsLabel: "en fazla 500 dosya",
  },
];

export function importTypeConfig(type: ImportJobType): ImportTypeConfig {
  const config = IMPORT_TYPE_CONFIGS.find((c) => c.type === type);
  if (!config) throw new Error(`Bilinmeyen içe aktarma türü: ${type}`);
  return config;
}

export function importTypeLabel(type: ImportJobType): string {
  return importTypeConfig(type).label;
}
