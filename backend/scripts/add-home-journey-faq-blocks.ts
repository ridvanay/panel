/**
 * Tek seferlik veri operasyonu (KOD DEĞİŞİKLİĞİ DEĞİL) — 2026-10-03 görev (journey-faq-blok):
 * canlı ana sayfa `home-page` şablonunu KULLANMIYOR, page-builder bloklarından oluşuyor — bu
 * yüzden `journey` bölümü (önceki tur, yalnızca `home-page` şablonu içinde) canlıda hiç
 * görünmüyordu. Bu script, ana sayfanın GERÇEK blok listesine `journey-map` ve/veya SSS
 * (`accordion`, `layoutStyle: "spotlight"`) bloklarını EKLER — `create-faq-page.ts`/
 * `add-faq-nav-link.ts` İLE AYNI desen (idempotent, Prisma client'ı doğrudan kullanır,
 * `main().catch().finally()` iskeleti, `--dry-run` desteği).
 *
 * NE YAPAR:
 *  - `SiteSettings.homePageId` üzerinden GERÇEK ana sayfa `Page` kaydını bulur.
 *  - `--list`: varsayılan dilin VE `translations.tr`'nin blok listesini (sıra/`type`/`id`/ilk
 *    ~40 karakter metin) yazdırır — kullanıcı `--journey-after=`/`--faq-before=` için doğru
 *    sırayı buradan okur.
 *  - `--journey-after=<sıra>`: `journey-map` bloğunu o sıradaki bloğun HEMEN ARKASINA ekler.
 *  - `--faq-before=<sıra>`: SSS akordiyonunu (`layoutStyle: "spotlight"`, `badge:"FAQ"`,
 *    `intro`, `defaultOpenFirst:false` (kullanıcı isteği: hepsi kapalı), 8 soru — metinler `lib/faq-content.ts`'TEN, create-faq-
 *    page.ts İLE PAYLAŞIMLI, TEKRAR YAZILMAZ) o sıradaki bloğun HEMEN ÖNÜNE ekler.
 *  - Varsayılan dil EN içerikle, `translations.tr` (VARSA) TR içerikle AYNI anda güncellenir.
 *    `translations.tr.blocks` YOKSA o dile DOKUNULMAZ, konsola NET bir uyarı yazılır (sessizce
 *    atlanmaz).
 *  - İdempotent: ilgili blok (kendi SABİT `id`'siyle: `journey-map-block` / `home-faq-accordion`)
 *    ZATEN varsa `[atla]` der, İKİNCİ KEZ eklemez — jenerik `type` eşleşmesi DEĞİL, bu script'in
 *    KENDİ ürettiği id eşleşmesi kontrol edilir (sayfada başka bir amaçla konmuş bağımsız bir
 *    `accordion` bloğu varsa YANLIŞLIKLA "zaten eklenmiş" sayılmasın diye).
 *  - Yazmadan ÖNCE mevcut (eski) blok listesini tam JSON olarak `stdout`'a basar — elle geri
 *    almak gerekirse bu çıktı kaynak olarak kullanılabilir.
 *  - Kayıttan önce `PageBlockListSchema` ile doğrular (`create-faq-page.ts` İLE AYNI güvenlik ağı).
 *  - `--remove-faq-nav`: kök seviyede `href:"/faq"` olan navigasyon öğesini SİLER (`add-faq-nav-
 *    link.ts`'in TERSİ, idempotent — yoksa `[atla]`). `--unpublish-faq-page`: `slug:"faq"`
 *    sayfasını `DRAFT` yapar (idempotent — zaten DRAFT'sa/yoksa `[atla]`). İkisi de OPSİYONEL,
 *    `--dry-run` ile birlikte çalışır, diğer bayraklardan BAĞIMSIZ (aynı çalıştırmada birlikte
 *    de kullanılabilir).
 *
 * NE YAPMAZ:
 *  - Canlı/üretim veritabanına BAĞLANMAZ (standart Prisma `DATABASE_URL` davranışı).
 *  - `src/` içinden import ettiği için (PageBlockListSchema, faq-content) CANLIDA çalıştırılmadan
 *    önce konteynere KAYNAK KODUN kopyalanmış olması gerekir — bkz. dosya sonu ÇALIŞTIRMA notu.
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/add-home-journey-faq-blocks.ts --list
 *   npx tsx scripts/add-home-journey-faq-blocks.ts --journey-after=2 --dry-run
 *   npx tsx scripts/add-home-journey-faq-blocks.ts --journey-after=2
 *   npx tsx scripts/add-home-journey-faq-blocks.ts --faq-before=5 --dry-run
 *   npx tsx scripts/add-home-journey-faq-blocks.ts --faq-before=5
 *   npx tsx scripts/add-home-journey-faq-blocks.ts --remove-faq-nav --unpublish-faq-page --dry-run
 *
 * CANLIYA ALMA (bu script yalnızca `src/`'ten import ettiği için — `create-faq-page.ts`'ten
 * FARKLI olarak `pages.schemas`/`faq-content` içe aktarır, `backend/scripts/` imaja kopyalanıyor
 * olsa bile `src/` değişmemişse SORUN YOK, ama her ihtimale karşı):
 *   docker compose cp backend/src/. backend:/app/src/
 *   docker compose cp backend/scripts/. backend:/app/scripts/
 *   docker compose exec -T backend npx -y tsx@4.23.1 scripts/add-home-journey-faq-blocks.ts --list
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { PageBlockListSchema } from "../src/modules/pages/pages.schemas";
import { faqCopyFor } from "../src/lib/faq-content";

const prisma = new PrismaClient();

const SETTINGS_ID = "singleton";
const JOURNEY_BLOCK_ID = "journey-map-block";
const FAQ_BLOCK_ID = "home-faq-accordion";
const FAQ_NAV_HREF = "/faq";
const FAQ_PAGE_SLUG = "faq";

interface JourneyCopy {
  eyebrow: string;
  title: string;
  body: string;
  steps: { id: string; icon: string; title: string; text: string }[];
  countries: { id: string; label: string }[];
}

/** `docs/prompts/2026-10-02-wm-health-icerik-guncellemesi.md` §"1) Ana sayfa" — EN metinler
 *  BİREBİR; TR çevirisi `frontend/src/lib/i18n/site-dictionaries/tr/home.ts`'teki (önceki tur,
 *  home-page şablonu için) AYNI metinlerle — iki yerde FARKLI bir Türkçe kopya OLUŞMASIN diye. */
