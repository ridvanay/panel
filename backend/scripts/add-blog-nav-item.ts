/**
 * Paket Z1-ek (İş 5) — header ve footer menülerine "Health Guides" (/blog) bağlantısını 9 dilde etiketle ekler.
 *
 * MENÜ YAPISI:
 *  - Header: `NavigationItem` (kök öğeler `parentId = null`, sıra kardeş-kapsamlı `order`).
 *  - Footer: `FooterColumn` -> `FooterLink` (sıra sütun içinde `order`).
 *  - Etiket çevirisi: `translations = { "<dil>": { "label": "..." } }`; kanonik `label` = EN. Href dil öneksiz saklanır
 *    (örn. "/faq", "/physicians"); dil önekini site render sırasında ekler.
 *
 * NEREYE EKLER:
 *  - Header: kök seviyede, href'i /about|/about-us|/hakkimizda olan öğenin HEMEN ÖNÜNE; yoksa SONA.
 *  - Footer: /about benzeri bağlantı içeren sütunda o bağlantının önüne; yoksa ilk sütunun SONUNA.
 *    (Hiç sütun yoksa footer atlanır; sütun OLUŞTURULMAZ.)
 *
 * Güvenlik:
 *  - Varsayılan KURU ÇALIŞTIRMA (hiçbir şey yazılmaz, yedek de alınmaz).
 *  - Yazmak için: --confirm=add-blog-nav --operator=<ad>
 *  - Idempotent: menüde href="/blog" zaten varsa o menü atlanır.
 *  - Yazmadan önce header+footer'ın TAM JSON yedeği alınır (varsayılan storage/backups/nav-<tarih>.json).
 *  - Geri yükleme: --restore=<yedek.json> --confirm=add-blog-nav --operator=<ad>
 *    (UYARI: menüleri yedekteki hâle TAM DEĞİŞTİRİR; yedekten sonra panelden yapılan menü değişiklikleri kaybolur.)
 *  - İşlem audit log'a yazılır. Önbellek kendiliğinden yenilenmez (navigation etiketi); site birkaç dk içinde yansır.
 *
 * Çalıştırma (backend/ dizininden):
 *   npx tsx scripts/add-blog-nav-item.ts
 *   npx tsx scripts/add-blog-nav-item.ts --confirm=add-blog-nav --operator=ridvan
 *   npx tsx scripts/add-blog-nav-item.ts --restore=storage/backups/nav-<tarih>.json --confirm=add-blog-nav --operator=ridvan
 *   (isteğe bağlı: --backup-dir=<yol>)
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const CONFIRM_TOKEN = "add-blog-nav";
const HREF = "/blog";
const LABELS: Record<string, string> = {
  en: "Health Guides",
  tr: "Sağlık Rehberleri",
  de: "Gesundheitsratgeber",
  ar: "أدلة صحية",
  ru: "Руководства по здоровью",
  es: "Guías de salud",
  fr: "Guides santé",
  ro: "Ghiduri de sănătate",
  "sr-latn": "Vodiči za zdravlje",
};
const CANONICAL_LABEL = LABELS.en!;
const ABOUT_HREFS = new Set(["/about", "/about-us", "/hakkimizda"]);

function buildTranslations(): Prisma.InputJsonValue {
  return Object.fromEntries(Object.entries(LABELS).map(([code, label]) => [code, { label }])) as Prisma.InputJsonValue;
}

function parseArgs(argv: string[]) {
  const value = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  return { confirm: value("confirm"), operator: value("operator"), restore: value("restore"), backupDir: value("backup-dir") };
}

interface Snapshot {
  version: 1;
  createdAt: string;
  navigationItems: Record<string, unknown>[];
  footerColumns: (Record<string, unknown> & { links: Record<string, unknown>[] })[];
}

async function readSnapshot(): Promise<Snapshot> {
  const [navigationItems, footerColumns] = await Promise.all([
    prisma.navigationItem.findMany({ orderBy: [{ order: "asc" }, { seq: "asc" }] }),
    prisma.footerColumn.findMany({ orderBy: { order: "asc" }, include: { links: { orderBy: { order: "asc" } } } }),
  ]);
  return JSON.parse(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), navigationItems, footerColumns })) as Snapshot;
}

interface Plan {
  header: { skip: boolean; position: number; total: number; before: string | null };
  footer: { skip: boolean; reason?: string; columnId?: string; columnTitle?: string; position?: number; total?: number; before?: string | null };
}

async function buildPlan(): Promise<Plan> {
  const roots = await prisma.navigationItem.findMany({ where: { parentId: null }, orderBy: [{ order: "asc" }, { seq: "asc" }] });
  const headerExists = (await prisma.navigationItem.count({ where: { href: HREF } })) > 0;
  const aboutIdx = roots.findIndex((r) => ABOUT_HREFS.has(r.href));
  const header: Plan["header"] = {
    skip: headerExists,
    position: aboutIdx >= 0 ? aboutIdx : roots.length,
    total: roots.length,
    before: aboutIdx >= 0 ? roots[aboutIdx]!.label : null,
  };

  const columns = await prisma.footerColumn.findMany({ orderBy: { order: "asc" }, include: { links: { orderBy: { order: "asc" } } } });
  const footerExists = columns.some((c) => c.links.some((l) => l.href === HREF));
  let footer: Plan["footer"];
  if (footerExists) footer = { skip: true, reason: `href="${HREF}" zaten var` };
  else if (columns.length === 0) footer = { skip: true, reason: "footer sütunu yok (sütun oluşturulmaz)" };
  else {
    const withAbout = columns.find((c) => c.links.some((l) => ABOUT_HREFS.has(l.href)));
    const column = withAbout ?? columns[0]!;
    const idx = column.links.findIndex((l) => ABOUT_HREFS.has(l.href));
    footer = {
      skip: false,
      columnId: column.id,
      columnTitle: column.title,
      position: idx >= 0 ? idx : column.links.length,
      total: column.links.length,
      before: idx >= 0 ? column.links[idx]!.label : null,
    };
  }
  return { header, footer };
}

function describePlan(plan: Plan) {
  const h = plan.header;
  console.log(
    h.skip
      ? `[atla] header: href="${HREF}" zaten var.`
      : `[plan] header: kök menüde ${h.before ? `"${h.before}" öğesinin önüne` : "SONA"} (konum ${h.position}/${h.total}) "${CANONICAL_LABEL}" -> ${HREF}`
  );
  const f = plan.footer;
  console.log(
    f.skip
      ? `[atla] footer: ${f.reason}.`
      : `[plan] footer: "${f.columnTitle}" sütununda ${f.before ? `"${f.before}" bağlantısının önüne` : "SONA"} (konum ${f.position}/${f.total}) "${CANONICAL_LABEL}" -> ${HREF}`
  );
  console.log(`[plan] etiketler: ${Object.entries(LABELS).map(([c, l]) => `${c}="${l}"`).join(" | ")}`);
}

async function applyPlan(plan: Plan): Promise<{ headerId?: string; footerId?: string }> {
  const translations = buildTranslations();
  return prisma.$transaction(async (tx) => {
    const result: { headerId?: string; footerId?: string } = {};
    if (!plan.header.skip) {
      const roots = await tx.navigationItem.findMany({ where: { parentId: null }, orderBy: [{ order: "asc" }, { seq: "asc" }] });
      const created = await tx.navigationItem.create({
        data: { label: CANONICAL_LABEL, href: HREF, order: plan.header.position, parentId: null, translations },
      });
      // Konumdan sonrakileri bir kaydır; kök öğe sıraları 0..n-1 olarak yeniden yazılır.
      const ordered = [...roots.slice(0, plan.header.position), created, ...roots.slice(plan.header.position)];
      for (let i = 0; i < ordered.length; i++) {
        if (ordered[i]!.order !== i) await tx.navigationItem.update({ where: { id: ordered[i]!.id }, data: { order: i } });
      }
      result.headerId = created.id;
    }
    if (!plan.footer.skip && plan.footer.columnId) {
      const links = await tx.footerLink.findMany({ where: { columnId: plan.footer.columnId }, orderBy: { order: "asc" } });
      const pos = Math.min(plan.footer.position ?? links.length, links.length);
      const created = await tx.footerLink.create({
        data: { columnId: plan.footer.columnId, label: CANONICAL_LABEL, href: HREF, order: pos, translations },
      });
      const ordered = [...links.slice(0, pos), created, ...links.slice(pos)];
      for (let i = 0; i < ordered.length; i++) {
        if (ordered[i]!.order !== i) await tx.footerLink.update({ where: { id: ordered[i]!.id }, data: { order: i } });
      }
      result.footerId = created.id;
    }
    return result;
  });
}

async function restoreSnapshot(file: string, operator: string) {
  const snap = JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot;
  if (snap.version !== 1 || !Array.isArray(snap.navigationItems) || !Array.isArray(snap.footerColumns)) {
    throw new Error("Geçersiz yedek dosyası biçimi.");
  }
  const pick = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, row[k]]));
  await prisma.$transaction(async (tx) => {
    await tx.navigationItem.deleteMany({});
    const itemData = (row: Record<string, unknown>) =>
      ({ ...pick(row, ["id", "order", "label", "href", "parentId"]), translations: row.translations ?? {}, createdAt: new Date(String(row.createdAt)) }) as Prisma.NavigationItemUncheckedCreateInput;
    for (const row of snap.navigationItems.filter((r) => r.parentId == null)) await tx.navigationItem.create({ data: itemData(row) });
    for (const row of snap.navigationItems.filter((r) => r.parentId != null)) await tx.navigationItem.create({ data: itemData(row) });

    await tx.footerColumn.deleteMany({});
    for (const col of snap.footerColumns) {
      await tx.footerColumn.create({
        data: {
          ...(pick(col, ["id", "order", "title"]) as { id: string; order: number; title: string }),
          translations: (col.translations ?? {}) as Prisma.InputJsonValue,
          createdAt: new Date(String(col.createdAt)),
          links: {
            create: col.links.map((l) => ({
              ...(pick(l, ["id", "order", "label", "href"]) as { id: string; order: number; label: string; href: string }),
              translations: (l.translations ?? {}) as Prisma.InputJsonValue,
            })),
          },
        },
      });
    }
    await tx.auditLog.create({
      data: {
        actorEmail: `script:${operator}`,
        action: "navigation.restore_blog_nav",
        targetType: "Navigation",
        metadata: { script: "add-blog-nav-item", backup: path.basename(file), items: snap.navigationItems.length, columns: snap.footerColumns.length },
      },
    });
  });
  console.log(`[fix] menüler yedekten geri yüklendi (${snap.navigationItems.length} header öğesi, ${snap.footerColumns.length} footer sütunu).`);
}

async function main() {
  const { confirm, operator, restore, backupDir } = parseArgs(process.argv.slice(2));
  const write = confirm === CONFIRM_TOKEN;
  if (confirm !== undefined && !write) throw new Error(`Geçersiz --confirm değeri. Beklenen: --confirm=${CONFIRM_TOKEN}`);
  if (write && !operator?.trim()) throw new Error("--operator=<ad> zorunludur (audit log için).");
  console.log(`[add-blog-nav-item] mod=${restore ? (write ? "GERİ YÜKLE" : "KURU (restore)") : write ? "YAZ" : "KURU ÇALIŞTIRMA"}`);

  if (restore) {
    const file = path.resolve(restore);
    if (!fs.existsSync(file)) throw new Error(`Yedek dosyası bulunamadı: ${file}`);
    if (!write) {
      console.log(`[kuru] ${file} yedeğinden menüler geri yüklenecekti (hiçbir şey yazılmadı).`);
      return;
    }
    await restoreSnapshot(file, operator!.trim());
    return;
  }

  const plan = await buildPlan();
  describePlan(plan);
  if (plan.header.skip && plan.footer.skip) {
    console.log("[bilgi] Yapılacak değişiklik yok.");
    return;
  }
  if (!write) {
    console.log("[kuru] hiçbir şey yazılmadı.");
    return;
  }

  const dir = path.resolve(backupDir ?? "storage/backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `nav-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(await readSnapshot(), null, 2), "utf8");
  console.log(`[yedek] ${file}`);

  const result = await applyPlan(plan);
  await prisma.auditLog.create({
    data: {
      actorEmail: `script:${operator!.trim()}`,
      action: "navigation.add_blog_nav_item",
      targetType: "Navigation",
      metadata: { script: "add-blog-nav-item", href: HREF, header: result.headerId ?? null, footer: result.footerId ?? null, backup: path.basename(file) },
    },
  });
  console.log(`[fix] eklendi: header=${result.headerId ?? "atlandı"} footer=${result.footerId ?? "atlandı"}.`);
  console.log(`[geri al] npx tsx scripts/add-blog-nav-item.ts --restore=${file} --confirm=${CONFIRM_TOKEN} --operator=<ad>`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
