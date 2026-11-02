/**
 * Paket AH - footer VERISINI Ingilizceye (+ 8 dil cevirisine) cevirir ve footer'dan TR yasal sayfa baglantilarini cikarir.
 *
 * FOOTER VERISI NEREDE: `FooterColumn` (title, translations) -> `FooterLink` (label, href, translations); site slogani ve telif
 * metni `SiteSettings.tagline` / `SiteSettings.footerCopyrightText` (+ `SiteSettings.translations[dil]`). Yasal sayfalar `Page`
 * (isLegalDocument) kayitlaridir; footer baglantilari bu sayfalarin slug'larina gider.
 *
 * NE YAPAR:
 *  1) Turkce sutun basligi / baglanti etiketi bilinen sozlukte varsa kanonik EN + 8 dil `translations` yazar
 *     (Branşlar -> Services, Yasal -> Legal, Hakkımızda -> About, ...). Sozlukte olmayan Turkce metin DEGISTIRILMEZ, raporlanir.
 *  2) Footer baglantisi bir TR yasal sayfaya gidiyorsa (yasal sayfanin `tr` slug'i EN slug'indan farkliysa o slug; ya da
 *     baslik/slug'i Turkce olan yasal sayfa) baglanti CIKARILIR. Sayfa kayitlari SILINMEZ (yalniz footer baglantisi).
 *  3) /physicians ve /doctors baglantilari (ziyaretciye kapandi, 301) CIKARILIR.
 *  4) Slogan / telif metni Turkce ise (ozel karakter ya da bilinen Turkce kelime) `null` yapilir (site varsayilani gosterir).
 *
 * Sonunda footer'da EN gizlilik/aydinlatma (Privacy Notice/Policy) baglantisi kaldi mi kontrol edilir; yoksa uyarir.
 * NODE_ENV=production iken yazma/geri yukleme ek --i-know-this-is-prod bayragi ister; her calismada hedef DB (host:port/db, parolasiz) yazdirilir.
 * Guvenlik: varsayilan KURU; yazmak icin --confirm=localize-footer-english --operator=<ad>; idempotent; yazmadan once footer +
 * slogan/telif/ceviri yedegi (storage/backups/footer-<tarih>.json); --restore=<yedek.json> ile geri yukleme; audit log.
 *
 * Calistirma (backend/ dizininden; DATABASE_URL'i ACIKCA export edin):
 *   npx tsx scripts/localize-footer-english.ts
 *   npx tsx scripts/localize-footer-english.ts --confirm=localize-footer-english --operator=ridvan
 *   npx tsx scripts/localize-footer-english.ts --restore=storage/backups/footer-<tarih>.json --confirm=localize-footer-english --operator=ridvan
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";
import { assertProdWriteAllowed, printTargetDb } from "./_script-guard";

const prisma = new PrismaClient();

const CONFIRM_TOKEN = "localize-footer-english";
const LANGS = ["en", "de", "ar", "ru", "fr", "es", "ro", "sr-latn"] as const;
type Lang = (typeof LANGS)[number];
type Labels = Record<Lang, string>;

const DICT: Record<string, Labels> = {
  services: { en: "Services", de: "Leistungen", ar: "الخدمات", ru: "Услуги", fr: "Services", es: "Servicios", ro: "Servicii", "sr-latn": "Usluge" },
  legal: { en: "Legal", de: "Rechtliches", ar: "قانوني", ru: "Правовая информация", fr: "Mentions légales", es: "Legal", ro: "Informații legale", "sr-latn": "Pravne informacije" },
  company: { en: "Company", de: "Unternehmen", ar: "الشركة", ru: "Компания", fr: "Société", es: "Empresa", ro: "Companie", "sr-latn": "Kompanija" },
  about: { en: "About", de: "Über uns", ar: "من نحن", ru: "О нас", fr: "À propos", es: "Nosotros", ro: "Despre noi", "sr-latn": "O nama" },
  contact: { en: "Contact", de: "Kontakt", ar: "اتصل بنا", ru: "Контакты", fr: "Contact", es: "Contacto", ro: "Contact", "sr-latn": "Kontakt" },
  guides: { en: "Health Guides", de: "Gesundheitsratgeber", ar: "أدلة صحية", ru: "Руководства по здоровью", fr: "Guides santé", es: "Guías de salud", ro: "Ghiduri de sănătate", "sr-latn": "Vodiči za zdravlje" },
  faq: { en: "FAQ", de: "FAQ", ar: "الأسئلة الشائعة", ru: "Вопросы и ответы", fr: "FAQ", es: "Preguntas frecuentes", ro: "Întrebări frecvente", "sr-latn": "Česta pitanja" },
  privacy: { en: "Privacy Policy", de: "Datenschutzerklärung", ar: "سياسة الخصوصية", ru: "Политика конфиденциальности", fr: "Politique de confidentialité", es: "Política de privacidad", ro: "Politica de confidențialitate", "sr-latn": "Politika privatnosti" },
  notice: { en: "Privacy Notice", de: "Datenschutzhinweise", ar: "إشعار الخصوصية", ru: "Уведомление о конфиденциальности", fr: "Notice d’information", es: "Aviso de privacidad", ro: "Notă de informare", "sr-latn": "Obaveštenje o privatnosti" },
  terms: { en: "Terms of Use", de: "Nutzungsbedingungen", ar: "شروط الاستخدام", ru: "Условия использования", fr: "Conditions d’utilisation", es: "Condiciones de uso", ro: "Termeni de utilizare", "sr-latn": "Uslovi korišćenja" },
  home: { en: "Home", de: "Startseite", ar: "الرئيسية", ru: "Главная", fr: "Accueil", es: "Inicio", ro: "Acasă", "sr-latn": "Početna" },
  howItWorks: { en: "How it works", de: "So funktioniert es", ar: "كيف يعمل", ru: "Как это работает", fr: "Comment ça marche", es: "Cómo funciona", ro: "Cum funcționează", "sr-latn": "Kako funkcioniše" },
  cookies: { en: "Cookie Policy", de: "Cookie-Richtlinie", ar: "سياسة ملفات تعريف الارتباط", ru: "Политика использования файлов cookie", fr: "Politique relative aux cookies", es: "Política de cookies", ro: "Politica privind cookie-urile", "sr-latn": "Politika kolačića" },
};

/** Turkce metin (kucuk harf, trim) -> sozluk anahtari. */
const TURKISH_TO_KEY: Record<string, keyof typeof DICT> = {
  "branşlar": "services",
  "uzmanlıklar": "services",
  "hizmetler": "services",
  "yasal": "legal",
  "kurumsal": "company",
  "şirket": "company",
  "hakkımızda": "about",
  "i̇letişim": "contact",
  "iletişim": "contact",
  "bize ulaşın": "contact",
  "sağlık rehberleri": "guides",
  "sıkça sorulan sorular": "faq",
  "sss": "faq",
  "gizlilik politikası": "privacy",
  "kvkk aydınlatma metni": "notice",
  "aydınlatma metni": "notice",
  "kullanım şartları": "terms",
  "kullanım koşulları": "terms",
  "çerez politikası": "cookies",
  "ana sayfa": "home",
  "anasayfa": "home",
  "nasıl çalışır?": "howItWorks",
  "nasıl çalışır": "howItWorks",
};

