/**
 * Paket V (2026-10-30) — hekim listesi ve profilleri `/doctors` → `/physicians` taşındı. Bu modül
 * veritabanındaki site içi bağlantıları yeni yola çevirir (`scripts/rename-doctors-to-physicians.ts`):
 *
 *  - `NavigationItem.href`, `FooterLink.href`, `SiteSettings.headerCtaHref`
 *  - `EmailTemplate.bodyHtml` (`href="..."` öznitelikleri) ve `blocks` JSON'undaki bağlantı alanları
 *  - Hekim listesine giden (sorgu dizesiz `/physicians`) menü/footer öğesinin etiketi "Consult
 *    Physicians" olur ve 8 dilin çevirisi yazılır (`translations.<dil>.label`; diğer alanlar korunur).
 *
 * Eski adresler sitede 301 ile yönlendiği için bu dönüşüm zorunlu değildir; sayfa kaynağında eski
 * yolun kalmaması ve panelde doğru görünmesi için yapılır. Sayfa blokları, doktor `aboutHtml` ve blog
 * içeriklerindeki eski bağlantılar DEĞİŞTİRİLMEZ, yalnızca sayılır (render anında ve 301 ile çözülür).
 *
 * Varsayılan kuru çalışma; yazma `--confirm=rename-physicians --operator=...`, tek transaction, audit
 * kaydında önceki değerler. İdempotent: ikinci çalıştırmada değişiklik kalmaz.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { CACHE_TAGS, triggerTagRevalidation } from "./revalidate";

export const PHYSICIANS_CONFIRM_KEY = "rename-physicians";
export const PHYSICIANS_AUDIT_ACTION = "site.links.physicians_renamed";

/** Menü etiketi — frontend `nav.consultPhysicians` sözlük anahtarıyla AYNI (9 dil). */
export const PHYSICIANS_NAV_LABEL = "Consult Physicians";
export const PHYSICIANS_NAV_TRANSLATIONS: Readonly<Record<string, string>> = {
  tr: "Hekime Danışın",
  de: "Ärztliche Beratung",
  es: "Consultar a un médico",
  fr: "Consulter un médecin",
  ar: "استشر طبيبًا",
  ru: "Консультация врача",
  ro: "Consultați un medic",
  "sr-latn": "Konsultujte lekara",
};

export class PhysiciansLinkError extends Error {}

