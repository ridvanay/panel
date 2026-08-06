import PDFDocument from "pdfkit";

export type ExportCellValue = string | number;

/**
 * §10.8.10 — elle CSV üretimi (kullanıcı tarafından onaylanmış karar: `csv-parse` yalnızca
 * PARSE için, yazma için ekstra bağımlılık gerekmiyor). RFC 4180'e uygun kaçış: değer virgül/
 * çift tırnak/satır sonu içeriyorsa çift tırnakla sarılır, iç çift tırnaklar ikizlenir.
 * Başa UTF-8 BOM eklenir — Excel'in Türkçe karakterli CSV'yi doğru açması için.
 */
export function toCsv(columns: string[], rows: ExportCellValue[][]): Buffer {
  const escape = (value: ExportCellValue): string => {
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [columns.map(escape).join(","), ...rows.map((row) => row.map(escape).join(","))];
  const BOM = "﻿";
  return Buffer.from(`${BOM}${lines.join("\r\n")}\r\n`, "utf8");
}

/**
 * §10.8.10 — `pdfkit` ile SADE tablo raporu (kütüphanenin yerleşik bir tablo bileşeni yok,
 * elle sütun genişliği hesaplanır). Büyük satır sayılarında (bkz. reports.constants.ts
 * `EXPORT_ROW_CAPS`) otomatik sayfa taşması `doc.addPage()` ile yönetilir.
 */
export function toPdf(title: string, generatedAt: Date, columns: string[], rows: ExportCellValue[][]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      doc.font("Helvetica-Bold").fontSize(16).text(title);
      doc.font("Helvetica").fontSize(9).fillColor("#555555").text(`Oluşturulma: ${generatedAt.toISOString()}`);
      doc.fillColor("#000000");
      doc.moveDown();

      const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const colWidth = contentWidth / Math.max(columns.length, 1);
      const bottomLimit = doc.page.height - doc.page.margins.bottom;

      const drawRow = (values: ExportCellValue[], bold: boolean) => {
        if (doc.y + 16 > bottomLimit) doc.addPage();
        const y = doc.y;
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
        values.forEach((value, index) => {
          doc.text(String(value), doc.page.margins.left + index * colWidth, y, { width: colWidth - 4, ellipsis: true });
        });
        doc.moveDown(0.9);
      };

      drawRow(columns, true);
      if (rows.length === 0) {
        doc.font("Helvetica").fontSize(9).text("Bu dönem için kayıt bulunamadı.");
      } else {
        for (const row of rows) drawRow(row, false);
      }

      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
