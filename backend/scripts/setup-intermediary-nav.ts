/**
 * Paket AH - header menusunu aracı kurulus yapisina cevirir (8 dilde etiket):
 *   Home - About - Health Tourism Services (acilir) - VIP Accommodation & Transfer - Contact
 *
 * "Health Tourism Services" (/specialties) ALT OGE TASIMAZ: header aktif bolumleri (alt bolumler dahil) ve "All services"
 * baglantisini kendisi doldurur (FE1) - menu verisi bolum ekleyip cikardikca bayatlamaz.
 * "Health Guides" (/blog) header'dan CIKAR; footer'da KALIR (footer'a dokunulmaz; /blog footer'da yoksa yalniz uyari verilir).
 * Header CTA (SiteSettings.headerCtaLabel/headerCtaHref): "Appointment" -> /request (8 dil ceviri); "Request a consultation"
 * dugmesi frontend sozlugundendir (FE1).
 *
 * Menu YAPISI: `NavigationItem` (kok `parentId = null`, kardes-kapsamli `order`; derinlik 2). Etiket cevirisi:
 * `translations = { "<dil>": { "label": "..." } }`; kanonik `label` = EN. Href dil oneksiz saklanir.
 *
 * Guvenlik:
 *  - Varsayilan KURU CALISTIRMA (hicbir sey yazilmaz, yedek de alinmaz).
 *  - Yazmak icin: --confirm=setup-intermediary-nav --operator=<ad>
 *  - Idempotent: mevcut header menusu hedefle birebir aynıysa degisiklik yapilmaz.
 *  - Yazmadan once header menusu + header CTA alanlarinin TAM JSON yedegi alinir (varsayilan storage/backups/intermediary-nav-<tarih>.json).
 *  - Geri yukleme: --restore=<yedek.json> --confirm=setup-intermediary-nav --operator=<ad>
 *    (UYARI: header menusunu yedekteki hale TAM DEGISTIRIR; yedekten sonra panelden yapilan menu degisiklikleri kaybolur.)
 *  - Audit kaydi, menu degisikligiyle AYNI transaction'da yazilir. Kuru calismada silinecek her mevcut oge "SILINECEK" diye listelenir.
 *  - NODE_ENV=production iken yazma/geri yukleme ek --i-know-this-is-prod bayragi ister; her calismada hedef DB (host:port/db, parolasiz) yazdirilir.
 *  - Islem audit log'a yazilir. Onbellek kendiliginden yenilenmez (navigation etiketi); site birkac dk icinde yansir.
 *
 * Calistirma (backend/ dizininden; DATABASE_URL'i ACIKCA export edin):
 *   npx tsx scripts/setup-intermediary-nav.ts
 *   npx tsx scripts/setup-intermediary-nav.ts --confirm=setup-intermediary-nav --operator=ridvan
 *   npx tsx scripts/setup-intermediary-nav.ts --restore=storage/backups/intermediary-nav-<tarih>.json --confirm=setup-intermediary-nav --operator=ridvan
 *   (istege bagli: --backup-dir=<yol>)
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";
import { assertProdWriteAllowed, printTargetDb } from "./_script-guard";

const prisma = new PrismaClient();

const CONFIRM_TOKEN = "setup-intermediary-nav";
const LANGS = ["en", "de", "ar", "ru", "fr", "es", "ro", "sr-latn"] as const;
type Lang = (typeof LANGS)[number];
type Labels = Record<Lang, string>;

const LABELS = {
  home: { en: "Home", de: "Startseite", ar: "الرئيسية", ru: "Главная", fr: "Accueil", es: "Inicio", ro: "Acasă", "sr-latn": "Početna" },
  about: { en: "About", de: "Über uns", ar: "من نحن", ru: "О нас", fr: "À propos", es: "Nosotros", ro: "Despre noi", "sr-latn": "O nama" },
  services: {
    en: "Health Tourism Services",
    de: "Leistungen im Gesundheitstourismus",
    ar: "خدمات السياحة العلاجية",
    ru: "Услуги медицинского туризма",
    fr: "Services de tourisme de santé",
    es: "Servicios de turismo de salud",
    ro: "Servicii de turism medical",
    "sr-latn": "Usluge zdravstvenog turizma",
  },
  vip: {
    en: "VIP Accommodation & Transfer",
    de: "VIP-Unterkunft & Transfer",
    ar: "الإقامة والنقل VIP",
    ru: "VIP-проживание и трансфер",
    fr: "Hébergement et transfert VIP",
    es: "Alojamiento y traslado VIP",
    ro: "Cazare și transfer VIP",
    "sr-latn": "VIP smeštaj i transfer",
  },
  contact: { en: "Contact", de: "Kontakt", ar: "اتصل بنا", ru: "Контакты", fr: "Contact", es: "Contacto", ro: "Contact", "sr-latn": "Kontakt" },
  appointment: { en: "Appointment", de: "Termin", ar: "موعد", ru: "Запись", fr: "Rendez-vous", es: "Cita", ro: "Programare", "sr-latn": "Termin" },
} satisfies Record<string, Labels>;

const CTA_HREF = "/request";

interface DesiredItem {
  key: string;
  label: string;
  href: string;
  parentKey: string | null;
  translations: Record<string, { label: string }>;
}

function tr(labels: Labels): Record<string, { label: string }> {
  return Object.fromEntries(LANGS.map((code) => [code, { label: labels[code] }]));
}

async function buildDesired(): Promise<DesiredItem[]> {
  const items: DesiredItem[] = [
    { key: "home", label: LABELS.home.en, href: "/", parentKey: null, translations: tr(LABELS.home) },
    { key: "about", label: LABELS.about.en, href: "/about", parentKey: null, translations: tr(LABELS.about) },
    { key: "services", label: LABELS.services.en, href: "/specialties", parentKey: null, translations: tr(LABELS.services) },
  ];
  items.push(
    { key: "vip", label: LABELS.vip.en, href: "/vip-accommodation-transfer", parentKey: null, translations: tr(LABELS.vip) },
    { key: "contact", label: LABELS.contact.en, href: "/contact", parentKey: null, translations: tr(LABELS.contact) }
  );
  return items;
}

/** Karsilastirma imzasi: kok sira + alt sira + etiket/href/ceviri. */
function signatureOfDesired(items: DesiredItem[]): string {
  return JSON.stringify(
    items.map((i) => ({ k: i.parentKey ?? "root", l: i.label, h: i.href, t: sortedTranslations(i.translations) }))
  );
}

