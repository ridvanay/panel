/**
 * Paket AJ-6 - footer kolonlarini aracı kurulus yapisina gore doldurur (8 dil etiket):
 *   Platform: Home, About, VIP Accommodation & Transfer, Health Guides, Contact
 *   Services: aktif UST hizmetler (AI gruplu adlariyla: Specialty.name + translations[dil].name) -> /specialties/<slug>
 *   Legal:    yayinda EN yasal sayfalar (Page.isLegalDocument + EN slug); TR slug'li / Turkce basliklilar HARIC
 *
 * Kolonlar baslik/ad ile bulunur (Platform | Services/Branslar | Legal/Yasal); yoksa olusturulur. Bir kolonda ayni adresli
 * (href) baglanti varsa YENIDEN OLUSTURULMAZ - etiketi ve cevirisi guncellenir. Hedefte olmayan mevcut baglantilara DOKUNULMAZ
 * (silinmez), hedef sirasinin SONUNA alinir; YALNIZ ziyaretciye kapali adresler (/physicians, /doctors) ve TR yasal sayfa
 * baglantilari CIKARILIR (localize-footer-english.ts ile ayni kural; yedekten geri gelir).
 *
 * Guvenlik: varsayilan KURU; yazmak icin --confirm=fill-footer-intermediary --operator=<ad>; idempotent (ikinci calisma
 * "yapilacak degisiklik yok"); yazmadan once footer yedegi (storage/backups/footer-fill-<tarih>.json); --restore=<yedek.json>
 * ile geri yukleme; audit log degisiklikle AYNI transaction'da. NODE_ENV=production iken yazma/geri yukleme ek
 * --i-know-this-is-prod bayragi ister; her calismada hedef DB (host:port/db, parolasiz) yazdirilir.
 * Onbellek kendiliginden yenilenmez; site birkac dk icinde yansir.
 *
 * Calistirma (backend/ dizininden; DATABASE_URL'i ACIKCA export edin):
 *   npx tsx scripts/fill-footer-intermediary.ts
 *   npx tsx scripts/fill-footer-intermediary.ts --confirm=fill-footer-intermediary --operator=ridvan
 *   npx tsx scripts/fill-footer-intermediary.ts --restore=storage/backups/footer-fill-<tarih>.json --confirm=fill-footer-intermediary --operator=ridvan
 *   (istege bagli: --backup-dir=<yol>)
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";
import { assertProdWriteAllowed, printTargetDb } from "./_script-guard";

const prisma = new PrismaClient();

const CONFIRM_TOKEN = "fill-footer-intermediary";
const LANGS = ["en", "de", "ar", "ru", "fr", "es", "ro", "sr-latn"] as const;
type Lang = (typeof LANGS)[number];
type Labels = Record<Lang, string>;
type Translations = Record<string, Record<string, string>>;

const COLUMN_TITLES = {
  platform: { en: "Platform", de: "Plattform", ar: "المنصة", ru: "Платформа", fr: "Plateforme", es: "Plataforma", ro: "Platformă", "sr-latn": "Platforma" },
  services: { en: "Services", de: "Leistungen", ar: "الخدمات", ru: "Услуги", fr: "Services", es: "Servicios", ro: "Servicii", "sr-latn": "Usluge" },
  legal: { en: "Legal", de: "Rechtliches", ar: "قانوني", ru: "Правовая информация", fr: "Mentions légales", es: "Legal", ro: "Informații legale", "sr-latn": "Pravne informacije" },
} satisfies Record<string, Labels>;
type ColumnKey = keyof typeof COLUMN_TITLES;
const COLUMN_ORDER: ColumnKey[] = ["platform", "services", "legal"];
/** Kolon bulma: kanonik baslik (kucuk harf, trim) -> anahtar. */
const COLUMN_ALIASES: Record<string, ColumnKey> = { platform: "platform", services: "services", "branşlar": "services", "uzmanlıklar": "services", hizmetler: "services", legal: "legal", yasal: "legal" };

