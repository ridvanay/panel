import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import { resetDatabase } from "../helpers/reset-db";

/**
 * `docs/prompts/2026-10-03-journey-faq-blok.md` madde 3/4 — `add-home-journey-faq-blocks.ts`
 * için script-smoke-test. `update-vahit-mutlu-profile-script.test.ts` İLE AYNI desen: script
 * KENDİ `PrismaClient`'ını açtığı ve modül importunda `main()`'i HEMEN çalıştırdığı için AYRI
 * bir alt process'te (`tsx` ile) çalıştırılır, test yalnızca exit code + stdout + DB'deki
 * SONUCU doğrular.
 */

const SCRIPT_PATH = path.resolve(__dirname, "../../scripts/add-home-journey-faq-blocks.ts");
const TSX_CLI = path.resolve(__dirname, "../../node_modules/tsx/dist/cli.mjs");
const SETTINGS_ID = "singleton";

function runScript(args: string[] = []) {
  return spawnSync(process.execPath, [TSX_CLI, SCRIPT_PATH, ...args], {
    cwd: path.resolve(__dirname, "../.."),
    env: { ...process.env },
    encoding: "utf8",
  });
}

function textBlock(id: string, text: string) {
  return { id, type: "text", data: { html: `<p>${text}</p>` } };
}