const JOURNEY_EN: JourneyCopy = {
  eyebrow: "Global patient journey",
  title: "From Across the World to Istanbul",
  body: "WM Health coordinates each stage of your journey to Istanbul, with treatment planning guided by your medical needs.",
  steps: [
    {
      id: "journey-step-1",
      icon: "Plane",
      title: "Pre-Travel Planning",
      text: "Share your medical history and treatment goals so we can prepare a plan tailored to you before you travel.",
    },
    {
      id: "journey-step-2",
      icon: "MapPin",
      title: "Arrival in Istanbul",
      text: "Our team welcomes you, arranges your accommodation, and confirms your appointment schedule.",
    },
    {
      id: "journey-step-3",
      icon: "Stethoscope",
      title: "Examination and Treatment",
      text: "The physician responsible for your care completes the necessary examinations and carries out your treatment plan.",
    },
    {
      id: "journey-step-4",
      icon: "BadgeCheck",
      title: "Follow-Up After Your Return",
      text: "We continue to support your recovery and answer your questions once you are back home.",
    },
  ],
  countries: [
    { id: "journey-country-1", label: "United Kingdom" },
    { id: "journey-country-2", label: "Germany" },
    { id: "journey-country-3", label: "Russia" },
    { id: "journey-country-4", label: "Kazakhstan" },
    { id: "journey-country-5", label: "Saudi Arabia" },
    { id: "journey-country-6", label: "United States" },
  ],
};

const JOURNEY_TR: JourneyCopy = {
  eyebrow: "Küresel hasta yolculuğu",
  title: "Dünyanın Dört Bir Yanından İstanbul'a",
  body: "WM Health, İstanbul'a yolculuğunuzun her aşamasını sağlık durumunuza uygun bir tedavi planlamasıyla koordine eder.",
  steps: [
    {
      id: "journey-step-1",
      icon: "Plane",
      title: "Seyahat Öncesi Planlama",
      text: "Tıbbi geçmişinizi ve tedavi hedeflerinizi bizimle paylaşın; yola çıkmadan önce size özel bir plan hazırlayalım.",
    },
    {
      id: "journey-step-2",
      icon: "MapPin",
      title: "İstanbul'a Varış",
      text: "Ekibimiz sizi karşılar, konaklamanızı düzenler ve randevu programınızı teyit eder.",
    },
    {
      id: "journey-step-3",
      icon: "Stethoscope",
      title: "Muayene ve Tedavi",
      text: "Tedavinizden sorumlu hekim gerekli muayeneleri tamamlar ve tedavi planınızı uygular.",
    },
    {
      id: "journey-step-4",
      icon: "BadgeCheck",
      title: "Dönüşünüzden Sonra Takip",
      text: "Siz ülkenize döndükten sonra da iyileşme sürecinizi destekler, sorularınızı yanıtlarız.",
    },
  ],
  countries: [
    { id: "journey-country-1", label: "Birleşik Krallık" },
    { id: "journey-country-2", label: "Almanya" },
    { id: "journey-country-3", label: "Rusya" },
    { id: "journey-country-4", label: "Kazakistan" },
    { id: "journey-country-5", label: "Suudi Arabistan" },
    { id: "journey-country-6", label: "Amerika Birleşik Devletleri" },
  ],
};

