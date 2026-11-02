/**
 * Paket AJ-9 - ziyaretci sitesinin marka renklerini uygular: birincil #2951a0 (koyu mavi), vurgu #4ab9e1.
 *
 * RENKLERIN KAYNAGI: `SiteAppearance` (tek satir, id="singleton"; panelde Gorunum > Renkler). Ziyaretci sitesi tum tema
 * token'larini (--site-primary, --site-accent, dugme/baglanti rengi) buradan okur; satir yoksa DEFAULTS (indigo #4f46e5 =
 * "mor" kalinti) gecerlidir.
 *
 * NE YAPAR: primaryColor, buttonColor, linkColor, headerLinkActiveColor = #2951a0; accentColor = #4ab9e1; buttonTextColor =
 * #ffffff. secondaryColor/arka plan/yuzey/metin/soluk metin rengi DEGISTIRILMEZ. Yazmadan once WCAG AA (>= 4.5:1) kontrol
 * edilir: dugme metni/dugme, baglanti/arka plan, baglanti/yuzey, birincil/arka plan, metin/vurgu. Biri kalirsa HICBIR sey
 * yazilmaz. Mevcut tema renklerinden mor/indigo tonlu olanlar (ornegin header/sayfa basligi) bilgi olarak listelenir.
 * `presetKey` null yapilir (ozel tema). Satir yoksa olusturulur (kalan alanlar sema varsayilanlari).
 *
 * Guvenlik: varsayilan KURU; yazmak icin --confirm=apply-brand-theme --operator=<ad>; idempotent; yazmadan once etkilenen
 * alanlarin yedegi (storage/backups/brand-theme-<tarih>.json); --restore=<yedek.json> ile geri yukleme; audit log degisiklikle
 * AYNI transaction'da. NODE_ENV=production iken yazma/geri yukleme ek --i-know-this-is-prod ister; hedef DB her calismada
 * (parolasiz) yazdirilir. Yazdiktan sonra `appearance` onbellegi yenilenir (REVALIDATE_SECRET varsa; --no-revalidate ile atlanir).
 *
 * Calistirma (backend/ dizininden; DATABASE_URL'i ACIKCA export edin):
 *   npx tsx scripts/apply-brand-theme.ts
 *   npx tsx scripts/apply-brand-theme.ts --confirm=apply-brand-theme --operator=ridvan
 *   npx tsx scripts/apply-brand-theme.ts --restore=storage/backups/brand-theme-<tarih>.json --confirm=apply-brand-theme --operator=ridvan
 *   (istege bagli: --backup-dir=<yol>, --no-revalidate)
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";
import { assertProdWriteAllowed, printTargetDb } from "./_script-guard";

const prisma = new PrismaClient();

const CONFIRM_TOKEN = "apply-brand-theme";
const PRIMARY = "#2951a0";
const ACCENT = "#4ab9e1";
const WHITE = "#ffffff";
const DEFAULT_TEXT = "#111827";
const DEFAULT_BG = "#ffffff";
const DEFAULT_SURFACE = "#f9fafb";

const TARGET = {
  primaryColor: PRIMARY,
  buttonColor: PRIMARY,
  buttonTextColor: WHITE,
  linkColor: PRIMARY,
  headerLinkActiveColor: PRIMARY,
  accentColor: ACCENT,
} as const;
type TargetKey = keyof typeof TARGET;
const TARGET_KEYS = Object.keys(TARGET) as TargetKey[];

/** Bilgi amacli taranan renk alanlari (degistirilmez). */
const SCAN_KEYS = ["secondaryColor", "backgroundColor", "surfaceColor", "textColor", "mutedTextColor", "headerBgColor", "headerStickyBgColor", "headerLinkColor", "headerLinkHoverColor", "pageHeaderBackgroundColor"] as const;

