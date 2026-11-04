/**
 * qa-agent - Paket AK e2e yardimcilari. YALNIZCA saas_e2e uzerinde calisir; uygulama kodunu degistirmez.
 *
 * Canliya benzer "serbest bloklu" ana sayfa: canlidaki ana sayfa Telehealth demo sablonundan icerik aktarilmis serbest
 * sayfa olusturucu bloklaridir (ozellik seridi, Our Specialties, How it works, sayac; doktor ifadeli ESKI metinler). Demo sablonu
 * ice aktarma yolu KULLANILMAZ; ayni yapi bu dosyada kurulur. Ana sayfa, iletisim icerigi ve site ayarlari once yedeklenir
 * (`backupAkState`) ve sonda birebir geri yuklenir (`restoreAkState`).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { API_BASE_URL } from "./api";
import { execSql } from "./ai3-service-fixtures";

export const BACKEND_DIR = path.resolve(__dirname, "../../../../backend");
export const DOCKER_DB = process.env.E2E_DB_CONTAINER ?? "claudecodeproje-db-1";
export const BACKUP_FILE = path.join(os.tmpdir(), "ak-e2e-state-backup.json");
export const E2E_DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/saas_e2e?schema=public";
export const ADDRESS = "Atatürk Mah. Ertuğrul Gazi Sk. Metropol İstanbul C1 Blok No: 2B İç Kapı No: 168, Ataşehir / İstanbul, Türkiye";
export const FIXTURE_PHONE = "+90 212 555 01 00";
export const OLD_MAP_URL = "https://www.google.com/maps/place/Old+Test+Address";
export const PACKAGE_SLUG = "ak-e2e-check-up";

/** Salt-okunur SQL (docker exec psql). saas_e2e disina ASLA baglanmaz. */
export function querySql(sql: string): string {
  return execFileSync("docker", ["exec", DOCKER_DB, "psql", "-U", "postgres", "-d", "saas_e2e", "-At", "-c", sql], { encoding: "utf8" }).trim();
}

