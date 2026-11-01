/**
 * Paket Z1 — blog güven sayfaları: "Content standards" (slug: content-standards) ve
 * "Authors & medical reviewers" (slug: medical-reviewers). CMS `Page` kaydı olarak TASLAK (DRAFT) oluşturulur.
 *
 * ÖNEMLİ: Metinler EN TASLAKTIR — yayına almadan önce hukuk/editör kontrolünden geçmelidir. Sağlık iddiası,
 * garanti, fiyat veya başarı oranı içermez. Hekim adı sabitlenmez (yazı sayfasında yazıya özgü gösterilir).
 *
 * Güvenlik:
 *  - Varsayılan KURU ÇALIŞTIRMA (hiçbir şey yazılmaz).
 *  - Yazmak için: --confirm=create-blog-trust-pages --operator=<ad>
 *  - Idempotent: slug zaten varsa atlanır (mevcut sayfa ASLA değiştirilmez). Oluşturulan sayfa DRAFT'tır.
 *  - İşlem audit log'a yazılır (operatör adıyla).
 *
 * Çalıştırma (backend/ dizininden):
 *   npx tsx scripts/create-blog-trust-pages.ts
 *   npx tsx scripts/create-blog-trust-pages.ts --confirm=create-blog-trust-pages --operator=ridvan
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { PageBlockListSchema } from "../src/modules/pages/pages.schemas";

const prisma = new PrismaClient();

const CONFIRM_TOKEN = "create-blog-trust-pages";

interface TrustPageDraft {
  slug: string;
  title: string;
  seoDescription: string;
  /** [başlık, HTML gövde] bölümleri. */
  sections: [string, string][];
}

const TRUST_PAGES: TrustPageDraft[] = [
  {
    slug: "content-standards",
    title: "Content standards",
    seoDescription: "How WM Health prepares, reviews and updates its patient guides.",
    sections: [
      [
        "Why we publish patient guides",
        "<p>Our guides help you understand a health topic before you speak with a physician. They offer general information in plain language. They do not replace a medical consultation.</p>",
      ],
      [
        "How our guides are written",
        "<p>Each guide is prepared by the WM Health Editorial Team. We aim for clear, calm and practical language, and we avoid alarming wording. We do not publish prices, success rates or guarantees in these guides.</p>",
      ],
      [
        "Medical review",
        "<p>Before a medical guide is published, a physician from our network reviews it. The reviewing physician is shown on the article together with the date of the last review. If the content of an article changes after a review, it is sent for review again.</p>",
      ],
      [
        "Sources",
        "<p>Medical statements are based on recognised public health and clinical sources, such as international health organisations, national health services and professional societies. Each guide lists its references with the date we last accessed them.</p>",
      ],
      [
        "Updates and corrections",
        "<p>We review our guides regularly. If you notice an error or an out-of-date statement, please contact us and we will check it.</p>",
      ],
      [
        "What our guides are not",
        "<p>Our guides are for general information. They are not a diagnosis, a treatment plan or a substitute for a medical consultation. If you have urgent symptoms, contact your local emergency services.</p>",
      ],
    ],
  },
  {
    slug: "medical-reviewers",
    title: "Authors & medical reviewers",
    seoDescription: "Who writes and who medically reviews the WM Health patient guides.",
    sections: [
      [
        "Authors",
        "<p>Our guides are written by the WM Health Editorial Team. The team prepares the text, checks the sources and keeps the guides up to date.</p>",
      ],
      [
        "Medical reviewers",
        "<p>Each medical guide is reviewed by a physician from our network whose specialty matches the topic. The reviewing physician is named on the article, with a link to their profile and the date of the last review.</p>",
      ],
      [
        "What a review covers",
        "<p>The reviewing physician checks that the information is accurate, clearly explained and consistent with current professional guidance. A review does not turn a guide into personal medical advice.</p>",
      ],
      [
        "Independence",
        "<p>Reviewers do not receive any payment per article view. Guides do not recommend a specific physician or clinic. [Editor to confirm this statement before publication.]</p>",
      ],
      [
        "Contact",
        "<p>If you have a question about an article or about our review process, please get in touch through the contact page.</p>",
      ],
    ],
  },
];