/** Kök-göreli ya da `{{site_url}}`/mutlak site adresiyle başlayan bağlantıdaki `/doctors` yolu. */
const LINK_PATTERN = /^((?:\{\{\s*site_url\s*\}\}|https?:\/\/[^/\s"']+)?(?:\/[a-z]{2}(?:-[a-z]{4})?)?)\/doctors(?=$|[/?#])/i;

export function rewritePhysiciansLink(href: string): string {
  return href.replace(LINK_PATTERN, "$1/physicians");
}

export function isPhysiciansListLink(href: string): boolean {
  return /^\/physicians\/?$/.test(rewritePhysiciansLink(href.trim()));
}

/** HTML gövdesinde yalnızca `href="..."` / `href='...'` değerleri. */
export function rewriteHtmlLinks(html: string): string {
  return html.replace(/(\bhref\s*=\s*)(["'])([^"']*)\2/gi, (_m, attr: string, quote: string, value: string) => `${attr}${quote}${rewritePhysiciansLink(value)}${quote}`);
}

const LINK_KEYS = /^(href|url|link|buttonHref|buttonUrl|linkHref|ctaHref)$/i;

/** E-posta blok JSON'unda bağlantı alanları (`href`, `url`, `buttonUrl`...) ve `html` metinleri. */
export function rewriteJsonLinks(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteJsonLinks);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string" && LINK_KEYS.test(k)) out[k] = rewritePhysiciansLink(v);
      else if (typeof v === "string" && /^(html|content|body)$/i.test(k)) out[k] = rewriteHtmlLinks(v);
      else out[k] = rewriteJsonLinks(v);
    }
    return out;
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** `translations` haritasına 8 dilin menü etiketini yazar; diğer dil/alanlar korunur. */
export function withPhysiciansLabelTranslations(translations: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { ...asRecord(translations) };
  for (const [locale, label] of Object.entries(PHYSICIANS_NAV_TRANSLATIONS)) {
    out[locale] = { ...asRecord(out[locale]), label };
  }
  return out;
}

type LinkRow = { id: string; label: string; href: string; translations: unknown };

export interface LinkChange {
  model: "NavigationItem" | "FooterLink";
  id: string;
  before: { label: string; href: string; translations: unknown };
  after: { label: string; href: string; translations: Record<string, unknown> | unknown };
}

export interface PhysiciansPlan {
  links: LinkChange[];
  headerCta: { before: string; after: string } | null;
  emailTemplates: { id: string; name: string; before: { bodyHtml: string; blocks: unknown }; after: { bodyHtml: string; blocks: unknown } }[];
  /** Değiştirilmeyen, yalnızca sayılan eski bağlantılar (301 ve render anında çözülür). */
  untouched: { pages: number; doctors: number; posts: number };
}

function planLink(model: LinkChange["model"], row: LinkRow): LinkChange | null {
  const href = rewritePhysiciansLink(row.href);
  const isList = isPhysiciansListLink(href);
  const label = isList ? PHYSICIANS_NAV_LABEL : row.label;
  const translations = isList ? withPhysiciansLabelTranslations(row.translations) : row.translations;
  const changed = href !== row.href || label !== row.label || JSON.stringify(translations) !== JSON.stringify(row.translations ?? {});
  if (!changed) return null;
  return { model, id: row.id, before: { label: row.label, href: row.href, translations: row.translations }, after: { label, href, translations } };
}

type Db = Pick<PrismaClient, "navigationItem" | "footerLink" | "siteSettings" | "emailTemplate" | "page" | "doctorProfile" | "blogPost" | "auditLog" | "$transaction" | "$queryRaw">;

export async function buildPhysiciansPlan(db: Db): Promise<PhysiciansPlan> {
  const [nav, footer, settings, templates] = await Promise.all([
    db.navigationItem.findMany({ select: { id: true, label: true, href: true, translations: true }, orderBy: { seq: "asc" } }),
    db.footerLink.findMany({ select: { id: true, label: true, href: true, translations: true }, orderBy: { order: "asc" } }),
    db.siteSettings.findUnique({ where: { id: "singleton" }, select: { headerCtaHref: true } }),
    db.emailTemplate.findMany({ select: { id: true, name: true, bodyHtml: true, blocks: true }, orderBy: { seq: "asc" } }),
  ]);
  const links = [...nav.map((r) => planLink("NavigationItem", r)), ...footer.map((r) => planLink("FooterLink", r))].filter((c): c is LinkChange => c !== null);

  const ctaBefore = settings?.headerCtaHref ?? null;
  const ctaAfter = ctaBefore ? rewritePhysiciansLink(ctaBefore) : null;

  const emailTemplates = templates.flatMap((t) => {
    const bodyHtml = rewriteHtmlLinks(t.bodyHtml);
    const blocks = rewriteJsonLinks(t.blocks);
    if (bodyHtml === t.bodyHtml && JSON.stringify(blocks) === JSON.stringify(t.blocks)) return [];
    return [{ id: t.id, name: t.name, before: { bodyHtml: t.bodyHtml, blocks: t.blocks }, after: { bodyHtml, blocks } }];
  });

  // Yalnızca sayım: JSON/metin içinde `/doctors` site yolu geçen kayıtlar (yönetici panelinden ya da 301 ile).
  const legacy = { contains: "/doctors" };
  const [pageRows, doctors, posts] = await Promise.all([
    db.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM "pages" WHERE "blocks"::text LIKE '%/doctors%' OR "translations"::text LIKE '%/doctors%'`,
    db.doctorProfile.count({ where: { OR: [{ aboutHtml: legacy }, { bio: legacy }] } }),
    db.blogPost.count({ where: { contentHtml: legacy } }),
  ]);
  const pages = pageRows[0]?.n ?? 0;

  return {
    links,
    headerCta: ctaBefore && ctaAfter !== ctaBefore ? { before: ctaBefore, after: ctaAfter! } : null,
    emailTemplates,
    untouched: { pages, doctors, posts },
  };
}

export function formatPhysiciansPlan(plan: PhysiciansPlan): string {
  const lines: string[] = [];
  for (const c of plan.links) {
    lines.push(`${c.model} ${c.id}: "${c.before.label}" ${c.before.href} → "${c.after.label}" ${c.after.href}`);
  }
  if (plan.headerCta) lines.push(`SiteSettings.headerCtaHref: ${plan.headerCta.before} → ${plan.headerCta.after}`);
  for (const t of plan.emailTemplates) lines.push(`EmailTemplate "${t.name}": /doctors bağlantıları /physicians olur`);
  const total = plan.links.length + (plan.headerCta ? 1 : 0) + plan.emailTemplates.length;
  lines.push(total === 0 ? "Değiştirilecek kayıt yok." : `Toplam ${total} kayıt değişecek.`);
  const u = plan.untouched;
  lines.push(`Değiştirilmeyen (301 ile çözülür, yalnızca bilgi): ${u.pages} sayfa, ${u.doctors} doktor açıklaması, ${u.posts} blog yazısı eski /doctors bağlantısı içeriyor.`);
  return lines.join("\n");
}

function appLike(db: unknown): FastifyInstance {
  const log = { warn: (...a: unknown[]) => console.warn(...a), info: () => {}, error: (...a: unknown[]) => console.error(...a) };
  return { prisma: db, log } as unknown as FastifyInstance;
}

export async function applyPhysiciansPlan(
  db: Db,
  plan: PhysiciansPlan,
  options: { confirm?: string; operator: string; osUser: string; hostname: string; revalidate?: boolean }
): Promise<{ changed: number }> {
  if (options.confirm !== PHYSICIANS_CONFIRM_KEY) throw new PhysiciansLinkError(`Gerçek yazma için --confirm=${PHYSICIANS_CONFIRM_KEY} gerekir.`);
  if (!options.operator.trim()) throw new PhysiciansLinkError('--operator="Ad Soyad" zorunludur.');
  const changed = plan.links.length + (plan.headerCta ? 1 : 0) + plan.emailTemplates.length;
  if (changed === 0) throw new PhysiciansLinkError("Yazılacak değişiklik yok.");

  await db.$transaction(async (tx) => {
    for (const c of plan.links) {
      const data = { label: c.after.label, href: c.after.href, translations: c.after.translations as Prisma.InputJsonValue };
      // Plan alındıktan sonra panelden değişmişse (href/etiket farklı) hiçbir şey yazılmaz.
      const where = { id: c.id, href: c.before.href, label: c.before.label };
      const res = c.model === "NavigationItem" ? await tx.navigationItem.updateMany({ where, data }) : await tx.footerLink.updateMany({ where, data });
      if (res.count !== 1) throw new PhysiciansLinkError(`${c.model} ${c.id} plan alındıktan sonra değişmiş; işlem geri alındı. Kuru çalışmayı yeniden yapın.`);
    }
    if (plan.headerCta) {
      const res = await tx.siteSettings.updateMany({ where: { id: "singleton", headerCtaHref: plan.headerCta.before }, data: { headerCtaHref: plan.headerCta.after } });
      if (res.count !== 1) throw new PhysiciansLinkError("Header CTA bağlantısı plan alındıktan sonra değişmiş; işlem geri alındı.");
    }
    for (const t of plan.emailTemplates) {
      await tx.emailTemplate.update({ where: { id: t.id }, data: { bodyHtml: t.after.bodyHtml, blocks: t.after.blocks as Prisma.InputJsonValue } });
    }
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorEmail: null,
        action: PHYSICIANS_AUDIT_ACTION,
        targetType: "Site",
        targetId: null,
        metadata: {
          operator: options.operator,
          osUser: options.osUser,
          hostname: options.hostname,
          links: plan.links.map((c) => ({ model: c.model, id: c.id, before: c.before })),
          headerCta: plan.headerCta,
          emailTemplates: plan.emailTemplates.map((t) => ({ id: t.id, name: t.name, before: t.before })),
        } as Prisma.InputJsonValue,
      },
    });
  });
  if (options.revalidate !== false) await triggerTagRevalidation(appLike(db), [CACHE_TAGS.navigation, CACHE_TAGS.settings]);
  return { changed };
}
