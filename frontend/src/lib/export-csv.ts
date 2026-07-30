export interface CsvColumn<T> {
  key: keyof T;
  label: string;
  format?: (value: T[keyof T], row: T) => string;
}

function escapeCsvValue(value: string): string {
  // Virgül, tırnak veya satır sonu içeriyorsa çift tırnak içine al, iç tırnakları ikile.
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Bir kayıt dizisini, verilen sütun tanımlarına göre CSV dosyasına dönüştürüp
 * tarayıcıda indirmeyi tetikler. Excel'in UTF-8'i doğru tanıması (Türkçe
 * karakterlerin bozulmaması) için dosyanın başına BOM eklenir.
 */
export function exportToCsv<T extends object>(
  filename: string,
  rows: T[],
  columns: CsvColumn<T>[]
): void {
  const header = columns.map((c) => escapeCsvValue(c.label)).join(",");
  const lines = rows.map((row) =>
    columns
      .map((c) => escapeCsvValue(c.format ? c.format(row[c.key], row) : String(row[c.key] ?? "")))
      .join(",")
  );
  const csv = [header, ...lines].join("\r\n");
  const BOM = "﻿";
  const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