const esc = (v: string) => v.replace(/'/g, "''");

export interface AkBackup {
  homePageId: string;
  page: { blocks: unknown; translations: unknown };
  contactPageContent: unknown;
  settings: { findTreatmentEnabled: boolean; bookConsultationCtaEnabled: boolean; serviceBookingEnabled: boolean };
}

export function homePageId(): string {
  return querySql(`select "homePageId" from site_settings limit 1`);
}

/** Yedek: bir kez yazilir; dosya varsa DOKUNULMAZ (yarim kalmis onceki kosunun asil yedegini ezmemek icin). */
export function backupAkState(): AkBackup {
  if (fs.existsSync(BACKUP_FILE)) return JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8")) as AkBackup;
  const id = homePageId();
  const page = JSON.parse(querySql(`select json_build_object('blocks', blocks, 'translations', translations)::text from pages where id='${esc(id)}'`));
  const contact = JSON.parse(querySql(`select coalesce((select "pageContent"::text from contact_forms where id='singleton'), 'null')`));
  const s = querySql(`select "findTreatmentEnabled"::text || ',' || "bookConsultationCtaEnabled"::text || ',' || "serviceBookingEnabled"::text from site_settings limit 1`).split(",");
  const backup: AkBackup = {
    homePageId: id,
    page,
    contactPageContent: contact,
    settings: { findTreatmentEnabled: s[0] === "true", bookConsultationCtaEnabled: s[1] === "true", serviceBookingEnabled: s[2] === "true" },
  };
  fs.writeFileSync(BACKUP_FILE, JSON.stringify(backup));
  return backup;
}

export function restoreAkState(): void {
  if (!fs.existsSync(BACKUP_FILE)) return;
  const b = JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8")) as AkBackup;
  const blocks = esc(JSON.stringify(b.page.blocks));
  const tr = esc(JSON.stringify(b.page.translations));
  const contact = b.contactPageContent === null ? null : esc(JSON.stringify(b.contactPageContent));
  execSql(
    [
      `UPDATE "pages" SET blocks='${blocks}'::jsonb, translations='${tr}'::jsonb WHERE id='${esc(b.homePageId)}';`,
      contact === null ? "" : `UPDATE "contact_forms" SET "pageContent"='${contact}'::jsonb WHERE id='singleton';`,
      `UPDATE "site_settings" SET "findTreatmentEnabled"=${b.settings.findTreatmentEnabled}, "bookConsultationCtaEnabled"=${b.settings.bookConsultationCtaEnabled}, "serviceBookingEnabled"=${b.settings.serviceBookingEnabled};`,
    ].join("\n")
  );
  fs.unlinkSync(BACKUP_FILE);
}

// ---------------------------------------------------------------------------------------------------------------
// Canliya benzer ana sayfa (ESKI, doktor ifadeli metinlerle; hicbir blok gizli degil)
// ---------------------------------------------------------------------------------------------------------------

const Z = { top: 0, right: 0, bottom: 0, left: 0 };
const box = (id: string, direction: "row" | "column", children: unknown[]) => ({
  id,
  type: "container",
  settings: { layout: "boxed", direction, justifyContent: "center", alignItems: "start", gap: 24, padding: { top: 48, right: 24, bottom: 48, left: 24 }, margin: Z, background: { type: "none" } },
  children,
});
const iconBox = (id: string, icon: string, heading: string, description: string) => ({ id, type: "icon-box", data: { icon, heading, description } });
const heading = (id: string, text: string) => ({ id, type: "heading", data: { text, level: 2, align: "center", underline: false } });

interface HomeCopy {
  trust: Array<[string, string]>;
  specialties: string;
  howTitle: string;
  how: Array<[string, string]>;
  counters: Array<[number, string, string?]>;
}
const EN: HomeCopy = {
  trust: [
    ["24/7 Access", "Find an available doctor and book within minutes."],
    ["Encrypted Consultation", "Your video consultation is protected end to end."],
    ["Verified Profiles", "All active doctor profiles are verified."],
  ],
  specialties: "Our Specialties",
  howTitle: "How it works",
  how: [
    ["1. Choose Your Doctor", "Browse verified profiles and pick a doctor."],
    ["2. Pick a Time", "Select a slot in the doctor's availability calendar."],
    ["3. Join the Call", "Join your video consultation from any device."],
  ],
  counters: [
    [15, "Coordinator"],
    [6, "Medical Specialty"],
    [6, "Spoken Language"],
    [30, "Minutes", " min"],
  ],
};
const AR: HomeCopy = {
  trust: [
    ["الوصول على مدار الساعة", "ابحث عن طبيب متاح واحجز خلال دقائق."],
    ["استشارة مشفّرة", "استشارتك المرئية محمية من طرف إلى طرف."],
    ["ملفات موثّقة", "جميع ملفات الأطباء النشطين موثّقة."],
  ],
  specialties: "تخصصاتنا",
  howTitle: "كيف يعمل",
  how: [
    ["١. اختر طبيبك", "تصفّح الملفات الموثّقة واختر طبيبًا."],
    ["٢. اختر الموعد", "اختر موعدًا من تقويم توفّر الطبيب."],
    ["٣. انضم إلى المكالمة", "انضم إلى استشارتك المرئية من أي جهاز."],
  ],
  counters: [
    [15, "منسّق"],
    [6, "تخصص طبي"],
    [6, "لغة منطوقة"],
    [30, "دقيقة"],
  ],
};

function homeBlocks(copy: HomeCopy, locale: "en" | "ar"): unknown[] {
  return [
    box("th-trust-band", "row", copy.trust.map(([h, d], i) => iconBox(`th-trust-${i + 1}`, ["Clock", "ShieldCheck", "BadgeCheck"][i]!, h, d))),
    box("th-specialty-grid", "column", [
      heading("th-specialty-grid-heading", copy.specialties),
      { id: "ak-fx-specialty-cards", type: "specialty-cards", data: { content: { [locale]: { title: copy.specialties, subtitle: "" } }, columns: 4, showDescription: true, imageShape: "circle" } },
    ]),
    box("th-how-it-works", "column", [
      heading("th-how-it-works-heading", copy.howTitle),
      box("th-how-it-works-row", "row", copy.how.map(([h, d], i) => iconBox(`th-how-${i + 1}`, ["UserSearch", "CalendarCheck", "Video"][i]!, h, d))),
    ]),
    {
      id: "th-counters",
      type: "counter",
      data: { items: copy.counters.map(([value, label, suffix], i) => ({ id: `th-counter-${i + 1}`, value, label, ...(suffix ? { suffix } : {}) })) },
    },
  ];
}

export function installLiveLikeHome(): void {
  const b = backupAkState();
  const blocks = esc(JSON.stringify(homeBlocks(EN, "en")));
  const translations = esc(JSON.stringify({ ar: { blocks: homeBlocks(AR, "ar") } }));
  execSql(`UPDATE "pages" SET blocks='${blocks}'::jsonb, translations='${translations}'::jsonb WHERE id='${esc(b.homePageId)}';`);
}

/** ESKI canli iletisim icerigi: Turkce "Pazartesi - Cuma" saatleri, eski harita baglantisi, eski adres; WhatsApp ayri. */
export function installLiveLikeContact(): void {
  backupAkState();
  const locale = {
    title: "Contact",
    intro: "We would love to hear from you.",
    phone: FIXTURE_PHONE,
    whatsapp: "+90 555 000 00 01",
    email: "info@example.com",
    address: "Eski Test Mah. Deneme Sk. No: 1, Kadikoy / Istanbul",
    hours: [
      { label: "Pazartesi - Cuma", value: "09:00 - 18:00" },
      { label: "Cumartesi", value: "10:00 - 14:00" },
    ],
    responseTime: "",
  };
  const content = { locales: { en: locale, tr: locale }, mapImageMediaId: null, mapUrl: OLD_MAP_URL };
  // `formTranslations` gibi mevcut anahtarlar korunur: yalniz sayfa alanlari uzerine yazilir.
  const patch = esc(JSON.stringify(content));
  execSql(`UPDATE "contact_forms" SET "pageContent" = coalesce("pageContent", '{}'::jsonb) || '${patch}'::jsonb - 'hoursVisible' WHERE id='singleton';`);
}

export function setFlagsDirect(find: boolean, book: boolean): void {
  execSql(`UPDATE "site_settings" SET "findTreatmentEnabled"=${find}, "bookConsultationCtaEnabled"=${book};`);
}

/** Frontend onbellegini aninda temizler (yalniz fixture degisikliklerinden sonra; ayar gecikmesi testleri bunu KULLANMAZ). */
export async function flushFrontendCache(): Promise<void> {
  await fetch("http://localhost:3100/api/revalidate", {
    method: "POST",
    headers: { "x-revalidate-secret": "e2e-revalidate-secret", "content-type": "application/json" },
    body: JSON.stringify({ paths: ["/"], type: "layout" }),
  }).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------------------------
// Paket fixture'i (saas_e2e'de hic paket yok) - test sonunda silinir
// ---------------------------------------------------------------------------------------------------------------

export async function createTestPackage(token: string): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/admin/packages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      slug: PACKAGE_SLUG,
      category: "check-up",
      translations: {
        en: { title: "AK Test Check-up Package", summary: "Test package for the AK end-to-end checks.", includes: ["Coordinator call"], notIncluded: [], duration: "", idealFor: "", faq: [] },
        ar: { title: "باقة فحص تجريبية", summary: "باقة اختبار.", includes: ["مكالمة مع المنسّق"], notIncluded: [], duration: "", idealFor: "", faq: [] },
      },
      isActive: true,
    }),
  });
  const body = (await res.json()) as { data?: { id: string }; error?: unknown };
  if (res.status !== 201 || !body.data) throw new Error(`qa-agent: paket olusturulamadi (${res.status}) ${JSON.stringify(body)}`);
  return body.data.id;
}