function sortedTranslations(value: unknown): unknown {
  if (!value || typeof value !== "object") return {};
  // Hedef 8 dil disindaki anahtarlar (ornegin eski `tr`) karsilastirmaya girmez - menu "birebir ayni" sayilir.
  const entries = Object.entries(value as Record<string, { label?: string }>)
    .filter(([code]) => (LANGS as readonly string[]).includes(code))
    .map(([code, v]) => [code, v?.label ?? ""] as const);
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
}

async function currentSignature(): Promise<string> {
  const rows = await prisma.navigationItem.findMany({ orderBy: [{ order: "asc" }, { seq: "asc" }] });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const roots = rows.filter((r) => !r.parentId);
  const ordered: { parent: string; row: (typeof rows)[number] }[] = [];
  for (const root of roots) {
    ordered.push({ parent: "root", row: root });
    for (const child of rows.filter((r) => r.parentId === root.id)) ordered.push({ parent: byId.get(child.parentId!)?.href === "/specialties" ? "services" : "other", row: child });
  }
  return JSON.stringify(ordered.map(({ parent, row }) => ({ k: parent, l: row.label, h: row.href, t: sortedTranslations(row.translations) })));
}

function desiredSignatureNormalized(items: DesiredItem[]): string {
  const roots = items.filter((i) => !i.parentKey);
  const ordered: DesiredItem[] = [];
  for (const root of roots) {
    ordered.push(root);
    for (const child of items.filter((i) => i.parentKey === root.key)) ordered.push(child);
  }
  return signatureOfDesired(ordered);
}

interface Snapshot {
  version: 1;
  createdAt: string;
  navigationItems: Record<string, unknown>[];
  siteSettings: { headerCtaLabel: string | null; headerCtaHref: string | null; translations: unknown } | null;
}

async function readSnapshot(): Promise<Snapshot> {
  const [navigationItems, settings] = await Promise.all([
    prisma.navigationItem.findMany({ orderBy: [{ order: "asc" }, { seq: "asc" }] }),
    prisma.siteSettings.findUnique({ where: { id: "singleton" }, select: { headerCtaLabel: true, headerCtaHref: true, translations: true } }),
  ]);
  return JSON.parse(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), navigationItems, siteSettings: settings })) as Snapshot;
}

