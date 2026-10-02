/**
 * Tek seferlik veri operasyonu (KOD DEĞİŞİKLİĞİ DEĞİL) — 2026-10-02 görev: header navigasyonuna
 * kök seviyede bir "FAQ" linki (`href: "/faq"`) ekler. `create-faq-page.ts` İLE AYNI desen
 * (idempotent, Prisma client'ı doğrudan kullanır, `main().catch().finally()` iskeleti,
 * `--dry-run` desteği) — BİLİNÇLİ olarak AYRI bir script (navigasyon `NavigationItem` sayfa
 * içeriğinden BAĞIMSIZ bir modeldir, `create-faq-page.ts` ondan HABERSİZ kalmalı).
 *
 * NEDEN DOĞRUDAN PRISMA (API değil): `PUT /admin/navigation` TAM-DEĞİŞTİRME (full-replace)
 * çalışır (bkz. `src/modules/navigation/navigation.routes.ts` — `deleteMany({})` + `createMany`).
 * Bu script o ucu ÇAĞIRMAZ; doğrudan DB'ye TEK bir satır ekler — mevcut (admin panelden girilmiş)
 * hiçbir öğeyi SİLMEZ/DEĞİŞTİRMEZ. (Not: bir admin daha SONRA panelden `PUT` ile tam-değiştirme
 * yaparsa VE gönderdiği listede bu öğe YOKSA, o zaman kaybolur — ama bu her navigasyon öğesi için
 * geçerli MEVCUT davranıştır, bu script'in getirdiği yeni bir risk DEĞİLDİR.)
 *
 * İDEMPOTENT KONTROL: kök seviyede (`parentId: null`) `href: "/faq"` OLAN bir öğe zaten varsa
 * `[atla]` loglar. Sıra (`order`) KARDEŞ-KAPSAMLIDIR (bkz. schema.prisma yorumu) — yeni öğe
 * MEVCUT kök öğelerin EN SONUNA eklenir (`max(order) + 1`, hiç kök öğe yoksa `0`).
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/add-faq-nav-link.ts --dry-run
 *   npx tsx scripts/add-faq-nav-link.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const HREF = "/faq";
const LABEL = "FAQ";

function parseArgs(argv: string[]) {
  return { dryRun: argv.includes("--dry-run") };
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));
  console.log(`[add-faq-nav-link] dryRun=${dryRun}`);

  const existing = await prisma.navigationItem.findFirst({ where: { parentId: null, href: HREF } });
  if (existing) {
    console.log(`[atla] kök seviyede href="${HREF}" OLAN bir navigasyon öğesi ZATEN VAR (id=${existing.id}, label="${existing.label}") — değişiklik gerekmiyor.`);
    return;
  }

  const lastRoot = await prisma.navigationItem.findFirst({
    where: { parentId: null },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const nextOrder = (lastRoot?.order ?? -1) + 1;

  if (dryRun) {
    console.log(`[dry-run] kök seviyede label="${LABEL}" href="${HREF}" order=${nextOrder} eklenecekti (hiçbir şey YAZILMADI).`);
    return;
  }

  const created = await prisma.navigationItem.create({
    data: { label: LABEL, href: HREF, order: nextOrder, parentId: null },
  });

  console.log(`[fix] navigasyon öğesi eklendi: id=${created.id} label="${LABEL}" href="${HREF}" order=${nextOrder}.`);
  console.log(
    "[not] Bu değişiklik `revalidate`/CDN önbelleğini KENDİLİĞİNDEN TETİKLEMEZ (PUT /admin/navigation'ın aksine, " +
      "bkz. navigation.routes.ts::triggerTagRevalidation) — site hemen YANSIMAYABİLİR; gerekirse admin panelden " +
      "navigasyonu AÇIP-KAYDETMEDEN (tam-değiştirmeden) `CACHE_TAGS.navigation` etiketini manuel yenileyin ya da " +
      "birkaç dakika içinde doğal ISR süresinin dolmasını bekleyin."
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