function buildBlocks(page: TrustPageDraft): Prisma.InputJsonValue {
  const blocks: unknown[] = [{ id: `${page.slug}-h1`, type: "heading", data: { text: page.title, level: 1, align: "left", underline: false } }];
  page.sections.forEach(([heading, html], i) => {
    blocks.push({ id: `${page.slug}-h-${i}`, type: "heading", data: { text: heading, level: 2, align: "left", underline: false } });
    blocks.push({ id: `${page.slug}-t-${i}`, type: "text", data: { html } });
  });
  return blocks as Prisma.InputJsonValue;
}

function parseArgs(argv: string[]) {
  const value = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  return { confirm: value("confirm"), operator: value("operator") };
}

async function main() {
  const { confirm, operator } = parseArgs(process.argv.slice(2));
  const write = confirm === CONFIRM_TOKEN;
  if (confirm !== undefined && !write) throw new Error(`Geçersiz --confirm değeri. Beklenen: --confirm=${CONFIRM_TOKEN}`);
  if (write && !operator?.trim()) throw new Error("--operator=<ad> zorunludur (audit log için).");
  console.log(`[create-blog-trust-pages] mod=${write ? "YAZ" : "KURU ÇALIŞTIRMA"}`);

  const locales = await prisma.locale.findMany({ where: { enabled: true }, orderBy: { sortOrder: "asc" } });
  if (locales.length === 0) throw new Error("Etkin (enabled=true) hiçbir Locale bulunamadı.");
  const defaultLocale = locales.find((l) => l.isDefault) ?? locales[0]!;
  const enIsDefault = defaultLocale.code === "en";
  console.log(`[bilgi] varsayılan dil="${defaultLocale.code}" — EN taslak ${enIsDefault ? "kanonik kolonlara" : "translations.en alanına"} yazılır.`);

  for (const page of TRUST_PAGES) {
    const blocks = buildBlocks(page);
    const parsed = PageBlockListSchema.safeParse(blocks);
    if (!parsed.success) throw new Error(`"${page.slug}" blokları PageBlockListSchema'yı GEÇEMEDİ: ${JSON.stringify(parsed.error.issues)}`);

    const existing = await prisma.page.findUnique({ where: { slug: page.slug }, select: { id: true, status: true } });
    if (existing) {
      console.log(`[atla] slug="${page.slug}" zaten var (id=${existing.id}, durum=${existing.status}) — dokunulmadı.`);
      continue;
    }
    if (!write) {
      console.log(`[kuru] slug="${page.slug}" "${page.title}" DRAFT olarak oluşturulacaktı (hiçbir şey yazılmadı).`);
      continue;
    }

    const translations = enIsDefault ? {} : { en: { title: page.title, seoTitle: page.title, seoDescription: page.seoDescription, blocks } };
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.page.create({
        data: {
          title: page.title,
          slug: page.slug,
          status: "DRAFT",
          blocks: enIsDefault ? blocks : ([] as Prisma.InputJsonValue),
          seoTitle: page.title,
          seoDescription: page.seoDescription,
          translations: translations as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      // Varsayılan dil + (varsayılan değilse) EN çevirisi için ContentSlug (lib/localization.ts::syncContentSlugs ile aynı kural).
      const slugLocales = new Set<string>([defaultLocale.code]);
      if (!enIsDefault && locales.some((l) => l.code === "en")) slugLocales.add("en");
      for (const code of slugLocales) {
        await tx.contentSlug.upsert({
          where: { entityType_entityId_locale: { entityType: "PAGE", entityId: row.id, locale: code } },
          create: { entityType: "PAGE", entityId: row.id, locale: code, slug: page.slug },
          update: { slug: page.slug },
        });
      }
      await tx.auditLog.create({
        data: {
          actorEmail: `script:${operator!.trim()}`,
          action: "page.create_blog_trust_page",
          targetType: "Page",
          targetId: row.id,
          metadata: { slug: page.slug, status: "DRAFT", script: "create-blog-trust-pages" },
        },
      });
      return row;
    });
    console.log(`[fix] slug="${page.slug}" DRAFT olarak oluşturuldu (id=${created.id}). Yayına almadan önce hukuk/editör kontrolü gerekir.`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
