import path from "node:path";
import fs from "node:fs";
import { Prisma, type PrismaClient } from "@prisma/client";
import { UPLOAD_DIR } from "../../plugins/uploads";
import { processSiteImage, type ImagePurpose, type MediaVariant } from "../image-pipeline";
import { extensionForMimeType, filenameForMimeType } from "../mime-detect";

/**
 * Paket AE-ek — mevcut site fotoğraflarını (JPEG/PNG/WebP) WebP'ye çevirir. Varsayılan KURU çalışma; gerçek çalışma
 * `--confirm=convert-media --operator=<ad>` ister, `--restore=<runId>` geri alır.
 *
 * Güvenli tasarım:
 * - Ana sürüm `<uuid>.webp`; uyumluluk kopyası ESKİ dosyanın kendi yolunda ve biçiminde yazılır (`<uuid>.jpg`/`.png`).
 *   Böylece güncellenmemiş bir referans (ör. dış bağlantı, Open Graph, favicon) bozulmaz; yalnızca boyut kazancı kaçar.
 * - Eski dosya önce yedek klasörüne TAŞINIR, her öğeden sonra bildirim (manifest) dosyası yazılır; `--restore` hepsini
 *   geri koyar (dosyalar + Media satırı + metin referansları).
 * - Metin referansları yalnızca aşağıdaki SABİT (tablo, kolon) listesinde güncellenir (dinamik SQL adı yok). Open Graph
 *   ve favicon kolonları bilerek güncellenmez (WebP her yerde görünmüyor; eski yol uyumluluk kopyasıdır).
 * - Yalnızca yerel depolama (STORAGE_DRIVER=local). Hasta belgeleri (özel klasör) bu işlemin kapsamında değildir.
 */
export const CONFIRM_TOKEN = "convert-media";

export interface RefTarget {
  table: string;
  column: string;
  isJson: boolean;
}

export const REF_TARGETS: RefTarget[] = [
  { table: "pages", column: "blocks", isJson: true },
  { table: "pages", column: "translations", isJson: true },
  { table: "blog_posts", column: "contentHtml", isJson: false },
  { table: "blog_posts", column: "coverImageUrl", isJson: false },
  { table: "blog_posts", column: "translations", isJson: true },
  { table: "products", column: "descriptionHtml", isJson: false },
  { table: "products", column: "translations", isJson: true },
  { table: "portfolio_items", column: "contentHtml", isJson: false },
  { table: "portfolio_items", column: "translations", isJson: true },
  { table: "doctor_profiles", column: "bio", isJson: false },
  { table: "doctor_profiles", column: "aboutHtml", isJson: false },
  { table: "doctor_profiles", column: "translations", isJson: true },
  { table: "slides", column: "layers", isJson: true },
  { table: "site_settings", column: "logoUrl", isJson: false },
  { table: "users", column: "avatarUrl", isJson: false },
  { table: "email_templates", column: "bodyHtml", isJson: false },
  { table: "email_templates", column: "blocks", isJson: true },
];

/** Bilerek güncellenmeyen kolonlar (eski yol uyumluluk kopyası olarak çalışmaya devam eder). */
export const KEEP_COMPAT_COLUMNS = new Set(["ogImageUrl", "faviconUrl", "appleTouchIconUrl"]);
/** Tarama dışı tablolar: medya kaydının kendisi, denetim izi (tarihsel kayıt) ve migration tablosu. */
const SCAN_EXCLUDED_TABLES = new Set(["media", "audit_logs", "_prisma_migrations", "media_transcode_jobs"]);

const UUID_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|webp)$/i;
const CONVERTIBLE = ["image/jpeg", "image/png", "image/webp"];

export interface ManifestItem {
  mediaId: string;
  old: { path: string; url: string; mimeType: string; sizeBytes: number; width: number | null; height: number | null; filename: string };
  new: { path: string; url: string; mimeType: string; sizeBytes: number; width: number; height: number; filename: string; variants: MediaVariant[] };
  /** Bu çalışmanın YENİ oluşturduğu dosyalar (geri almada silinir; eski yol hariç). */
  createdPaths: string[];
  backupFile: string;
  replacements: { table: string; column: string; rows: number }[];
}

export interface Manifest {
  runId: string;
  operator: string;
  startedAt: string;
  finishedAt: string | null;
  restoredAt: string | null;
  items: ManifestItem[];
}