const TURKISH_CHARS = /[çğıöşüÇĞİÖŞÜ]/;
const TURKISH_WORDS = /\b(tüm hakları|saklıdır|evinizden|uzman|doktor|güvenli|görüşme|hakkımızda|gizlilik|aydınlatma|politikası|şartları|kullanım|çerez|branşlar|yasal|ana sayfa|anasayfa|hizmetler|randevu|hekim|sağlık|nasıl)\b/i;
const looksTurkish = (value: string | null | undefined) => !!value && (TURKISH_CHARS.test(value) || TURKISH_WORDS.test(value));
const norm = (value: string) => value.trim().toLocaleLowerCase("tr");

function translationsFor(key: keyof typeof DICT, field: "title" | "label", existing: unknown): Prisma.InputJsonValue {
  const base = existing && typeof existing === "object" ? ({ ...(existing as Record<string, Record<string, unknown>>) } as Record<string, Record<string, unknown>>) : {};
  for (const code of LANGS) base[code] = { ...(base[code] ?? {}), [field]: DICT[key]![code] };
  return base as Prisma.InputJsonValue;
}

interface Snapshot {
  version: 1;
  createdAt: string;
  footerColumns: (Record<string, unknown> & { links: Record<string, unknown>[] })[];
  siteSettings: { tagline: string | null; footerCopyrightText: string | null; translations: unknown } | null;
}

async function readSnapshot(): Promise<Snapshot> {
  const [footerColumns, siteSettings] = await Promise.all([
    prisma.footerColumn.findMany({ orderBy: { order: "asc" }, include: { links: { orderBy: { order: "asc" } } } }),
    prisma.siteSettings.findUnique({ where: { id: "singleton" }, select: { tagline: true, footerCopyrightText: true, translations: true } }),
  ]);
  return JSON.parse(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), footerColumns, siteSettings })) as Snapshot;
}

