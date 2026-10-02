/**
 * Tek seferlik veri operasyonu (KOD DEĞİŞİKLİĞİ DEĞİL) — 2026-10-02 görev: ayrı bir SSS (FAQ)
 * sayfası oluşturur (ana sayfaya DEĞİL). `link-telehealth-demo-doctor-user.ts`/
 * `switch-default-locale-to-en.ts` İLE AYNI desen (idempotent, Prisma client'ı doğrudan
 * kullanır, `main().catch().finally()` iskeleti, `--dry-run` desteği).
 *
 * NE YAPAR:
 *  - `slug: "faq"` ile YAYINDA (PUBLISHED) bir `Page` oluşturur. Zaten varsa (slug çakışması)
 *    `[atla]` loglar ve HİÇBİR ŞEY YAZMAZ (idempotent — tekrar tekrar çalıştırmak güvenlidir).
 *  - İçerik: önce bir `heading` bloğu (başlık), hemen altında alt metin için bir `text` bloğu
 *    (HeadingBlockDataSchema'da subtitle/alt-metin ALANI YOKTUR — bkz. `pages.schemas.ts`,
 *    `frontend/src/lib/page-builder/types.ts::HeadingBlock`; bu yüzden alt metin AYRI bir
 *    `text` bloğudur, UYDURMA bir alan İCAT EDİLMEZ), sonra bir `accordion` bloğu
 *    (`layoutStyle: "card"`, 8 soru-cevap).
 *  - Varsayılan dil (locale.isDefault) içeriği `Page.title`/`Page.blocks` kanonik kolonlarına,
 *    diğer desteklenen dil (EN/TR'den varsayılan OLMAYAN, ETKİN olan) `translations.<kod>`'a
 *    yazılır — `frontend/src/lib/home-page.ts::buildHomeTemplateCreatePayload` İLE AYNI karar
 *    (§10.5 Çoklu Dil, ARCHITECTURE.md).
 *  - `ContentSlug` satırlarını (her ETKİN dil için) `lib/localization.ts::syncContentSlugs`
 *    İLE AYNI kuralla, AYNI transaction içinde senkronize eder (route'un yazma yolu TAKLİT
 *    EDİLİR — bkz. o modülün üst açıklaması).
 *
 * NE YAPMAZ:
 *  - Header navigasyonuna "FAQ" linki EKLEMEZ — bu `scripts/add-faq-nav-link.ts`'in işidir
 *    (ayrı, kendi başına idempotent script; navigasyon `NavigationItem` AYRI bir model, bu
 *    script onunla İLGİLENMEZ).
 *  - Canlı/üretim veritabanına BAĞLANMAZ — hangi ortama karşı çalıştığı `DATABASE_URL`'den
 *    (standart Prisma davranışı) gelir; bu script SADECE statik/typecheck ile doğrulanmıştır,
 *    GERÇEK bir DB'ye karşı ÇALIŞTIRILMAMIŞTIR (bkz. görev talimatı — qa-agent ayrı turda test eder).
 *
 * JSON-LD UYUMLULUĞU (doğrulama notu, kod DEĞİL): `frontend/src/lib/page-builder/
 * structured-data.ts::buildFaqPageJsonLd` sayfadaki TÜM `accordion` bloklarının
 * `data.items[].question`/`answer` DOLU olanlarını toplar ve TEK bir `FAQPage` JSON-LD'si
 * üretir. Bu script'in ürettiği `accordion` düğümü `AccordionBlockDataSchema` (`pages.schemas.ts`)
 * İLE BİREBİR aynı şekli taşır (`items[].id/question/answer`, `allowMultipleOpen`, `layoutStyle`)
 * ve 8 öğenin TÜMÜNÜN hem `question` hem `answer`'ı doludur — bu yüzden `buildFaqPageJsonLd`
 * bu sayfadan tam 8 `Question` içeren bir `FAQPage` üretecektir (manuel doğrulama: fonksiyonun
 * filtre koşulu `item.question.trim() && item.answer.trim()` — aşağıdaki `ACCORDION_ITEMS`'ın
 * HİÇBİRİ boş değildir).
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/create-faq-page.ts --dry-run
 *   npx tsx scripts/create-faq-page.ts
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { PageBlockListSchema } from "../src/modules/pages/pages.schemas";
import { faqCopyFor as copyFor, type FaqLocaleCopy as LocaleCopy } from "../src/lib/faq-content";

const prisma = new PrismaClient();

const SLUG = "faq";

/** `pages.schemas.ts::HeadingBlockSchema`/`AccordionBlockSchema` İLE BİREBİR aynı alan adları. */
function buildBlocks(copy: LocaleCopy): Prisma.InputJsonValue {
  return [
    {
      id: "faq-heading",
      type: "heading",
      data: { text: copy.heading, level: 1, align: "left", underline: false },
    },
    // Alt metin — `HeadingBlockDataSchema`'da subtitle alanı YOK (yalnızca `text`), bu yüzden
    // uydurma bir alan eklemek yerine mevcut `text` blok tipi (serbest düz HTML) kullanılır.
    {
      id: "faq-subtitle",
      type: "text",
      data: { html: `<p>${copy.subtitle}</p>` },
    },
    {
      id: "faq-accordion",
      type: "accordion",
      data: {
        items: copy.items.map((item) => ({ id: item.id, question: item.question, answer: item.answer })),
        allowMultipleOpen: false,
        layoutStyle: "card",
      },
    },
  ] as unknown as Prisma.InputJsonValue;
}