const PLATFORM_LINKS: { href: string; labels: Labels }[] = [
  { href: "/", labels: { en: "Home", de: "Startseite", ar: "الرئيسية", ru: "Главная", fr: "Accueil", es: "Inicio", ro: "Acasă", "sr-latn": "Početna" } },
  { href: "/about", labels: { en: "About", de: "Über uns", ar: "من نحن", ru: "О нас", fr: "À propos", es: "Nosotros", ro: "Despre noi", "sr-latn": "O nama" } },
  {
    href: "/vip-accommodation-transfer",
    labels: { en: "VIP Accommodation & Transfer", de: "VIP-Unterkunft & Transfer", ar: "الإقامة والنقل VIP", ru: "VIP-проживание и трансфер", fr: "Hébergement et transfert VIP", es: "Alojamiento y traslado VIP", ro: "Cazare și transfer VIP", "sr-latn": "VIP smeštaj i transfer" },
  },
  {
    href: "/blog",
    labels: { en: "Health Guides", de: "Gesundheitsratgeber", ar: "أدلة صحية", ru: "Руководства по здоровью", fr: "Guides santé", es: "Guías de salud", ro: "Ghiduri de sănătate", "sr-latn": "Vodiči za zdravlje" },
  },
  { href: "/contact", labels: { en: "Contact", de: "Kontakt", ar: "اتصل بنا", ru: "Контакты", fr: "Contact", es: "Contacto", ro: "Contact", "sr-latn": "Kontakt" } },
];

/** Bilinen yasal belge turleri (slug anahtar kelimesi) -> 8 dil etiket; digerleri sayfa cevirisinden / EN basliktan. */
const LEGAL_KINDS: { match: RegExp; labels: Labels }[] = [
  { match: /privacy-notice|data-protection|aydinlatma/i, labels: { en: "Privacy Notice", de: "Datenschutzhinweise", ar: "إشعار الخصوصية", ru: "Уведомление о конфиденциальности", fr: "Notice d’information", es: "Aviso de privacidad", ro: "Notă de informare", "sr-latn": "Obaveštenje o privatnosti" } },
  { match: /privacy/i, labels: { en: "Privacy Policy", de: "Datenschutzerklärung", ar: "سياسة الخصوصية", ru: "Политика конфиденциальности", fr: "Politique de confidentialité", es: "Política de privacidad", ro: "Politica de confidențialitate", "sr-latn": "Politika privatnosti" } },
  { match: /terms/i, labels: { en: "Terms of Use", de: "Nutzungsbedingungen", ar: "شروط الاستخدام", ru: "Условия использования", fr: "Conditions d’utilisation", es: "Condiciones de uso", ro: "Termeni de utilizare", "sr-latn": "Uslovi korišćenja" } },
  { match: /cookie/i, labels: { en: "Cookie Policy", de: "Cookie-Richtlinie", ar: "سياسة ملفات تعريف الارتباط", ru: "Политика использования файлов cookie", fr: "Politique relative aux cookies", es: "Política de cookies", ro: "Politica privind cookie-urile", "sr-latn": "Politika kolačića" } },
];