function journeyFor(code: string): JourneyCopy {
  return code === "tr" ? JOURNEY_TR : JOURNEY_EN;
}

function buildJourneyBlock(code: string): Prisma.InputJsonValue {
  const j = journeyFor(code);
  return {
    id: JOURNEY_BLOCK_ID,
    type: "journey-map",
    data: { eyebrow: j.eyebrow, title: j.title, body: j.body, steps: j.steps, countries: j.countries },
  } as unknown as Prisma.InputJsonValue;
}

/** `pages.schemas.ts::AccordionBlockDataSchema` İLE BİREBİR aynı alan adları (`badge`/`intro`/
 *  `defaultOpenFirst` — journey-faq-blok turunun YENİ, opsiyonel alanları). */
function buildFaqBlock(code: string): Prisma.InputJsonValue {
  const copy = faqCopyFor(code);
  return {
    id: FAQ_BLOCK_ID,
    type: "accordion",
    data: {
      items: copy.items.map((item) => ({ id: item.id, question: item.question, answer: item.answer })),
      allowMultipleOpen: false,
      layoutStyle: "spotlight",
      badge: "FAQ",
      intro: copy.subtitle,
      defaultOpenFirst: false,
    },
  } as unknown as Prisma.InputJsonValue;
}

interface Args {
  list: boolean;
  journeyAfter?: number;
  faqBefore?: number;
  dryRun: boolean;
  removeFaqNav: boolean;
  unpublishFaqPage: boolean;
}

function parseArgs(argv: string[]): Args {
  const journeyArg = argv.find((a) => a.startsWith("--journey-after="));
  const faqArg = argv.find((a) => a.startsWith("--faq-before="));
  return {
    list: argv.includes("--list"),
    journeyAfter: journeyArg ? Number(journeyArg.slice("--journey-after=".length)) : undefined,
    faqBefore: faqArg ? Number(faqArg.slice("--faq-before=".length)) : undefined,
    dryRun: argv.includes("--dry-run"),
    removeFaqNav: argv.includes("--remove-faq-nav"),
    unpublishFaqPage: argv.includes("--unpublish-faq-page"),
  };
}

type BlockNode = { id: string; type: string; data?: Record<string, unknown> };

function snippetOf(node: BlockNode): string {
  const data = node.data ?? {};
  const text = (data.text ?? data.title ?? data.heading ?? data.eyebrow ?? data.html ?? "") as unknown;
  const str = typeof text === "string" ? text.replace(/<[^>]+>/g, "") : "";
  return str.length > 40 ? `${str.slice(0, 40)}…` : str;
}

function printBlockList(label: string, blocks: BlockNode[]) {
  console.log(label);
  if (blocks.length === 0) {
    console.log("  (boş)");
    return;
  }
  blocks.forEach((b, i) => console.log(`  [${i}] type=${b.type} id=${b.id}${snippetOf(b) ? ` "${snippetOf(b)}"` : ""}`));
}

function hasBlockId(blocks: BlockNode[], id: string): boolean {
  return blocks.some((b) => b.id === id);
}

function insertAt<T>(list: T[], index: number, item: T): T[] {
  const next = [...list];
  next.splice(index, 0, item);
  return next;
}

/**
 * `localeCode`'a göre journey/FAQ bloklarını `blocks`'a ekler. Dönen `changed=false` ise
 * (idempotent atlama VEYA geçersiz sıra) çağıran taraf bu dil için HİÇBİR ŞEY yazmaz.
 */