/** TR yasal sayfalarin slug kumesi (footer baglantisi bunlardan birine gidiyorsa cikarilir). */
async function turkishLegalSlugs(): Promise<Set<string>> {
  const pages = await prisma.page.findMany({ where: { isLegalDocument: true }, select: { id: true, slug: true, title: true } });
  const slugs = await prisma.contentSlug.findMany({ where: { entityType: "PAGE", entityId: { in: pages.map((p) => p.id) } }, select: { entityId: true, locale: true, slug: true } });
  const result = new Set<string>();
  for (const page of pages) {
    const en = slugs.find((s) => s.entityId === page.id && s.locale === "en")?.slug ?? null;
    const trSlug = slugs.find((s) => s.entityId === page.id && s.locale === "tr")?.slug ?? null;
    if (trSlug && trSlug !== en) result.add(trSlug);
    // Kanonik slug/baslik Turkce ise (varsayilan dil henuz TR iken olusmus sayfa) ve EN slug'i farkliysa kanonik slug TR adrestir.
    if ((looksTurkish(page.title) || looksTurkish(page.slug.replace(/-/g, " "))) && (en === null || en !== page.slug)) result.add(page.slug);
  }
  return result;
}

const slugOf = (href: string) => href.trim().replace(/^\/(?:[a-z]{2}(?:-[a-z]{4})?\/)?/, "").replace(/[/?#].*$/, "");
// Yol oneki eslesmesi: /physicians, /doctors, /doctors/<slug>, /physicians?specialty=..., /{dil}/physicians... (sorgu ve capa dahil).
const REMOVED_PATHS = /^(?:https?:\/\/[^/]+)?\/(?:[a-z]{2}(?:-[a-z]{4})?\/)?(?:physicians|doctors)(?:[/?#]|$)/i;

interface Plan {
  columns: { id: string; title: string; key: keyof typeof DICT }[];
  links: { id: string; label: string; key: keyof typeof DICT }[];
  removeLinks: { id: string; label: string; href: string; reason: string }[];
  untranslated: string[];
  tagline: boolean;
  copyright: boolean;
}

async function buildPlan(): Promise<Plan> {
  const trLegal = await turkishLegalSlugs();
  const columns = await prisma.footerColumn.findMany({ orderBy: { order: "asc" }, include: { links: { orderBy: { order: "asc" } } } });
  const settings = await prisma.siteSettings.findUnique({ where: { id: "singleton" }, select: { tagline: true, footerCopyrightText: true } });
  const plan: Plan = { columns: [], links: [], removeLinks: [], untranslated: [], tagline: looksTurkish(settings?.tagline), copyright: looksTurkish(settings?.footerCopyrightText), };
  for (const column of columns) {
    const key = TURKISH_TO_KEY[norm(column.title)];
    if (key) plan.columns.push({ id: column.id, title: column.title, key });
    else if (looksTurkish(column.title)) plan.untranslated.push(`sütun: ${column.title}`);
    for (const link of column.links) {
      if (REMOVED_PATHS.test(link.href)) {
        plan.removeLinks.push({ id: link.id, label: link.label, href: link.href, reason: "hekim adresi (301)" });
        continue;
      }
      if (trLegal.has(slugOf(link.href))) {
        plan.removeLinks.push({ id: link.id, label: link.label, href: link.href, reason: "TR yasal sayfa" });
        continue;
      }
      const linkKey = TURKISH_TO_KEY[norm(link.label)];
      if (linkKey) plan.links.push({ id: link.id, label: link.label, key: linkKey });
      else if (looksTurkish(link.label)) plan.untranslated.push(`bağlantı: ${link.label} (${link.href})`);
    }
  }
  return plan;
}

function describe(plan: Plan) {
  for (const c of plan.columns) console.log(`[plan] sütun "${c.title}" -> "${DICT[c.key]!.en}" (+8 dil)`);
  for (const l of plan.links) console.log(`[plan] bağlantı "${l.label}" -> "${DICT[l.key]!.en}" (+8 dil)`);
  for (const r of plan.removeLinks) console.log(`[plan] bağlantı ÇIKARILIR: "${r.label}" ${r.href} (${r.reason})`);
  if (plan.tagline) console.log("[plan] slogan Türkçe -> null (site varsayılanı)");
  if (plan.copyright) console.log("[plan] telif metni Türkçe -> null (site varsayılanı: © yıl ad. All rights reserved)");
  if (plan.untranslated.length > 0) {
    console.log("");
    console.log("=== ELLE ÇEVİR: sözlükte olmayan Türkçe footer metinleri (DEĞİŞTİRİLMEDİ) ===");
    for (const u of plan.untranslated) console.log(`[ELLE ÇEVİR] ${u}`);
    console.log("=====================================================================");
  }
}

/** Footer'da (cikarilacaklar haric) EN gizlilik/aydinlatma baglantisi kaliyor mu? Plan ceviriyle yeni "Privacy" etiketi de sayilir. */
async function warnIfNoPrivacyLink(plan: Plan) {
  const removed = new Set(plan.removeLinks.map((r) => r.id));
  const translatedPrivacy = new Set(plan.links.filter((l) => l.key === "privacy" || l.key === "notice").map((l) => l.id));
  const links = await prisma.footerLink.findMany({ select: { id: true, label: true, href: true } });
  const has = links.some((l) => !removed.has(l.id) && (translatedPrivacy.has(l.id) || /privacy|data-protection|notice/i.test(l.href) || /^privacy (policy|notice)$/i.test(l.label.trim())));
  if (!has) console.log("[uyarı] footer'da EN gizlilik/aydınlatma (Privacy Notice/Policy) bağlantısı KALMADI — panelden EN yasal sayfaya bağlantı ekleyin.");
  else console.log("[kontrol] footer'da EN gizlilik/aydınlatma bağlantısı mevcut.");
}

const empty = (plan: Plan) => plan.columns.length + plan.links.length + plan.removeLinks.length === 0 && !plan.tagline && !plan.copyright;

async function apply(plan: Plan) {
  await prisma.$transaction(async (tx) => {
    for (const c of plan.columns) {
      const row = await tx.footerColumn.findUniqueOrThrow({ where: { id: c.id }, select: { translations: true } });
      await tx.footerColumn.update({ where: { id: c.id }, data: { title: DICT[c.key]!.en, translations: translationsFor(c.key, "title", row.translations) } });
    }
    for (const l of plan.links) {
      const row = await tx.footerLink.findUniqueOrThrow({ where: { id: l.id }, select: { translations: true } });
      await tx.footerLink.update({ where: { id: l.id }, data: { label: DICT[l.key]!.en, translations: translationsFor(l.key, "label", row.translations) } });
    }
    if (plan.removeLinks.length > 0) await tx.footerLink.deleteMany({ where: { id: { in: plan.removeLinks.map((r) => r.id) } } });
    // Kalan baglantilarin sirasi 0..n-1 olarak sikistirilir.
    for (const column of await tx.footerColumn.findMany({ include: { links: { orderBy: { order: "asc" } } } })) {
      for (let i = 0; i < column.links.length; i++) if (column.links[i]!.order !== i) await tx.footerLink.update({ where: { id: column.links[i]!.id }, data: { order: i } });
    }
    if (plan.tagline || plan.copyright) {
      await tx.siteSettings.updateMany({ where: { id: "singleton" }, data: { ...(plan.tagline ? { tagline: null } : {}), ...(plan.copyright ? { footerCopyrightText: null } : {}) } });
    }
  });
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
    if (snap.siteSettings) {
      await tx.siteSettings.updateMany({ where: { id: "singleton" }, data: { tagline: snap.siteSettings.tagline, footerCopyrightText: snap.siteSettings.footerCopyrightText } });
    }
    await tx.auditLog.create({ data: { actorEmail: `script:${operator}`, action: "navigation.restore_footer_english", targetType: "Navigation", metadata: { script: "localize-footer-english", backup: path.basename(file), columns: snap.footerColumns.length } } });
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
  console.log(`[localize-footer-english] mod=${restore ? (write ? "GERİ YÜKLE" : "KURU (restore)") : write ? "YAZ" : "KURU ÇALIŞTIRMA"}`);
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

  const plan = await buildPlan();
  describe(plan);
  await warnIfNoPrivacyLink(plan);
  if (empty(plan)) {
    console.log("[bilgi] Yapılacak değişiklik yok (idempotent).");
    return;
  }
  if (!write) {
    console.log("[kuru] hiçbir şey yazılmadı.");
    return;
  }
  const dir = path.resolve(backupDir ?? "storage/backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `footer-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(await readSnapshot(), null, 2), "utf8");
  console.log(`[yedek] ${file}`);
  await apply(plan);
  await warnIfNoPrivacyLink({ ...plan, removeLinks: [], links: [] });
  await prisma.auditLog.create({
    data: {
      actorEmail: `script:${operator!.trim()}`,
      action: "navigation.localize_footer_english",
      targetType: "Navigation",
      metadata: { script: "localize-footer-english", columns: plan.columns.length, links: plan.links.length, removed: plan.removeLinks.length, tagline: plan.tagline, copyright: plan.copyright, backup: path.basename(file) },
    },
  });
  console.log(`[fix] footer güncellendi (sütun=${plan.columns.length}, bağlantı=${plan.links.length}, çıkarılan=${plan.removeLinks.length}).`);
  console.log(`[geri al] npx tsx scripts/localize-footer-english.ts --restore=${file} --confirm=${CONFIRM_TOKEN} --operator=<ad>`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
