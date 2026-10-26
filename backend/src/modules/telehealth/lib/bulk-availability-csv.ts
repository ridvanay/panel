import { parse as parseCsvSync } from "csv-parse/sync";
import type { WeeklyRule } from "./weekly-availability";
import { TIME_OFF_KINDS, type TimeOffKind } from "./time-off";
import { getWallClockParts, type CalendarDate } from "./timezone";

/**
 * Paket Q — toplu çalışma saati/izin CSV'si. Excel uyumlu: UTF-8 BOM, `;` (varsayılan) ya da `,`
 * ayraç, `#` ile başlayan açıklama satırları. Okurken ayraç otomatik algılanır (`;`/`,`/sekme),
 * başlık sırası ve Türkçe karakter/büyük-küçük harf önemsizdir. Bu modül YALNIZCA biçim
 * ayrıştırır; doktor/çakışma/geçmiş tarih doğrulaması `lib/bulk-availability.ts`'tedir.
 */
export const BULK_CSV_MAX_BYTES = 2 * 1024 * 1024;
export const BULK_CSV_MAX_ROWS = 5000;

/** UTF-8 BOM (U+FEFF) — kaynakta görünmez karakter yerine kod noktasıyla üretilir. */
const BOM = String.fromCharCode(0xfeff);
const BOM_PREFIX = new RegExp(`^${BOM}`);

export const BULK_CSV_COLUMNS = [
  "doktor_kodu",
  "doktor_adi",
  "kayit_turu",
  "gun",
  "baslangic_tarihi",
  "bitis_tarihi",
  "baslangic_saati",
  "bitis_saati",
  "izin_turu",
  "not",
] as const;
type Column = (typeof BULK_CSV_COLUMNS)[number];

export type CsvDelimiter = ";" | ",";

export interface BulkRowError {
  /** Dosyadaki satır numarası (Excel satırı); dosya geneli hatalarda `null`. */
  row: number | null;
  message: string;
}

export type ParsedBulkRow =
  | { row: number; doctorSlug: string; type: "WORK"; dayOfWeek: number; startMinute: number; endMinute: number }
  | {
      row: number;
      doctorSlug: string;
      type: "TIME_OFF";
      startDate: CalendarDate;
      endDate: CalendarDate;
      startMinute: number | null;
      endMinute: number | null;
      kind: TimeOffKind;
      note: string | null;
    };

/** Türkçe karakter + büyük/küçük harf bağımsız anahtar (`Gün` → `gun`, `İZİN` → `izin`). */
export function foldKey(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/[\s-]+/g, "_");
}

const DAY_ALIASES: Record<string, number> = {};
(
  [
    [1, ["pzt", "pts", "pazartesi", "mon", "monday", "1"]],
    [2, ["sal", "sali", "tue", "tues", "tuesday", "2"]],
    [3, ["car", "crs", "carsamba", "wed", "wednesday", "3"]],
    [4, ["per", "prs", "persembe", "thu", "thur", "thurs", "thursday", "4"]],
    [5, ["cum", "cuma", "fri", "friday", "5"]],
    [6, ["cmt", "cumartesi", "sat", "saturday", "6"]],
    [7, ["paz", "pazar", "sun", "sunday", "7"]],
  ] as const
).forEach(([day, names]) => names.forEach((n) => (DAY_ALIASES[n] = day)));