function ctaTranslations(existing: unknown): Prisma.InputJsonValue {
  const base = existing && typeof existing === "object" ? ({ ...(existing as Record<string, Record<string, unknown>>) } as Record<string, Record<string, unknown>>) : {};
  for (const code of LANGS) base[code] = { ...(base[code] ?? {}), headerCtaLabel: LABELS.appointment[code] };
  return base as Prisma.InputJsonValue;
}

async function ctaNeedsChange(): Promise<boolean> {
  const row = await prisma.siteSettings.findUnique({ where: { id: "singleton" }, select: { headerCtaLabel: true, headerCtaHref: true, translations: true } });
  if (!row) return true;
  if (row.headerCtaLabel !== LABELS.appointment.en || row.headerCtaHref !== CTA_HREF) return true;
  const t = (row.translations && typeof row.translations === "object" ? row.translations : {}) as Record<string, { headerCtaLabel?: string }>;
  return LANGS.some((code) => t[code]?.headerCtaLabel !== LABELS.appointment[code]);
}

async function applyDesired(items: DesiredItem[], audit: { operator: string; backup: string }, parts: { nav: boolean; cta: boolean }): Promise<number> {
  const translationsOf = (i: DesiredItem) => i.translations as unknown as Prisma.InputJsonValue;
  return prisma.$transaction(async (tx) => {
    // Menu hedefle ayniysa YAZILMAZ (kimlikler korunur); yalniz CTA farkliysa yalniz CTA guncellenir.
    const deleted = parts.nav ? (await tx.navigationItem.deleteMany({})).count : 0;
    const ids = new Map<string, string>();
    let rootOrder = 0;
    for (const item of parts.nav ? items.filter((i) => !i.parentKey) : []) {
      const created = await tx.navigationItem.create({ data: { label: item.label, href: item.href, order: rootOrder++, parentId: null, translations: translationsOf(item) } });
      ids.set(item.key, created.id);
    }
    const childOrder = new Map<string, number>();
    for (const item of parts.nav ? items.filter((i) => i.parentKey) : []) {
      const order = childOrder.get(item.parentKey!) ?? 0;
      childOrder.set(item.parentKey!, order + 1);
      await tx.navigationItem.create({ data: { label: item.label, href: item.href, order, parentId: ids.get(item.parentKey!)!, translations: translationsOf(item) } });
    }
    const existing = await tx.siteSettings.findUnique({ where: { id: "singleton" }, select: { translations: true } });
    if (existing && parts.cta) {
      await tx.siteSettings.update({
        where: { id: "singleton" },
        data: { headerCtaLabel: LABELS.appointment.en, headerCtaHref: CTA_HREF, translations: ctaTranslations(existing.translations) },
      });
    }
    await tx.auditLog.create({
      data: {
        actorEmail: `script:${audit.operator}`,
        action: "navigation.setup_intermediary_nav",
        targetType: "Navigation",
        metadata: { script: "setup-intermediary-nav", written: parts.nav ? items.length : 0, deleted, cta: Boolean(existing) && parts.cta, backup: audit.backup },
      },
    });
    return deleted;
  });
}

async function restoreSnapshot(file: string, operator: string) {
  const snap = JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot;
  if (snap.version !== 1 || !Array.isArray(snap.navigationItems)) throw new Error("Geçersiz yedek dosyası biçimi.");
  const pick = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, row[k]]));
  await prisma.$transaction(async (tx) => {
    await tx.navigationItem.deleteMany({});
    const itemData = (row: Record<string, unknown>) =>
      ({ ...pick(row, ["id", "order", "label", "href", "parentId"]), translations: row.translations ?? {}, createdAt: new Date(String(row.createdAt)) }) as Prisma.NavigationItemUncheckedCreateInput;
    for (const row of snap.navigationItems.filter((r) => r.parentId == null)) await tx.navigationItem.create({ data: itemData(row) });
    for (const row of snap.navigationItems.filter((r) => r.parentId != null)) await tx.navigationItem.create({ data: itemData(row) });
    if (snap.siteSettings) {
      await tx.siteSettings.updateMany({
        where: { id: "singleton" },
        data: { headerCtaLabel: snap.siteSettings.headerCtaLabel, headerCtaHref: snap.siteSettings.headerCtaHref, translations: (snap.siteSettings.translations ?? {}) as Prisma.InputJsonValue },
      });
    }
    await tx.auditLog.create({
      data: { actorEmail: `script:${operator}`, action: "navigation.restore_intermediary_nav", targetType: "Navigation", metadata: { script: "setup-intermediary-nav", backup: path.basename(file), items: snap.navigationItems.length } },
    });
  });
  console.log(`[fix] header menüsü ve CTA yedekten geri yüklendi (${snap.navigationItems.length} öğe).`);
}