function parseArgs(argv: string[]) {
  return { dryRun: argv.includes("--dry-run") };
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));
  console.log(`[create-faq-page] dryRun=${dryRun}`);

  const existing = await prisma.page.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (existing) {
    console.log(`[atla] slug="${SLUG}" ile bir sayfa ZATEN VAR (id=${existing.id}) — değişiklik gerekmiyor.`);
    return;
  }

  const locales = await prisma.locale.findMany({ where: { enabled: true }, orderBy: { sortOrder: "asc" } });
  if (locales.length === 0) {
    throw new Error("Etkin (enabled=true) hiçbir Locale bulunamadı — en az varsayılan dil kaydı olmalı.");
  }
  const defaultLocale = locales.find((l) => l.isDefault) ?? locales[0]!;
  console.log(`[bilgi] varsayılan dil="${defaultLocale.code}", etkin diller=[${locales.map((l) => l.code).join(", ")}]`);

  const defaultCopy = copyFor(defaultLocale.code);
  const defaultBlocks = buildBlocks(defaultCopy);

  // Güvenlik ağı: script'in ürettiği blok ağacının GERÇEKTEN `PageBlockListSchema`'dan geçtiğini
  // (API'nin kendisinin kabul edeceğini) ÇALIŞMA ANINDA kanıtlar — kod incelemesiyle YETİNİLMEZ.
  const defaultParsed = PageBlockListSchema.safeParse(defaultBlocks);
  if (!defaultParsed.success) {
    throw new Error(
      `Üretilen varsayılan dil blokları PageBlockListSchema'yı GEÇEMEDİ — script bir hata içeriyor: ${JSON.stringify(
        defaultParsed.error.issues
      )}`
    );
  }

  const translations: Record<string, { title: string; seoTitle: string; seoDescription: string; blocks: Prisma.InputJsonValue }> = {};
  for (const code of ["en", "tr"]) {
    if (code === defaultLocale.code) continue;
    if (!locales.some((l) => l.code === code)) continue;
    const copy = copyFor(code);
    const blocks = buildBlocks(copy);
    const parsed = PageBlockListSchema.safeParse(blocks);
    if (!parsed.success) {
      throw new Error(`Üretilen "${code}" çevirisi blokları PageBlockListSchema'yı GEÇEMEDİ: ${JSON.stringify(parsed.error.issues)}`);
    }
    translations[code] = { title: copy.heading, seoTitle: copy.heading, seoDescription: copy.subtitle, blocks };
  }

  if (dryRun) {
    console.log(
      `[dry-run] slug="${SLUG}" başlık="${defaultCopy.heading}" (dil="${defaultLocale.code}") PUBLISHED olarak oluşturulacaktı, ` +
        `çeviriler=[${Object.keys(translations).join(", ") || "(yok)"}] (hiçbir şey YAZILMADI).`
    );
    return;
  }

  const page = await prisma.$transaction(async (tx) => {
    const created = await tx.page.create({
      data: {
        title: defaultCopy.heading,
        slug: SLUG,
        status: "PUBLISHED",
        blocks: defaultBlocks,
        seoTitle: defaultCopy.heading,
        seoDescription: defaultCopy.subtitle,
        translations: translations as unknown as Prisma.InputJsonValue,
        publishedAt: new Date(),
      },
      select: { id: true, slug: true, translations: true },
    });

    // `lib/localization.ts::syncContentSlugs` İLE AYNI kural, AYNI transaction (route'un yazma
    // yolunu TAKLİT EDER) — ayrı bir modül fonksiyonu olarak İÇE AKTARMAK yerine burada birebir
    // uygulanır (diğer `scripts/*.ts` dosyalarının kendi kendine yeten deseniyle TUTARLI).
    for (const locale of locales) {
      if (locale.code === defaultLocale.code) {
        await tx.contentSlug.upsert({
          where: { entityType_entityId_locale: { entityType: "PAGE", entityId: created.id, locale: locale.code } },
          create: { entityType: "PAGE", entityId: created.id, locale: locale.code, slug: SLUG },
          update: { slug: SLUG },
        });
        continue;
      }
      if (translations[locale.code]) {
        await tx.contentSlug.upsert({
          where: { entityType_entityId_locale: { entityType: "PAGE", entityId: created.id, locale: locale.code } },
          create: { entityType: "PAGE", entityId: created.id, locale: locale.code, slug: SLUG },
          update: { slug: SLUG },
        });
      }
    }

    return created;
  });

  console.log(`[fix] slug="${SLUG}" (id=${page.id}) oluşturuldu — diller: [${locales.map((l) => l.code).join(", ")}].`);
  console.log(
    "[json-ld] buildFaqPageJsonLd bu sayfadaki `accordion` bloğundan 8 dolu (question+answer) öğe toplayıp TEK bir " +
      "FAQPage JSON-LD'si üretecektir (yapısal doğrulama script başında PageBlockListSchema ile ZATEN yapıldı)."
  );
  console.log(
    "[sonraki adım] Header navigasyonuna \"FAQ\" linkini eklemek için `scripts/add-faq-nav-link.ts` çalıştırılabilir " +
      "(bu script navigasyona DOKUNMAZ)."
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