export interface ConvertSummary {
  mode: "dry-run" | "apply";
  runId: string | null;
  candidates: number;
  converted: number;
  skipped: { mediaId: string; reason: string }[];
  bytesBefore: number;
  bytesAfter: number;
  referenceUpdates: { table: string; column: string; rows: number }[];
  /** Listede olmayan ama `/uploads/` içeren kolonlar (bilgi; güncellenmez). */
  unlistedColumnsWithUploads: { table: string; column: string; rows: number }[];
  backupDir: string | null;
}

interface Options {
  apply: boolean;
  operator?: string;
  backupRoot: string;
  limit?: number;
  uploadDir?: string;
  log?: (line: string) => void;
}

function writeManifest(dir: string, manifest: Manifest) {
  const file = path.join(dir, "manifest.json");
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(manifest, null, 1));
  fs.renameSync(`${file}.tmp`, file);
}

async function replaceRefs(prisma: PrismaClient, from: string, to: string): Promise<{ table: string; column: string; rows: number }[]> {
  const out: { table: string; column: string; rows: number }[] = [];
  if (from === to) return out;
  for (const t of REF_TARGETS) {
    const textExpr = t.isJson ? `"${t.column}"::text` : `"${t.column}"`;
    const setExpr = t.isJson ? `replace("${t.column}"::text, $1, $2)::jsonb` : `replace("${t.column}", $1, $2)`;
    const rows = await prisma.$executeRawUnsafe(`UPDATE "${t.table}" SET "${t.column}" = ${setExpr} WHERE strpos(${textExpr}, $1) > 0`, from, to);
    if (rows > 0) out.push({ table: t.table, column: t.column, rows });
  }
  return out;
}

async function countRefs(prisma: PrismaClient, needle: string): Promise<{ table: string; column: string; rows: number }[]> {
  const out: { table: string; column: string; rows: number }[] = [];
  for (const t of REF_TARGETS) {
    const textExpr = t.isJson ? `"${t.column}"::text` : `"${t.column}"`;
    const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${t.table}" WHERE strpos(${textExpr}, $1) > 0`, needle);
    const rows = Number(r[0]?.n ?? 0);
    if (rows > 0) out.push({ table: t.table, column: t.column, rows });
  }
  return out;
}

/** Bilgi amaçlı: şemadaki metin/JSON kolonlarından `/uploads/` içerip listede OLMAYANLAR. */
async function scanUnlistedColumns(prisma: PrismaClient): Promise<{ table: string; column: string; rows: number }[]> {
  const cols = await prisma.$queryRawUnsafe<{ table_name: string; column_name: string; data_type: string }[]>(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
     WHERE table_schema = current_schema() AND data_type IN ('text', 'character varying', 'jsonb', 'json')`
  );
  const listed = new Set(REF_TARGETS.map((t) => `${t.table}.${t.column}`));
  const out: { table: string; column: string; rows: number }[] = [];
  for (const c of cols) {
    if (SCAN_EXCLUDED_TABLES.has(c.table_name) || listed.has(`${c.table_name}.${c.column_name}`) || KEEP_COMPAT_COLUMNS.has(c.column_name)) continue;
    // Adlar information_schema'dan gelir (kullanıcı girdisi değil); yine de çift tırnak kaçışı yapılır.
    const tbl = c.table_name.replace(/"/g, '""');
    const col = c.column_name.replace(/"/g, '""');
    const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${tbl}" WHERE strpos("${col}"::text, '/uploads/') > 0`);
    const rows = Number(r[0]?.n ?? 0);
    if (rows > 0) out.push({ table: c.table_name, column: c.column_name, rows });
  }
  return out;
}

function mergeCounts(target: { table: string; column: string; rows: number }[], add: { table: string; column: string; rows: number }[]) {
  for (const a of add) {
    const hit = target.find((t) => t.table === a.table && t.column === a.column);
    if (hit) hit.rows += a.rows;
    else target.push({ ...a });
  }
}