function parseHex(value: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(value.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Mor/indigo/menekse tonu (hue 235-310, doygunluk >= %25) mu? */
function isPurpleish(hex: string): boolean {
  const rgb = parseHex(hex);
  if (!rgb) return false;
  const [r, g, b] = rgb.map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return false;
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return h >= 235 && h <= 310 && s >= 0.25;
}

interface Check {
  label: string;
  ratio: number;
  min: number;
}

function buildChecks(current: Record<string, string | null | undefined>): Check[] {
  const bg = current.backgroundColor ?? DEFAULT_BG;
  const surface = current.surfaceColor ?? DEFAULT_SURFACE;
  const text = current.textColor ?? DEFAULT_TEXT;
  return [
    { label: `düğme metni ${TARGET.buttonTextColor} / düğme ${TARGET.buttonColor}`, ratio: contrastRatio(TARGET.buttonTextColor, TARGET.buttonColor), min: 4.5 },
    { label: `bağlantı ${TARGET.linkColor} / arka plan ${bg}`, ratio: contrastRatio(TARGET.linkColor, bg), min: 4.5 },
    { label: `bağlantı ${TARGET.linkColor} / yüzey ${surface}`, ratio: contrastRatio(TARGET.linkColor, surface), min: 4.5 },
    { label: `birincil ${TARGET.primaryColor} / arka plan ${bg}`, ratio: contrastRatio(TARGET.primaryColor, bg), min: 4.5 },
    { label: `menü etkin bağlantı ${TARGET.headerLinkActiveColor} / arka plan ${bg}`, ratio: contrastRatio(TARGET.headerLinkActiveColor, bg), min: 4.5 },
    { label: `metin ${text} / vurgu ${TARGET.accentColor} (vurgu üstünde koyu metin)`, ratio: contrastRatio(text, TARGET.accentColor), min: 4.5 },
  ];
}

interface Snapshot {
  version: 1;
  createdAt: string;
  rowExisted: boolean;
  presetKey: string | null;
  values: Partial<Record<TargetKey, string>>;
}

function parseArgs(argv: string[]) {
  const value = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  return { confirm: value("confirm"), operator: value("operator"), restore: value("restore"), backupDir: value("backup-dir"), noRevalidate: argv.includes("--no-revalidate") };
}

async function revalidate() {
  const [{ triggerTagRevalidation, CACHE_TAGS }] = await Promise.all([import("../src/lib/revalidate")]);
  const log = { warn: (...a: unknown[]) => console.warn(...a), info: () => undefined, error: (...a: unknown[]) => console.error(...a) };
  await triggerTagRevalidation({ log } as never, [CACHE_TAGS.appearance]);
}

async function main() {
  const { confirm, operator, restore, backupDir, noRevalidate } = parseArgs(process.argv.slice(2));
  const write = confirm === CONFIRM_TOKEN;
  if (confirm !== undefined && !write) throw new Error(`Geçersiz --confirm değeri. Beklenen: --confirm=${CONFIRM_TOKEN}`);
  if (write && !operator?.trim()) throw new Error("--operator=<ad> zorunludur (audit log için).");
  console.log(`[apply-brand-theme] mod=${restore ? (write ? "GERİ YÜKLE" : "KURU (restore)") : write ? "YAZ" : "KURU ÇALIŞTIRMA"}`);
  printTargetDb();
  assertProdWriteAllowed(write, process.argv.slice(2));

  if (restore) {
    const file = path.resolve(restore);
    if (!fs.existsSync(file)) throw new Error(`Yedek dosyası bulunamadı: ${file}`);
    const snap = JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot;
    if (snap.version !== 1 || typeof snap.values !== "object") throw new Error("Geçersiz yedek dosyası biçimi.");
    if (!write) {
      console.log(`[kuru] ${file} yedeğinden ${Object.keys(snap.values).length} renk alanı geri yüklenecekti (hiçbir şey yazılmadı).`);
      return;
    }
    await prisma.$transaction(async (tx) => {
      if (snap.rowExisted) await tx.siteAppearance.update({ where: { id: "singleton" }, data: { ...snap.values, presetKey: snap.presetKey } });
      else await tx.siteAppearance.deleteMany({ where: { id: "singleton" } });
      await tx.auditLog.create({ data: { actorEmail: `script:${operator!.trim()}`, action: "appearance.restore_brand_theme", targetType: "SiteAppearance", targetId: "singleton", metadata: { script: "apply-brand-theme", backup: path.basename(file), fields: Object.keys(snap.values) } } });
    });
    console.log("[fix] marka renkleri yedekten geri yüklendi.");
    if (!noRevalidate) await revalidate();
    return;
  }

  const row = await prisma.siteAppearance.findUnique({ where: { id: "singleton" } });
  const current = (row ?? {}) as Record<string, string | null | undefined>;
  const defaultsNote = row ? "" : " (satır yok: site şema varsayılanlarını kullanıyor; satır OLUŞTURULACAK)";
  console.log(`[mevcut]${defaultsNote} ${TARGET_KEYS.map((k) => `${k}=${row ? current[k] : "(varsayılan)"}`).join(" ")}`);
  const checks = buildChecks(current);
  let failed = false;
  for (const c of checks) {
    const ok = c.ratio >= c.min;
    if (!ok) failed = true;
    console.log(`[kontrast] ${ok ? "GEÇTİ" : "KALDI "} ${c.ratio.toFixed(2)}:1 (en az ${c.min}) — ${c.label}`);
  }
  const accentOnWhite = contrastRatio(ACCENT, current.backgroundColor ?? DEFAULT_BG);
  console.log(`[bilgi] vurgu ${ACCENT} beyaz zemin üzerinde ${accentOnWhite.toFixed(2)}:1 — yalnızca dekoratif/zemin olarak kullanılmalı, metin rengi olarak DEĞİL.`);
  for (const key of SCAN_KEYS) {
    const v = current[key];
    if (typeof v === "string" && isPurpleish(v)) console.log(`[bilgi] mor/indigo tonlu renk kaldı (DEĞİŞTİRİLMEDİ): ${key}=${v} — panelden Görünüm > Renkler'den düzeltin.`);
  }
  if (failed) throw new Error("WCAG AA kontrastı sağlanmadı; hiçbir şey yazılmadı.");

  const changes = TARGET_KEYS.filter((k) => !row || current[k]?.toLowerCase() !== TARGET[k]);
  for (const k of changes) console.log(`[plan] ${k}: ${row ? current[k] : "(varsayılan)"} -> ${TARGET[k]}`);
  if (row && row.presetKey !== null && changes.length > 0) console.log(`[plan] presetKey: ${row.presetKey} -> null (özel tema)`);
  if (changes.length === 0) {
    console.log("[bilgi] Yapılacak değişiklik yok (idempotent).");
    return;
  }
  if (!write) {
    console.log("[kuru] hiçbir şey yazılmadı.");
    return;
  }

  const snap: Snapshot = {
    version: 1,
    createdAt: new Date().toISOString(),
    rowExisted: Boolean(row),
    presetKey: row?.presetKey ?? null,
    values: Object.fromEntries(changes.filter(() => row).map((k) => [k, current[k] as string])) as Snapshot["values"],
  };
  const dir = path.resolve(backupDir ?? "storage/backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `brand-theme-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(snap, null, 2), "utf8");
  console.log(`[yedek] ${file}`);

  const data = Object.fromEntries(changes.map((k) => [k, TARGET[k]])) as Prisma.SiteAppearanceUncheckedUpdateInput;
  await prisma.$transaction(async (tx) => {
    if (row) await tx.siteAppearance.update({ where: { id: "singleton" }, data: { ...data, presetKey: null } });
    else await tx.siteAppearance.create({ data: { id: "singleton", ...(data as Prisma.SiteAppearanceUncheckedCreateInput), presetKey: null } });
    await tx.auditLog.create({
      data: { actorEmail: `script:${operator!.trim()}`, action: "appearance.apply_brand_theme", targetType: "SiteAppearance", targetId: "singleton", metadata: { script: "apply-brand-theme", changed: changes, backup: path.basename(file) } },
    });
  });
  console.log(`[fix] marka renkleri uygulandı (${changes.join(", ")}).`);
  console.log(`[geri al] npx tsx scripts/apply-brand-theme.ts --restore=${file} --confirm=${CONFIRM_TOKEN} --operator=<ad>`);
  if (!noRevalidate) await revalidate();
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