describe("scripts/add-home-journey-faq-blocks.ts — script-smoke-test (izole test sayfası)", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  async function seedHomePage(blocks: unknown[]) {
    const page = await prisma.page.create({
      data: {
        title: "Anasayfa",
        slug: "home-test",
        status: "PUBLISHED",
        blocks: blocks as unknown as Prisma.InputJsonValue,
      },
    });
    await prisma.siteSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, homePageId: page.id },
      update: { homePageId: page.id },
    });
    return page;
  }

  it("SiteSettings.homePageId tanımsızsa NET bir hatayla durur (exit != 0)", () => {
    const result = runScript(["--list"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/homePageId/);
  });

  it("--list, blok sırasını index/type/id ile yazdırır", async () => {
    await seedHomePage([textBlock("b0", "ilk"), textBlock("b1", "ikinci")]);
    const result = runScript(["--list"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[0] type=text id=b0");
    expect(result.stdout).toContain("[1] type=text id=b1");
  });

  it("--journey-after=N --dry-run HİÇBİR ŞEY YAZMAZ (DB'de blok sayısı değişmez)", async () => {
    const page = await seedHomePage([textBlock("b0", "ilk"), textBlock("b1", "ikinci")]);
    const result = runScript(["--journey-after=0", "--dry-run"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[dry-run]");

    const reloaded = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    expect((reloaded.blocks as unknown[]).length).toBe(2);
  });

  it("--journey-after=0 gerçek çalıştırmada journey-map bloğunu [0] sıradaki bloğun HEMEN ARKASINA ekler", async () => {
    const page = await seedHomePage([textBlock("b0", "ilk"), textBlock("b1", "ikinci")]);
    const result = runScript(["--journey-after=0"]);
    expect(result.status).toBe(0);

    const reloaded = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    const blocks = reloaded.blocks as { id: string; type: string }[];
    expect(blocks.map((b) => b.id)).toEqual(["b0", "journey-map-block", "b1"]);
    expect(blocks[1]!.type).toBe("journey-map");
  });

  it("aynı script İKİNCİ KEZ çalıştırılınca journey-map bloğunu TEKRAR EKLEMEZ (idempotent)", async () => {
    const page = await seedHomePage([textBlock("b0", "ilk"), textBlock("b1", "ikinci")]);
    const first = runScript(["--journey-after=0"]);
    expect(first.status).toBe(0);
    const second = runScript(["--journey-after=0"]);
    expect(second.status).toBe(0);
    expect(second.stdout).toMatch(/\[atla\].*journey-map/);

    const reloaded = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    const blocks = reloaded.blocks as { id: string; type: string }[];
    expect(blocks.filter((b) => b.type === "journey-map").length).toBe(1);
  });

  it("--faq-before=1 SSS akordiyonunu (spotlight, 8 soru) [1] sıradaki bloğun HEMEN ÖNÜNE ekler", async () => {
    const page = await seedHomePage([textBlock("b0", "ilk"), textBlock("b1", "ikinci")]);
    const result = runScript(["--faq-before=1"]);
    expect(result.status).toBe(0);

    const reloaded = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    const blocks = reloaded.blocks as { id: string; type: string; data: Record<string, unknown> }[];
    expect(blocks.map((b) => b.id)).toEqual(["b0", "home-faq-accordion", "b1"]);
    const faqBlock = blocks[1]!;
    expect(faqBlock.data.layoutStyle).toBe("spotlight");
    expect(faqBlock.data.badge).toBe("FAQ");
    expect(faqBlock.data.defaultOpenFirst).toBe(true);
    expect((faqBlock.data.items as unknown[]).length).toBe(8);
  });

  it("translations.tr.blocks YOKSA TR çevirisine DOKUNMAZ, bunu NET şekilde loglar", async () => {
    const page = await seedHomePage([textBlock("b0", "ilk")]);
    const result = runScript(["--journey-after=0"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/translations\.tr\.blocks YOK/);

    const reloaded = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    expect(reloaded.translations).toEqual({});
  });

  it("translations.tr.blocks VARSA onu da AYNI anda, AYNI idempotency kontrolüyle günceller", async () => {
    const page = await prisma.page.create({
      data: {
        title: "Anasayfa",
        slug: "home-test",
        status: "PUBLISHED",
        blocks: [textBlock("b0", "ilk")] as unknown as Prisma.InputJsonValue,
        translations: { tr: { title: "Anasayfa TR", blocks: [textBlock("b0-tr", "ilk tr")] } } as unknown as Prisma.InputJsonValue,
      },
    });
    await prisma.siteSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, homePageId: page.id },
      update: { homePageId: page.id },
    });

    const result = runScript(["--journey-after=0"]);
    expect(result.status).toBe(0);

    const reloaded = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    const trBlocks = (reloaded.translations as { tr: { blocks: { id: string; data: Record<string, unknown> }[] } }).tr.blocks;
    expect(trBlocks.map((b) => b.id)).toEqual(["b0-tr", "journey-map-block"]);
    // TR içeriği EN'den FARKLI olmalı (gerçek çeviri, aynı metnin kopyası DEĞİL).
    expect(trBlocks[1]!.data.title).toBe("Dünyanın Dört Bir Yanından İstanbul'a");
  });

  it("geçersiz bir --journey-after konumunda HATA loglar, HİÇBİR ŞEY YAZMAZ", async () => {
    const page = await seedHomePage([textBlock("b0", "ilk")]);
    const result = runScript(["--journey-after=99"]);
    expect(result.status).toBe(0); // script kendi içinde hatayı loglar, process'i çökertmez
    expect(result.stdout).toMatch(/\[hata\]/);

    const reloaded = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    expect((reloaded.blocks as unknown[]).length).toBe(1);
  });

  it("--remove-faq-nav: var olan /faq nav öğesini siler, YOKSA [atla] der (idempotent)", async () => {
    await prisma.navigationItem.create({ data: { label: "FAQ", href: "/faq", order: 0, parentId: null } });
    const first = runScript(["--remove-faq-nav"]);
    expect(first.status).toBe(0);
    expect(await prisma.navigationItem.findFirst({ where: { href: "/faq" } })).toBeNull();

    const second = runScript(["--remove-faq-nav"]);
    expect(second.status).toBe(0);
    expect(second.stdout).toMatch(/\[atla\]/);
  });

  it("--unpublish-faq-page: slug=faq sayfasını DRAFT yapar, YOKSA [atla] der", async () => {
    await prisma.page.create({ data: { title: "SSS", slug: "faq", status: "PUBLISHED", blocks: [] as unknown as Prisma.InputJsonValue } });
    const result = runScript(["--unpublish-faq-page"]);
    expect(result.status).toBe(0);
    const faqPage = await prisma.page.findUniqueOrThrow({ where: { slug: "faq" } });
    expect(faqPage.status).toBe("DRAFT");
  });
});