export const DAY_LABELS_TR = ["", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"] as const;

const TIME_OFF_KIND_ALIASES: Record<string, TimeOffKind> = {
  tatil: "VACATION",
  vacation: "VACATION",
  kongre: "CONGRESS",
  congress: "CONGRESS",
  ameliyat: "SURGERY_DAY",
  ameliyat_gunu: "SURGERY_DAY",
  surgery_day: "SURGERY_DAY",
  surgery: "SURGERY_DAY",
  diger: "OTHER",
  other: "OTHER",
};
export const TIME_OFF_KIND_CSV: Record<TimeOffKind, string> = { VACATION: "TATIL", CONGRESS: "KONGRE", SURGERY_DAY: "AMELIYAT", OTHER: "DIGER" };

/** `09:00`, `9:00`, `09:00:00` ya da Excel zaman kesri (`0,375`) → gün içi dakika (0–1440). */
export function parseTimeCell(raw: string): number | null | "invalid" {
  const value = raw.trim();
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    const sec = m[3] ? Number(m[3]) : 0;
    if (min > 59 || sec > 59 || h > 24 || (h === 24 && (min > 0 || sec > 0))) return "invalid";
    return h * 60 + min;
  }
  if (/^(0([.,]\d+)?|1([.,]0+)?)$/.test(value)) {
    return Math.round(Number(value.replace(",", ".")) * 1440);
  }
  return "invalid";
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function validCalendarDate(year: number, month: number, day: number): CalendarDate | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** `GG.AA.YYYY` (ya da `G/A/YYYY`), `YYYY-AA-GG` ya da Excel seri numarası (`46050`). */
export function parseDateCell(raw: string): CalendarDate | null | "invalid" {
  const value = raw.trim();
  if (!value) return null;
  let m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(value);
  if (m) return validCalendarDate(Number(m[3]), Number(m[2]), Number(m[1])) ?? "invalid";
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (m) return validCalendarDate(Number(m[1]), Number(m[2]), Number(m[3])) ?? "invalid";
  if (/^\d{5}$/.test(value)) {
    const serial = Number(value);
    if (serial < 20000 || serial > 80000) return "invalid";
    const d = new Date(EXCEL_EPOCH_MS + serial * 86_400_000);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  }
  return "invalid";
}

/** UTF-8 (BOM'lu/BOM'suz) önce denenir; geçersizse Türkçe Excel'in varsayılanı Windows-1254. */
export function decodeCsvBuffer(buffer: Buffer): string {
  let bytes = buffer;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1254").decode(bytes);
  }
}

/** Başlık satırında (ilk açıklama-dışı satır) tırnak dışındaki `;`, `,`, sekme sayısına göre. */
export function detectDelimiter(text: string): ";" | "," | "\t" {
  const header = text.split(/\r?\n/).find((line) => line.trim() !== "" && !line.trimStart().startsWith("#")) ?? "";
  const counts = { ";": 0, ",": 0, "\t": 0 };
  let quoted = false;
  for (const ch of header) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch as keyof typeof counts]++;
  }
  if (counts["\t"] > counts[";"] && counts["\t"] > counts[","]) return "\t";
  return counts[","] > counts[";"] ? "," : ";";
}