const TURKISH_CHARS = /[çğıöşüÇĞİÖŞÜ]/;
const TURKISH_WORDS = /\b(tüm hakları|saklıdır|hakkımızda|gizlilik|aydınlatma|politikası|şartları|kullanım|çerez|yasal|ana sayfa|hizmetler|sağlık|nasıl|kvkk|metni)\b/i;
const looksTurkish = (value: string | null | undefined) => !!value && (TURKISH_CHARS.test(value) || TURKISH_WORDS.test(value.replace(/-/g, " ")));
const norm = (value: string) => value.trim().toLocaleLowerCase("tr");
/** Karsilastirma anahtari: dil oneki, sorgu/capa ve sondaki "/" atilir. */
const hrefKey = (href: string) => {
  const stripped = href.trim().replace(/^https?:\/\/[^/]+/i, "").replace(/^\/(?:[a-z]{2}(?:-[a-z]{4})?)(?=\/|$)/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  return stripped === "" ? "/" : stripped.toLowerCase();
};
const REMOVED_PATHS = /^(?:https?:\/\/[^/]+)?\/(?:[a-z]{2}(?:-[a-z]{4})?\/)?(?:physicians|doctors)(?:[/?#]|$)/i;

interface DesiredLink {
  href: string;
  label: string;
  translations: Translations;
}

function labelTranslations(labels: Labels): Translations {
  return Object.fromEntries(LANGS.map((code) => [code, { label: labels[code] }]));
}

function mergedTranslations(existing: unknown, field: "label" | "title", labels: Labels): Prisma.InputJsonValue {
  const base = existing && typeof existing === "object" ? ({ ...(existing as Record<string, Record<string, unknown>>) } as Record<string, Record<string, unknown>>) : {};
  for (const code of LANGS) base[code] = { ...(base[code] ?? {}), [field]: labels[code] };
  return base as Prisma.InputJsonValue;
}

function pickLang(value: unknown, code: string, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const entry = (value as Record<string, Record<string, unknown>>)[code];
  const v = entry && typeof entry === "object" ? entry[key] : null;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

interface Warning {
  text: string;
}

async function desiredServices(): Promise<DesiredLink[]> {
  const rows = await prisma.specialty.findMany({ where: { isActive: true, parentId: null }, orderBy: [{ order: "asc" }, { name: "asc" }] });
  return rows.map((row) => {
    const labels = Object.fromEntries(LANGS.map((code) => [code, (code === "en" ? row.name : (pickLang(row.translations, code, "name") ?? row.name))])) as Labels;
    // EN etiketi kanonik ad; en cevirisi varsa o (AI gruplu EN adi) onceliklidir.
    labels.en = pickLang(row.translations, "en", "name") ?? row.name;
    return { href: `/specialties/${row.slug}`, label: labels.en, translations: labelTranslations(labels) };
  });
}

async function desiredLegal(warnings: Warning[]): Promise<{ links: DesiredLink[]; trSlugs: Set<string> }> {
  const pages = await prisma.page.findMany({ where: { isLegalDocument: true }, orderBy: { createdAt: "asc" } });
  const slugs = await prisma.contentSlug.findMany({ where: { entityType: "PAGE", entityId: { in: pages.map((p) => p.id) } }, select: { entityId: true, locale: true, slug: true } });
  const links: DesiredLink[] = [];
  const trSlugs = new Set<string>();
  for (const page of pages) {
    const en = slugs.find((s) => s.entityId === page.id && s.locale === "en")?.slug ?? null;
    const trSlug = slugs.find((s) => s.entityId === page.id && s.locale === "tr")?.slug ?? null;
    if (trSlug && trSlug !== en) trSlugs.add(trSlug);
    const canonicalTurkish = looksTurkish(page.title) || looksTurkish(page.slug);
    if (canonicalTurkish && en !== page.slug) trSlugs.add(page.slug);
    const slug = en ?? (canonicalTurkish ? null : page.slug);
    const enTitle = pickLang(page.translations, "en", "title") ?? (looksTurkish(page.title) ? null : page.title);
    if (!slug || !enTitle) {
      warnings.push({ text: `EN yasal sayfa adresi/başlığı yok, footer'a EKLENMEDİ: "${page.title}" (/${page.slug}) — panelden EN slug ve EN başlık girin.` });
      continue;
    }
    if (page.status !== "PUBLISHED") {
      warnings.push({ text: `Yasal sayfa yayında değil, footer'a EKLENMEDİ: "${enTitle}" (/${slug}) — yayınlayınca script'i yeniden çalıştırın.` });
      continue;
    }
    const kind = LEGAL_KINDS.find((k) => k.match.test(slug) || k.match.test(enTitle));
    const labels = (kind?.labels ?? Object.fromEntries(LANGS.map((code) => [code, pickLang(page.translations, code, "title") ?? enTitle]))) as Labels;
    links.push({ href: `/${slug}`, label: labels.en, translations: labelTranslations(labels) });
  }
  return { links, trSlugs };
}

interface ColumnRow {
  id: string;
  order: number;
  title: string;
  translations: unknown;
  links: { id: string; order: number; label: string; href: string; translations: unknown }[];
}

interface FinalItem {
  id: string | null;
  label: string;
  href: string;
  translations: unknown;
  changed: boolean;
}

interface ColumnPlan {
  key: ColumnKey;
  existing: ColumnRow | null;
  titleChanged: boolean;
  items: FinalItem[];
  remove: { id: string; label: string; href: string; reason: string }[];
  orderChanged: boolean;
}

const sameTranslations = (current: unknown, wanted: Translations, field: "label" | "title") =>
  LANGS.every((code) => pickLang(current, code, field) === (wanted[code]?.[field] ?? null));

async function buildPlans(warnings: Warning[]): Promise<ColumnPlan[]> {
  const columns = (await prisma.footerColumn.findMany({ orderBy: { order: "asc" }, include: { links: { orderBy: { order: "asc" } } } })) as ColumnRow[];
  const { links: legal, trSlugs } = await desiredLegal(warnings);
  const desired: Record<ColumnKey, DesiredLink[]> = {
    platform: PLATFORM_LINKS.map((l) => ({ href: l.href, label: l.labels.en, translations: labelTranslations(l.labels) })),
    services: await desiredServices(),
    legal,
  };
  if (desired.services.length === 0) warnings.push({ text: "Aktif üst hizmet bulunamadı; Services sütunu boş kalır." });

  const plans: ColumnPlan[] = [];
  for (const key of COLUMN_ORDER) {
    const existing = columns.find((c) => COLUMN_ALIASES[norm(c.title)] === key) ?? null;
    const titles = COLUMN_TITLES[key];
    const titleTranslations = Object.fromEntries(LANGS.map((code) => [code, { title: titles[code] }])) as Translations;
    const titleChanged = !existing || existing.title !== titles.en || !sameTranslations(existing.translations, titleTranslations, "title");
    const current = existing?.links ?? [];
    const remove: ColumnPlan["remove"] = [];
    const kept = [] as typeof current;
    for (const link of current) {
      if (REMOVED_PATHS.test(link.href)) remove.push({ id: link.id, label: link.label, href: link.href, reason: "hekim adresi (ziyaretçiye kapalı)" });
      else if (key === "legal" && trSlugs.has(hrefKey(link.href).replace(/^\//, ""))) remove.push({ id: link.id, label: link.label, href: link.href, reason: "TR yasal sayfa" });
      else kept.push(link);
    }
    const items: FinalItem[] = [];
    const usedIds = new Set<string>();
    for (const want of desired[key]) {
      const match = kept.find((l) => !usedIds.has(l.id) && hrefKey(l.href) === hrefKey(want.href));
      if (match) {
        usedIds.add(match.id);
        const changed = match.label !== want.label || !sameTranslations(match.translations, want.translations, "label");
        items.push({ id: match.id, label: want.label, href: match.href, translations: want.translations, changed });
      } else {
        items.push({ id: null, label: want.label, href: want.href, translations: want.translations, changed: true });
      }
    }
    for (const link of kept) if (!usedIds.has(link.id)) items.push({ id: link.id, label: link.label, href: link.href, translations: link.translations, changed: false });
    // Sira: mevcut kayitlarin sirasi hedef siraya esit degilse degisiklik.
    const currentOrder = kept.map((l) => l.id);
    const finalIds = items.filter((i) => i.id).map((i) => i.id!);
    const orderChanged = existing !== null && (currentOrder.length !== finalIds.length || currentOrder.some((id, idx) => id !== finalIds[idx]) || kept.some((l, idx) => l.order !== idx));
    plans.push({ key, existing, titleChanged, items, remove, orderChanged });
  }
  return plans;
}

const planIsEmpty = (plans: ColumnPlan[]) =>
  plans.every((p) => !p.titleChanged && p.remove.length === 0 && !p.orderChanged && p.items.every((i) => !i.changed && i.id !== null));

function describe(plans: ColumnPlan[]) {
  for (const p of plans) {
    console.log(`[plan] sütun "${COLUMN_TITLES[p.key].en}" ${p.existing ? `(mevcut: "${p.existing.title}"${p.titleChanged ? ", başlık/çeviri güncellenir" : ""})` : "(YENİ OLUŞTURULUR)"}`);
    for (const item of p.items) console.log(`         ${item.id === null ? "+ EKLENİR " : item.changed ? "~ GÜNCELLENİR" : "= aynı     "} ${item.label} -> ${item.href}`);
    for (const r of p.remove) console.log(`         - ÇIKARILIR "${r.label}" ${r.href} (${r.reason})`);
    if (p.orderChanged) console.log("         ~ bağlantı sırası düzenlenir");
  }
}

interface Snapshot {
  version: 1;
  createdAt: string;
  footerColumns: (Record<string, unknown> & { links: Record<string, unknown>[] })[];
}

async function readSnapshot(): Promise<Snapshot> {
  const footerColumns = await prisma.footerColumn.findMany({ orderBy: { order: "asc" }, include: { links: { orderBy: { order: "asc" } } } });
  return JSON.parse(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), footerColumns })) as Snapshot;
}

async function apply(plans: ColumnPlan[], audit: { operator: string; backup: string }) {
  const stats = { columnsCreated: 0, linksCreated: 0, linksUpdated: 0, linksRemoved: 0 };
  await prisma.$transaction(async (tx) => {
    let nextColumnOrder = ((await tx.footerColumn.aggregate({ _max: { order: true } }))._max.order ?? -1) + 1;
    for (const plan of plans) {
      const titles = COLUMN_TITLES[plan.key];
      let columnId = plan.existing?.id ?? null;
      if (!columnId) {
        const created = await tx.footerColumn.create({ data: { title: titles.en, order: nextColumnOrder++, translations: mergedTranslations({}, "title", titles) } });
        columnId = created.id;
        stats.columnsCreated++;
      } else if (plan.titleChanged) {
        await tx.footerColumn.update({ where: { id: columnId }, data: { title: titles.en, translations: mergedTranslations(plan.existing!.translations, "title", titles) } });
      }
      if (plan.remove.length > 0) {
        await tx.footerLink.deleteMany({ where: { id: { in: plan.remove.map((r) => r.id) } } });
        stats.linksRemoved += plan.remove.length;
      }
      let order = 0;
      for (const item of plan.items) {
        const translations = (item.changed && item.id
          ? mergedTranslations(plan.existing!.links.find((l) => l.id === item.id)?.translations, "label", Object.fromEntries(LANGS.map((c) => [c, (item.translations as Translations)[c]?.label ?? item.label])) as Labels)
          : mergedTranslations({}, "label", Object.fromEntries(LANGS.map((c) => [c, (item.translations as Translations)[c]?.label ?? item.label])) as Labels)) as Prisma.InputJsonValue;
        if (item.id === null) {
          await tx.footerLink.create({ data: { columnId, order, label: item.label, href: item.href, translations } });
          stats.linksCreated++;
        } else {
          const row = plan.existing!.links.find((l) => l.id === item.id)!;
          if (item.changed) {
            await tx.footerLink.update({ where: { id: item.id }, data: { order, label: item.label, translations } });
            stats.linksUpdated++;
          } else if (row.order !== order) {
            await tx.footerLink.update({ where: { id: item.id }, data: { order } });
          }
        }
        order++;
      }
    }
    await tx.auditLog.create({
      data: { actorEmail: `script:${audit.operator}`, action: "navigation.fill_footer_intermediary", targetType: "Navigation", metadata: { script: "fill-footer-intermediary", ...stats, backup: audit.backup } },
    });
  });
  return stats;
}

async function restoreSnapshot(file: string, operator: string) {
  const snap = JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot;
  if (snap.version !== 1 || !Array.isArray(snap.footerColumns)) throw new Error("Geçersiz yedek dosyası biçimi.");
  const pick = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, row[k]]));
  await prisma.$transaction(async (tx) => {
    await tx.footerColumn.deleteMany({});
    for (const col of snap.footerColumns) {
      await tx.footerColumn.create({
        data: {
          ...(pick(col, ["id", "order", "title"]) as { id: string; order: number; title: string }),
          translations: (col.translations ?? {}) as Prisma.InputJsonValue,
          createdAt: new Date(String(col.createdAt)),
          links: { create: col.links.map((l) => ({ ...(pick(l, ["id", "order", "label", "href"]) as { id: string; order: number; label: string; href: string }), translations: (l.translations ?? {}) as Prisma.InputJsonValue })) },
        },
      });
    }
    await tx.auditLog.create({ data: { actorEmail: `script:${operator}`, action: "navigation.restore_fill_footer_intermediary", targetType: "Navigation", metadata: { script: "fill-footer-intermediary", backup: path.basename(file), columns: snap.footerColumns.length } } });
  });
  console.log(`[fix] footer yedekten geri yüklendi (${snap.footerColumns.length} sütun).`);
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
  console.log(`[fill-footer-intermediary] mod=${restore ? (write ? "GERİ YÜKLE" : "KURU (restore)") : write ? "YAZ" : "KURU ÇALIŞTIRMA"}`);
  printTargetDb();
  assertProdWriteAllowed(write, process.argv.slice(2));

  if (restore) {
    const file = path.resolve(restore);
    if (!fs.existsSync(file)) throw new Error(`Yedek dosyası bulunamadı: ${file}`);
    if (!write) {
      console.log(`[kuru] ${file} yedeğinden footer geri yüklenecekti (hiçbir şey yazılmadı).`);
      return;
    }
    await restoreSnapshot(file, operator!.trim());
    return;
  }

  const warnings: Warning[] = [];
  const plans = await buildPlans(warnings);
  describe(plans);
  for (const w of warnings) console.log(`[uyarı] ${w.text}`);
  if (planIsEmpty(plans)) {
    console.log("[bilgi] Yapılacak değişiklik yok (idempotent).");
    return;
  }
  if (!write) {
    console.log("[kuru] hiçbir şey yazılmadı.");
    return;
  }
  const dir = path.resolve(backupDir ?? "storage/backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `footer-fill-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(await readSnapshot(), null, 2), "utf8");
  console.log(`[yedek] ${file}`);
  const stats = await apply(plans, { operator: operator!.trim(), backup: path.basename(file) });
  console.log(`[fix] footer dolduruldu (yeni sütun=${stats.columnsCreated}, yeni bağlantı=${stats.linksCreated}, güncellenen=${stats.linksUpdated}, çıkarılan=${stats.linksRemoved}).`);
  console.log(`[geri al] npx tsx scripts/fill-footer-intermediary.ts --restore=${file} --confirm=${CONFIRM_TOKEN} --operator=<ad>`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
