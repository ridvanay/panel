import type { CsvColumn } from "@/lib/export-csv";
import type { UserSummary } from "@/lib/api/types";
import type { ContentListEntity } from "./types";

/**
 * Sayfalar ve Blog listelerinin PAYLAŞTIĞI dışa aktarma sütunları (bkz. ARCHITECTURE.md
 * §10.8.9) — "Tümünü Dışa Aktar" / "Seçilenleri Dışa Aktar" ikisi de bunu kullanır, iki
 * sayfada da kopyalanmaz. `getCategory` yalnızca Blog için verilir (Sayfalar'da kategori
 * kavramı yok).
 */
export function buildContentCsvColumns<T extends ContentListEntity>(getCategory?: (item: T) => string): CsvColumn<T>[] {
  const columns: CsvColumn<T>[] = [
    { key: "title", label: "Başlık" },
    { key: "slug", label: "Slug" },
    {
      key: "status",
      label: "Durum",
      format: (value) => (value === "PUBLISHED" ? "Yayında" : "Taslak"),
    },
    {
      key: "author",
      label: "Yazar",
      format: (value) => (value as UserSummary | null)?.name ?? "—",
    },
  ];

  if (getCategory) {
    columns.push({
      key: "id",
      label: "Kategori",
      format: (_value, row) => getCategory(row),
    });
  }

  columns.push(
    {
      key: "viewCount",
      label: "Görüntülenme",
      format: (value) => String(value),
    },
    {
      key: "publishedAt",
      label: "Yayın Tarihi",
      format: (value) => (value ? new Date(value as string).toLocaleDateString("tr-TR") : "—"),
    },
    {
      key: "updatedAt",
      label: "Son Güncelleme",
      format: (value) => new Date(value as string).toLocaleDateString("tr-TR"),
    }
  );

  return columns;
}