/** Dışa aktarmada eklenen CSV-injection öneki (`'=...`) geri okunurken kaldırılır. */
function unneutralize(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

export function parseBulkCsv(buffer: Buffer): { rows: ParsedBulkRow[]; errors: BulkRowError[]; rowCount: number } {
  const errors: BulkRowError[] = [];
  const text = decodeCsvBuffer(buffer);
  // İnceleme bulgusu — senkron ayrıştırmadan ÖNCE kaba satır sınırı (açıklama/boş satırlar için pay bırakılır).
  const rawLines = text.split("\n").length;
  if (rawLines > BULK_CSV_MAX_ROWS + 1000) {
    return { rows: [], errors: [{ row: null, message: `Dosyada en fazla ${BULK_CSV_MAX_ROWS} satır olabilir (${rawLines} satır var).` }], rowCount: rawLines };
  }
  let records: { record: string[]; info: { lines: number } }[];
  try {
    records = parseCsvSync(text, {
      delimiter: detectDelimiter(text),
      comment: "#",
      comment_no_infix: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      skip_records_with_empty_values: true,
      trim: true,
      info: true,
    }) as unknown as { record: string[]; info: { lines: number } }[];
  } catch (err) {
    return { rows: [], errors: [{ row: null, message: `CSV dosyası okunamadı: ${(err as Error).message}` }], rowCount: 0 };
  }
  if (records.length === 0) return { rows: [], errors: [{ row: null, message: "Dosyada başlık satırı yok." }], rowCount: 0 };

  const [headerRecord, ...dataRecords] = records;
  const index: Partial<Record<Column, number>> = {};
  headerRecord!.record.forEach((cell, i) => {
    const key = foldKey(cell.replace(BOM_PREFIX, "")) as Column;
    if ((BULK_CSV_COLUMNS as readonly string[]).includes(key) && index[key] === undefined) index[key] = i;
  });
  const missing = (["doktor_kodu", "kayit_turu"] as const).filter((c) => index[c] === undefined);
  if (missing.length > 0) {
    return { rows: [], errors: [{ row: headerRecord!.info.lines, message: `Başlıkta zorunlu sütun eksik: ${missing.join(", ")}.` }], rowCount: 0 };
  }
  if (dataRecords.length > BULK_CSV_MAX_ROWS) {
    return { rows: [], errors: [{ row: null, message: `Dosyada en fazla ${BULK_CSV_MAX_ROWS} satır olabilir (${dataRecords.length} satır var).` }], rowCount: dataRecords.length };
  }

  const rows: ParsedBulkRow[] = [];
  for (const { record, info } of dataRecords) {
    const row = info.lines;
    const cell = (c: Column) => unneutralize(index[c] === undefined ? "" : (record[index[c]!] ?? "").trim());
    const fail = (message: string) => errors.push({ row, message });
    const doctorSlug = cell("doktor_kodu").toLowerCase();
    if (!doctorSlug) {
      fail("doktor_kodu boş.");
      continue;
    }
    const type = foldKey(cell("kayit_turu"));
    const startTime = parseTimeCell(cell("baslangic_saati"));
    const endTime = parseTimeCell(cell("bitis_saati"));
    if (startTime === "invalid") fail(`Geçersiz başlangıç saati "${cell("baslangic_saati")}" (SS:DD bekleniyor).`);
    if (endTime === "invalid") fail(`Geçersiz bitiş saati "${cell("bitis_saati")}" (SS:DD bekleniyor).`);
    if (startTime === "invalid" || endTime === "invalid") continue;

    if (type === "calisma" || type === "work") {
      const dayOfWeek = DAY_ALIASES[foldKey(cell("gun")).replace(/\.$/, "")];
      if (!dayOfWeek) {
        fail(`Geçersiz gün "${cell("gun")}" (Pzt, Sal, Çar, Per, Cum, Cmt, Paz).`);
        continue;
      }
      if (startTime === null || endTime === null) {
        fail("CALISMA satırında başlangıç ve bitiş saati zorunlu.");
        continue;
      }
      if (endTime <= startTime) {
        fail("Bitiş saati başlangıç saatinden sonra olmalı.");
        continue;
      }
      rows.push({ row, doctorSlug, type: "WORK", dayOfWeek, startMinute: startTime, endMinute: endTime });
    } else if (type === "izin" || type === "time_off") {
      const startDate = parseDateCell(cell("baslangic_tarihi"));
      const endDateRaw = parseDateCell(cell("bitis_tarihi"));
      if (startDate === null) {
        fail("IZIN satırında başlangıç tarihi zorunlu.");
        continue;
      }
      if (startDate === "invalid" || endDateRaw === "invalid") {
        fail("Geçersiz tarih (GG.AA.YYYY bekleniyor).");
        continue;
      }
      if ((startTime === null) !== (endTime === null)) {
        fail("Saatli izinde başlangıç ve bitiş saati birlikte yazılmalı; tam gün izinde ikisi de boş bırakılmalı.");
        continue;
      }
      const kindKey = foldKey(cell("izin_turu"));
      const kind = kindKey ? TIME_OFF_KIND_ALIASES[kindKey] : "OTHER";
      if (!kind) {
        fail(`Geçersiz izin türü "${cell("izin_turu")}" (TATIL, KONGRE, AMELIYAT, DIGER).`);
        continue;
      }
      const note = cell("not");
      if (note.length > 500) {
        fail("Not en fazla 500 karakter olabilir.");
        continue;
      }
      rows.push({
        row,
        doctorSlug,
        type: "TIME_OFF",
        startDate,
        endDate: endDateRaw ?? startDate,
        startMinute: startTime,
        endMinute: endTime,
        kind,
        note: note || null,
      });
    } else {
      fail(`Geçersiz kayit_turu "${cell("kayit_turu")}" (CALISMA ya da IZIN).`);
    }
  }
  return { rows, errors, rowCount: dataRecords.length };
}

// ---------------------------------------------------------------------------------------------
// Şablon (dışa aktarma)
// ---------------------------------------------------------------------------------------------

const CSV_FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/** CSV injection koruması (bkz. `reports.format.ts`) + ayraca duyarlı RFC 4180 kaçışı. */
export function escapeCsvCell(value: string, delimiter: CsvDelimiter): string {
  const str = CSV_FORMULA_TRIGGER.test(value) ? `'${value}` : value;
  return str.includes(delimiter) || /["\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export const formatMinute = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const formatDate = (d: CalendarDate) => `${String(d.day).padStart(2, "0")}.${String(d.month).padStart(2, "0")}.${d.year}`;

export interface TemplateDoctor {
  slug: string;
  title: string;
  fullName: string;
  timeZone: string;
  rules: WeeklyRule[];
  timeOff: { startsAt: Date; endsAt: Date; kind: string; allDay: boolean; note: string | null }[];
}

export function buildBulkTemplate(doctors: readonly TemplateDoctor[], delimiter: CsvDelimiter): Buffer {
  const d = delimiter;
  const comments = [
    "# WM Health toplu çalışma saati ve izin şablonu. # ile başlayan satırlar okunmaz.",
    "# Saatler doktorun KENDİ saat diliminde yazılır (varsayılan Türkiye saati GMT+3). Doktorun saat dilimi doktor_adi sütununda yazar.",
    "# kayit_turu: CALISMA (haftalık saat) ya da IZIN. gun: Pzt Sal Çar Per Cum Cmt Paz. Tarih GG.AA.YYYY. Saat SS:DD.",
    "# Aynı gün için birden çok CALISMA satırı yazılabilir (ör. 09:00-12:00 ve 14:00-17:00). Tam gün izinde saatleri boş bırakın.",
    "# izin_turu: TATIL KONGRE AMELIYAT DIGER. not iç nottur ve hastaya gösterilmez. Sağlık verisi yazmayın.",
    "# CALISMA satırı olan doktorun haftalık saatleri dosyadakiyle değiştirilir. Dosyada olmayan doktorlara dokunulmaz. İzinler yalnızca eklenir.",
    `# Örnek: dr-ornek${d}Dr. Örnek${d}CALISMA${d}Pzt${d}${d}${d}09:00${d}12:00${d}${d}`,
    `# Örnek: dr-ornek${d}Dr. Örnek${d}CALISMA${d}Pzt${d}${d}${d}14:00${d}17:00${d}${d}`,
    `# Örnek: dr-ornek${d}Dr. Örnek${d}IZIN${d}${d}20.11.2026${d}22.11.2026${d}${d}${d}KONGRE${d}Yıllık kongre`,
  ];
  const lines: string[] = [...comments, BULK_CSV_COLUMNS.join(d)];
  for (const doctor of doctors) {
    const name = `${doctor.title} ${doctor.fullName} (${doctor.timeZone})`.trim();
    const row = (cells: string[]) => lines.push(cells.map((c) => escapeCsvCell(c, d)).join(d));
    for (const rule of doctor.rules) {
      if (!rule.isActive) continue;
      row([doctor.slug, name, "CALISMA", DAY_LABELS_TR[rule.dayOfWeek]!, "", "", formatMinute(rule.startMinute), formatMinute(rule.endMinute), "", ""]);
    }
    for (const t of doctor.timeOff) {
      const s = getWallClockParts(t.startsAt, doctor.timeZone);
      const e = getWallClockParts(t.endsAt, doctor.timeZone);
      const midnightBounds = s.hour === 0 && s.minute === 0 && e.hour === 0 && e.minute === 0;
      const kind = TIME_OFF_KIND_CSV[(TIME_OFF_KINDS as readonly string[]).includes(t.kind) ? (t.kind as TimeOffKind) : "OTHER"];
      if (t.allDay && midnightBounds) {
        const lastDay = new Date(Date.UTC(e.year, e.month - 1, e.day - 1));
        const end = { year: lastDay.getUTCFullYear(), month: lastDay.getUTCMonth() + 1, day: lastDay.getUTCDate() };
        row([doctor.slug, name, "IZIN", "", formatDate(s), formatDate(end), "", "", kind, t.note ?? ""]);
      } else {
        row([doctor.slug, name, "IZIN", "", formatDate(s), formatDate(e), formatMinute(s.hour * 60 + s.minute), formatMinute(e.hour * 60 + e.minute), kind, t.note ?? ""]);
      }
    }
  }
  return Buffer.from(`${BOM}${lines.join("\r\n")}\r\n`, "utf8");
}