function applyInsertions(
  blocks: BlockNode[],
  localeCode: string,
  args: Args
): { next: BlockNode[]; changed: boolean; logs: string[] } {
  let next = [...blocks];
  let changed = false;
  const logs: string[] = [];

  if (args.journeyAfter !== undefined) {
    if (hasBlockId(next, JOURNEY_BLOCK_ID)) {
      logs.push(`[atla] (${localeCode}) journey-map bloğu (id=${JOURNEY_BLOCK_ID}) zaten var.`);
    } else if (args.journeyAfter < 0 || args.journeyAfter >= next.length) {
      logs.push(`[hata] (${localeCode}) --journey-after=${args.journeyAfter} geçersiz (0..${next.length - 1} aralığında olmalı) — bu dil için EKLENMEDİ.`);
    } else {
      next = insertAt(next, args.journeyAfter + 1, buildJourneyBlock(localeCode) as unknown as BlockNode);
      logs.push(`[fix] (${localeCode}) journey-map bloğu [${args.journeyAfter}] sıradaki bloğun arkasına eklendi.`);
      changed = true;
    }
  }

  if (args.faqBefore !== undefined) {
    if (hasBlockId(next, FAQ_BLOCK_ID)) {
      logs.push(`[atla] (${localeCode}) SSS akordiyonu (id=${FAQ_BLOCK_ID}) zaten var.`);
    } else {
      // journey-map az önce EKLENDİYSE indeksler kaymış olabilir — `faqBefore` KULLANICININ
      // `--list` çıktısından okuduğu ORİJİNAL sıraya göredir, bu yüzden journey eklemeden
      // ÖNCEKİ uzunluk/konumla karşılaştırılır (orijinal `blocks` uzunluğu baz alınır).
      if (args.faqBefore < 0 || args.faqBefore > blocks.length) {
        logs.push(`[hata] (${localeCode}) --faq-before=${args.faqBefore} geçersiz (0..${blocks.length} aralığında olmalı) — bu dil için EKLENMEDİ.`);
      } else {
        // Journey eklemesi varsa ve hedef konum ondan SONRAYSA, +1 kayma uygulanır.
        const shift = args.journeyAfter !== undefined && !hasBlockId(blocks, JOURNEY_BLOCK_ID) && args.faqBefore > args.journeyAfter ? 1 : 0;
        const insertIndex = args.faqBefore + shift;
        next = insertAt(next, insertIndex, buildFaqBlock(localeCode) as unknown as BlockNode);
        logs.push(`[fix] (${localeCode}) SSS akordiyonu, orijinal [${args.faqBefore}] sıradaki bloğun önüne eklendi.`);
        changed = true;
      }
    }
  }

  return { next, changed, logs };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[add-home-journey-faq-blocks] args=${JSON.stringify(args)}`);

  if (args.removeFaqNav) {
    const existing = await prisma.navigationItem.findFirst({ where: { parentId: null, href: FAQ_NAV_HREF } });
    if (!existing) {
      console.log(`[atla] kök seviyede href="${FAQ_NAV_HREF}" olan bir navigasyon öğesi yok.`);
    } else if (args.dryRun) {
      console.log(`[dry-run] navigasyon öğesi silinecekti: id=${existing.id} label="${existing.label}" (hiçbir şey YAZILMADI).`);
    } else {
      await prisma.navigationItem.delete({ where: { id: existing.id } });
      console.log(`[fix] navigasyon öğesi silindi: id=${existing.id} label="${existing.label}".`);
    }
  }

  if (args.unpublishFaqPage) {
    const page = await prisma.page.findUnique({ where: { slug: FAQ_PAGE_SLUG }, select: { id: true, status: true } });
    if (!page) {
      console.log(`[atla] slug="${FAQ_PAGE_SLUG}" ile bir sayfa yok.`);
    } else if (page.status === "DRAFT") {
      console.log(`[atla] slug="${FAQ_PAGE_SLUG}" (id=${page.id}) zaten DRAFT.`);
    } else if (args.dryRun) {
      console.log(`[dry-run] slug="${FAQ_PAGE_SLUG}" (id=${page.id}) DRAFT yapılacaktı (hiçbir şey YAZILMADI).`);
    } else {
      await prisma.page.update({ where: { id: page.id }, data: { status: "DRAFT" } });
      console.log(`[fix] slug="${FAQ_PAGE_SLUG}" (id=${page.id}) DRAFT yapıldı.`);
    }
  }

  if (args.list) {
    const page = await getHomePage();
    const defaultBlocks = ((page.blocks as unknown as BlockNode[]) ?? []) as BlockNode[];
    printBlockList(`Varsayılan dil blokları (Page id=${page.id}, slug="${page.slug}"):`, defaultBlocks);
    const translations = (page.translations as unknown as Record<string, { blocks?: BlockNode[] }>) ?? {};
    if (translations.tr?.blocks) {
      printBlockList("TR çevirisi blokları (translations.tr.blocks):", translations.tr.blocks);
    } else {
      console.log("[bilgi] translations.tr.blocks YOK — TR çevirisi bu blok listesine sahip değil.");
    }
    return;
  }

  if (args.journeyAfter === undefined && args.faqBefore === undefined) {
    if (!args.removeFaqNav && !args.unpublishFaqPage) {
      console.log("[bilgi] Hiçbir eylem belirtilmedi — --list, --journey-after=N, --faq-before=N, --remove-faq-nav veya --unpublish-faq-page kullanın.");
    }
    return;
  }

  const page = await getHomePage();
  const defaultBlocks = ((page.blocks as unknown as BlockNode[]) ?? []) as BlockNode[];
  const translations = (page.translations as unknown as Record<string, { title?: string; seoTitle?: string; seoDescription?: string; blocks?: BlockNode[] }>) ?? {};

  console.log("[eski-liste-json] Page.blocks (geri alma için):");
  console.log(JSON.stringify(defaultBlocks));
  if (translations.tr?.blocks) {
    console.log("[eski-liste-json] translations.tr.blocks (geri alma için):");
    console.log(JSON.stringify(translations.tr.blocks));
  }

  const defaultResult = applyInsertions(defaultBlocks, "en", args);
  defaultResult.logs.forEach((l) => console.log(l));

  let trResult: ReturnType<typeof applyInsertions> | null = null;
  if (translations.tr?.blocks) {
    trResult = applyInsertions(translations.tr.blocks, "tr", args);
    trResult.logs.forEach((l) => console.log(l));
  } else {
    console.log("[bilgi] translations.tr.blocks YOK — TR çevirisine DOKUNULMADI.");
  }

  if (!defaultResult.changed && !trResult?.changed) {
    console.log("[bilgi] Uygulanacak bir değişiklik kalmadı (hepsi idempotent olarak atlandı).");
    return;
  }

  // Güvenlik ağı — `create-faq-page.ts` İLE AYNI: üretilen blok ağacının GERÇEKTEN
  // `PageBlockListSchema`'dan geçtiğini ÇALIŞMA ANINDA kanıtlar.
  const parsedDefault = PageBlockListSchema.safeParse(defaultResult.next);
  if (!parsedDefault.success) {
    throw new Error(`Üretilen varsayılan dil blokları PageBlockListSchema'yı GEÇEMEDİ: ${JSON.stringify(parsedDefault.error.issues)}`);
  }
  if (trResult) {
    const parsedTr = PageBlockListSchema.safeParse(trResult.next);
    if (!parsedTr.success) {
      throw new Error(`Üretilen TR çevirisi blokları PageBlockListSchema'yı GEÇEMEDİ: ${JSON.stringify(parsedTr.error.issues)}`);
    }
  }

  if (args.dryRun) {
    console.log("[dry-run] önce → sonra (varsayılan dil):");
    console.log(`  önce:  ${defaultBlocks.map((b) => b.type).join(" | ")}`);
    console.log(`  sonra: ${defaultResult.next.map((b) => b.type).join(" | ")}`);
    if (trResult) {
      console.log("[dry-run] önce → sonra (tr):");
      console.log(`  önce:  ${translations.tr!.blocks!.map((b) => b.type).join(" | ")}`);
      console.log(`  sonra: ${trResult.next.map((b) => b.type).join(" | ")}`);
    }
    console.log("[dry-run] hiçbir şey YAZILMADI.");
    return;
  }

  const nextTranslations = trResult
    ? { ...translations, tr: { ...translations.tr, blocks: trResult.next as unknown as Prisma.InputJsonValue } }
    : translations;

  await prisma.page.update({
    where: { id: page.id },
    data: {
      blocks: defaultResult.next as unknown as Prisma.InputJsonValue,
      translations: nextTranslations as unknown as Prisma.InputJsonValue,
    },
  });

  console.log(`[fix] Page id=${page.id} (slug="${page.slug}") güncellendi.`);
  console.log(
    "[not] Bu değişiklik ISR önbelleğini KENDİLİĞİNDEN tetiklemeyebilir — birkaç dakika içinde doğal yenilenmeyi " +
      "bekleyin ya da hedefli bir revalidate çağrısı yapın (bkz. rapor dosyasındaki canlıya alma adımları)."
  );
}

async function getHomePage() {
  const settings = await prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (!settings?.homePageId) {
    throw new Error("SiteSettings.homePageId tanımsız — admin panelden bir sayfa 'Anasayfa' olarak ayarlanmamış.");
  }
  const page = await prisma.page.findUnique({ where: { id: settings.homePageId } });
  if (!page) {
    throw new Error(`SiteSettings.homePageId="${settings.homePageId}" ile eşleşen bir Page bulunamadı.`);
  }
  return page;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