export async function convertExistingMedia(prisma: PrismaClient, opts: Options): Promise<ConvertSummary> {
  const uploadDir = opts.uploadDir ?? UPLOAD_DIR;
  const log = opts.log ?? (() => undefined);
  if (opts.apply && !opts.operator?.trim()) throw new Error("--operator=<ad> zorunlu (gerçek çalışma kim tarafından yapıldı?).");

  const settings = await prisma.siteSettings.findFirst({ select: { logoUrl: true, faviconUrl: true, appleTouchIconUrl: true } });
  const iconUrls = new Set([settings?.faviconUrl, settings?.appleTouchIconUrl].filter((u): u is string => !!u).map((u) => u.replace(/^https?:\/\/[^/]+/, "")));
  const logoUrl = settings?.logoUrl?.replace(/^https?:\/\/[^/]+/, "") ?? null;

  const rows = await prisma.media.findMany({
    where: { mimeType: { in: CONVERTIBLE }, variants: { equals: Prisma.DbNull }, path: { not: "" } },
    orderBy: { seq: "asc" },
    ...(opts.limit ? { take: opts.limit } : {}),
  });

  const runId = opts.apply ? new Date().toISOString().replace(/[:.]/g, "-") : null;
  const backupDir = runId ? path.join(opts.backupRoot, runId) : null;
  const manifest: Manifest | null = runId ? { runId, operator: opts.operator!.trim(), startedAt: new Date().toISOString(), finishedAt: null, restoredAt: null, items: [] } : null;
  if (backupDir && manifest) {
    fs.mkdirSync(backupDir, { recursive: true });
    writeManifest(backupDir, manifest);
  }

  const summary: ConvertSummary = {
    mode: opts.apply ? "apply" : "dry-run",
    runId,
    candidates: rows.length,
    converted: 0,
    skipped: [],
    bytesBefore: 0,
    bytesAfter: 0,
    referenceUpdates: [],
    unlistedColumnsWithUploads: [],
    backupDir,
  };

  for (const m of rows) {
    const name = path.basename(m.path);
    const match = UUID_FILE.exec(name);
    if (!match || name !== m.path) {
      summary.skipped.push({ mediaId: m.id, reason: "beklenmeyen dosya adı/yolu" });
      continue;
    }
    if (iconUrls.has(m.url)) {
      summary.skipped.push({ mediaId: m.id, reason: "favicon/apple-touch-icon olarak kullanılıyor (PNG kalmalı)" });
      continue;
    }
    const full = path.join(uploadDir, name);
    if (!fs.existsSync(full)) {
      summary.skipped.push({ mediaId: m.id, reason: "dosya diskte yok" });
      continue;
    }
    const base = match[1]!.toLowerCase();
    const oldExt = `.${match[2]!.toLowerCase()}`;
    const purpose: ImagePurpose = logoUrl && logoUrl === m.url ? "logo" : "default";
    let processed;
    try {
      processed = await processSiteImage(fs.readFileSync(full), { purpose });
    } catch (err) {
      summary.skipped.push({ mediaId: m.id, reason: `işlenemedi: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }

    // Uyumluluk kopyaları: JPEG her zaman; PNG saydam/logo ise. Eski dosya PNG ise eski yolda PNG kopya da yazılır.
    const compat = [...processed.compat];
    if (oldExt === ".png" && !compat.some((c) => c.mimeType === "image/png")) {
      const sharp = (await import("sharp")).default;
      const jpeg = compat.find((c) => c.mimeType === "image/jpeg")!;
      const png = await sharp(fs.readFileSync(full), { limitInputPixels: 50_000_000 }).rotate().resize({ width: jpeg.width, height: jpeg.height, fit: "inside" }).keepIccProfile().png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
      compat.push({ buffer: png.data, mimeType: "image/png", width: png.info.width, height: png.info.height });
    }
    const newPath = `${base}.webp`;
    const newUrl = `/uploads/${newPath}`;
    const variants: MediaVariant[] = compat.map((c) => {
      const p = `${base}${extensionForMimeType(c.mimeType)}`;
      return { format: c.mimeType === "image/png" ? "png" : "jpeg", path: p, url: `/uploads/${p}`, sizeBytes: c.buffer.byteLength, width: c.width, height: c.height };
    });
    const sizeAfter = processed.main.buffer.byteLength + compat.reduce((n, c) => n + c.buffer.byteLength, 0);
    summary.bytesBefore += m.sizeBytes;
    summary.bytesAfter += sizeAfter;

    if (!opts.apply || !backupDir || !manifest) {
      if (m.url !== newUrl) mergeCounts(summary.referenceUpdates, await countRefs(prisma, m.url));
      summary.converted++;
      log(`[kuru] ${m.id} ${name} ${m.sizeBytes} B → webp ${processed.main.buffer.byteLength} B (+${compat.length} kopya)`);
      continue;
    }

    // 1) Eski dosya yedeğe KOPYALANIR ve bildirim dosyası yazılır; ancak SONRA yeni sürümler yazılır (eski yol
    //    uyumluluk kopyasıyla üzerine yazılır). Yarıda kalan bir çalışma `--restore` ile geri alınabilir.
    fs.copyFileSync(full, path.join(backupDir, name));
    const files: { p: string; buf: Buffer }[] = [{ p: newPath, buf: processed.main.buffer }, ...compat.map((c, i) => ({ p: variants[i]!.path, buf: c.buffer }))];
    const createdPaths = files.map((f) => f.p).filter((p) => p !== name);
    const item: ManifestItem = {
      mediaId: m.id,
      old: { path: m.path, url: m.url, mimeType: m.mimeType, sizeBytes: m.sizeBytes, width: m.width, height: m.height, filename: m.filename },
      new: { path: newPath, url: newUrl, mimeType: "image/webp", sizeBytes: processed.main.buffer.byteLength, width: processed.main.width, height: processed.main.height, filename: filenameForMimeType(m.filename, "image/webp"), variants },
      createdPaths,
      backupFile: name,
      replacements: [],
    };
    manifest.items.push(item);
    writeManifest(backupDir, manifest);
    // 2) Yeni dosyalar (yalnızca daha önce var olmayanlar geri almada silinir).
    for (const f of files) fs.writeFileSync(path.join(uploadDir, f.p), f.buf);
    // 3) Media satırı (FK referansları — avatarMediaId, coverMediaId, slider vb. — aynı satırı gösterdiği için kendiliğinden güncellenir).
    await prisma.media.update({
      where: { id: m.id },
      data: { path: newPath, url: newUrl, mimeType: "image/webp", sizeBytes: item.new.sizeBytes, width: item.new.width, height: item.new.height, filename: item.new.filename, variants: variants as unknown as Prisma.InputJsonValue },
    });
    // 4) Metin referansları (yalnızca sabit liste).
    item.replacements = await replaceRefs(prisma, m.url, newUrl);
    writeManifest(backupDir, manifest);
    mergeCounts(summary.referenceUpdates, item.replacements);
    summary.converted++;
    log(`[dönüştürüldü] ${m.id} ${name} → ${newPath}`);
  }

  summary.unlistedColumnsWithUploads = await scanUnlistedColumns(prisma);
  if (backupDir && manifest) {
    manifest.finishedAt = new Date().toISOString();
    writeManifest(backupDir, manifest);
  }
  return summary;
}

/** `--restore=<runId>`: dosyaları, Media satırlarını ve metin referanslarını çalıştırma öncesine döndürür. */
export async function restoreConvertedMedia(prisma: PrismaClient, opts: { runId: string; backupRoot: string; uploadDir?: string; log?: (line: string) => void }): Promise<{ restored: number; missingBackups: string[] }> {
  if (!/^[0-9TZ-]+$/.test(opts.runId)) throw new Error("Geçersiz runId.");
  const uploadDir = opts.uploadDir ?? UPLOAD_DIR;
  const dir = path.join(opts.backupRoot, opts.runId);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
  if (manifest.restoredAt) throw new Error(`Bu çalışma zaten geri alınmış (${manifest.restoredAt}).`);
  const missingBackups: string[] = [];
  let restored = 0;
  for (const item of [...manifest.items].reverse()) {
    const backup = path.join(dir, path.basename(item.backupFile));
    if (!fs.existsSync(backup)) {
      missingBackups.push(item.backupFile);
      continue;
    }
    await replaceRefs(prisma, item.new.url, item.old.url);
    await prisma.media.update({
      where: { id: item.mediaId },
      data: { path: item.old.path, url: item.old.url, mimeType: item.old.mimeType, sizeBytes: item.old.sizeBytes, width: item.old.width, height: item.old.height, filename: item.old.filename, variants: Prisma.DbNull },
    });
    for (const p of item.createdPaths) fs.rmSync(path.join(uploadDir, path.basename(p)), { force: true });
    fs.copyFileSync(backup, path.join(uploadDir, path.basename(item.old.path)));
    restored++;
    opts.log?.(`[geri alındı] ${item.mediaId} → ${item.old.path}`);
  }
  manifest.restoredAt = new Date().toISOString();
  writeManifest(dir, manifest);
  return { restored, missingBackups };
}