export async function deleteTestPackage(token: string, id: string): Promise<void> {
  await fetch(`${API_BASE_URL}/admin/packages/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------------------------
// Script calistirma (apply-client-revisions-ak.ts; DATABASE_URL ACIKCA saas_e2e)
// ---------------------------------------------------------------------------------------------------------------

export function runAkScript(args: string[]): string {
  if (!/saas_e2e/.test(E2E_DB_URL)) throw new Error("qa-agent: script yalnizca saas_e2e hedefiyle calisir.");
  const backupDir = path.join(os.tmpdir(), "ak-e2e-script-backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const env = {
    ...process.env,
    DATABASE_URL: E2E_DB_URL,
    NODE_ENV: "development",
    REVALIDATE_SECRET: "e2e-revalidate-secret",
    INTERNAL_FRONTEND_URL: "http://localhost:3100",
    FRONTEND_URL: "http://localhost:3100",
  };
  try {
    return execFileSync("npx", ["tsx", "scripts/apply-client-revisions-ak.ts", ...args, `--backup-dir=${backupDir}`], {
      cwd: BACKEND_DIR,
      env,
      encoding: "utf8",
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    throw new Error(`script hata verdi: ${err.message}\n${err.stdout ?? ""}\n${err.stderr ?? ""}`);
  }
}

export function latestScriptBackup(): string {
  const dir = path.join(os.tmpdir(), "ak-e2e-script-backups");
  const files = fs.readdirSync(dir).filter((f) => f.startsWith("client-revisions-ak-2")).sort();
  if (!files.length) throw new Error("script yedegi bulunamadi");
  return path.join(dir, files[files.length - 1]!);
}

/** Onceki kosulardan kalan script yedeklerini temizler (yalniz gecici dizin). */
export function resetScriptBackups(): void {
  fs.rmSync(path.join(os.tmpdir(), "ak-e2e-script-backups"), { recursive: true, force: true });
}
