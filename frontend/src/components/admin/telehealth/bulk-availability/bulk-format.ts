import type { BulkRule } from "@/lib/api/types";

/** Paket Q — toplu çalışma saati/izin ekranında ortak biçimlendirme (yalnızca TR admin arayüzü). */
export const DAY_SHORT_TR = ["", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"] as const;

export const formatMinute = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export const ruleRange = (r: Pick<BulkRule, "startMinute" | "endMinute">) => `${formatMinute(r.startMinute)}–${formatMinute(r.endMinute)}`;

export const ruleKey = (r: BulkRule) => `${r.dayOfWeek}:${r.startMinute}-${r.endMinute}:${r.isActive ? 1 : 0}`;

/** Kural listesini gün → aralıklar biçiminde gruplar (yalnızca dolu günler, Pzt→Paz). */
export function groupByDay(rules: readonly BulkRule[]): { day: number; rules: BulkRule[] }[] {
  const days = new Map<number, BulkRule[]>();
  for (const r of [...rules].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute)) {
    days.set(r.dayOfWeek, [...(days.get(r.dayOfWeek) ?? []), r]);
  }
  return [...days.entries()].map(([day, list]) => ({ day, rules: list }));
}

/** Tarayıcıda dosyayı base64'e çevirir (FileReader — dosya sunucuda diske yazılmaz). */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Dosya okunamadı."));
    reader.readAsDataURL(file);
  });
}

export const BULK_MAX_FILE_BYTES = 2 * 1024 * 1024;