function parseArgs(argv: string[]) {
  const value = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  return { confirm: value("confirm"), operator: value("operator"), restore: value("restore"), backupDir: value("backup-dir") };
}

async function main() {
  const { confirm, operator, restore, backupDir } = parseArgs(process.argv.slice(2));
  const write = confirm === CONFIRM_TOKEN;
  if (confirm !== undefined && !write) throw new Error(`Geçersiz --confirm değeri. Beklenen: --confirm=${CONFIRM_TOKEN}`);
  if (write && !operator?.trim()) throw new Error("--operator=<ad> zorunludur (audit log için).");
  console.log(`[setup-intermediary-nav] mod=${restore ? (write ? "GERİ YÜKLE" : "KURU (restore)") : write ? "YAZ" : "KURU ÇALIŞTIRMA"}`);
  printTargetDb();
  assertProdWriteAllowed(write, process.argv.slice(2));

  if (restore) {
    const file = path.resolve(restore);
    if (!fs.existsSync(file)) throw new Error(`Yedek dosyası bulunamadı: ${file}`);
    if (!write) {
      console.log(`[kuru] ${file} yedeğinden header menüsü ve CTA geri yüklenecekti (hiçbir şey yazılmadı).`);
      return;
    }
    await restoreSnapshot(file, operator!.trim());
    return;
  }

  const desired = await buildDesired();
  const navSame = (await currentSignature()) === desiredSignatureNormalized(desired);
  const ctaChange = await ctaNeedsChange();
  const settingsRow = await prisma.siteSettings.findUnique({ where: { id: "singleton" }, select: { id: true } });
  const current = await prisma.navigationItem.findMany({ orderBy: [{ order: "asc" }, { seq: "asc" }], select: { label: true, href: true, parentId: true } });

  console.log(`[mevcut] header: ${current.filter((c) => !c.parentId).map((c) => `${c.label} (${c.href})`).join(" | ") || "(boş)"}`);
  if (!navSame) for (const c of current) console.log(`[SİLİNECEK] ${c.parentId ? "alt öğe" : "kök öğe"}: ${c.label} (${c.href})`);
  const roots = desired.filter((d) => !d.parentKey);
  console.log(`[plan] header kökleri: ${roots.map((r) => `${r.label} (${r.href})`).join(" | ")}`);
  console.log(`[plan] header CTA: "${LABELS.appointment.en}" -> ${CTA_HREF} ${settingsRow ? "" : "(site ayarı satırı yok: CTA atlanır)"}`);
  console.log(`[plan] etiket dilleri: ${LANGS.join(", ")}`);
  const footerBlog = await prisma.footerLink.count({ where: { href: "/blog" } });
  if (footerBlog === 0) console.log('[uyarı] footer\'da href="/blog" bağlantısı yok — "Health Guides" header\'dan çıkınca hiçbir yerde kalmaz. add-blog-nav-item.ts ile footer\'a ekleyin ya da panelden elle ekleyin.');

  if (navSame && (!ctaChange || !settingsRow)) {
    console.log("[bilgi] Yapılacak değişiklik yok (idempotent).");
    return;
  }
  if (!write) {
    console.log("[kuru] hiçbir şey yazılmadı.");
    return;
  }

  const dir = path.resolve(backupDir ?? "storage/backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `intermediary-nav-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(await readSnapshot(), null, 2), "utf8");
  console.log(`[yedek] ${file}`);

  const deleted = await applyDesired(desired, { operator: operator!.trim(), backup: path.basename(file) }, { nav: !navSame, cta: ctaChange && Boolean(settingsRow) });
  console.log(`[fix] header menüsü yazıldı (${desired.length} öğe yazıldı, ${deleted} eski öğe SİLİNDİ), CTA ${settingsRow ? "güncellendi" : "atlandı"}.`);
  console.log(`[geri al] npx tsx scripts/setup-intermediary-nav.ts --restore=${file} --confirm=${CONFIRM_TOKEN} --operator=<ad>`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
