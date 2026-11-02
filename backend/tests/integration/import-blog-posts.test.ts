import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDatabase } from "../helpers/reset-db";

/** Paket Z2 — scripts/import-blog-posts.ts (alt süreçte tsx; yalnızca test DB'si). */
const SCRIPT_PATH = path.resolve(__dirname, "../../scripts/import-blog-posts.ts");
const TSX_CLI = path.resolve(__dirname, "../../node_modules/tsx/dist/cli.mjs");
const CONFIRM = ["--confirm=import-blog", "--operator=test"];
const LOCALES_8 = ["tr", "de", "ar", "ru", "es", "fr", "ro", "sr-latn"];

function runScript(args: string[]) {
  return spawnSync(process.execPath, [TSX_CLI, SCRIPT_PATH, ...args], {
    cwd: path.resolve(__dirname, "../.."),
    env: { ...process.env },
    encoding: "utf8",
  });
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i % 50}`).join(" ");

type PostJson = Record<string, unknown>;
type Batch = { batch: string; categories: Record<string, unknown>[]; posts: PostJson[] };

function category(slug: string, isMedical: boolean, name: string) {
  return {
    slug,
    isMedical,
    name,
    translations: Object.fromEntries(LOCALES_8.map((l) => [l, { name: `${name} (${l})` }])),
  };
}

function medicalPost(over: PostJson = {}): PostJson {
  return {
    planNumber: 1,
    slug: "ercp-explained",
    title: "ERCP explained",
    excerpt: "A calm overview of ERCP.",
    seoTitle: "ERCP explained",
    seoDescription: "x".repeat(130),
    categorySlug: "digestive-health",
    specialtySlug: "gastroenterology",
    careTopicSlugs: ["bile-duct-stones"],
    reviewerDoctorSlug: "dr-gastro",
    medicalReviewStatus: "pending",
    packageSlug: null,
    keyTakeaways: ["One", "Two", "Three", "Four"],
    faq: [1, 2, 3, 4, 5].map((i) => ({ question: `Q${i}?`, answer: `A${i}.` })),
    references: [
      { title: "ERCP", publisher: "NHS", url: "https://www.nhs.uk/ercp", accessedAt: "2026-11-01" },
      { title: "Bile ducts", publisher: "NIH", url: "https://www.nih.gov/bile", accessedAt: "2026-11-01" },
      { title: "Guideline", publisher: "ASGE", url: "https://www.asge.org/ercp", accessedAt: "2026-11-01" },
    ],
    sourcesMissing: false,
    sourcesNote: null,
    wordCount: 1300,
    contentHtml: `<p>${words(600)}</p><h2>Overview</h2><p>${words(700)}</p><script>alert(1)</script><h2>Next steps</h2><p><a href="/specialties/gastroenterology">Gastroenterology</a> <a href="/find-a-physician">Find my physician</a></p>`,
    ...over,
  };
}

function travelPost(over: PostJson = {}): PostJson {
  return medicalPost({
    planNumber: 2,
    slug: "istanbul-arrival-guide",
    title: "Arriving in Istanbul",
    categorySlug: "health-travel",
    specialtySlug: null,
    careTopicSlugs: [],
    reviewerDoctorSlug: null,
    medicalReviewStatus: "not_required",
    contentHtml: `<p>${words(1300)}</p>`,
    ...over,
  });
}

function baseBatch(): Batch {
  return {
    batch: "99",
    categories: [category("digestive-health", true, "Digestive health"), category("health-travel", false, "Health travel")],
    posts: [medicalPost(), travelPost()],
  };
}

describe("scripts/import-blog-posts.ts", () => {
  const prisma = new PrismaClient();
  let dir: string;
  let backupDir: string;
  let ids: { gastro: string; ortho: string };

  const writeBatch = (batch: Batch, name = "batch.json") => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(batch), "utf8");
    return file;
  };
  const real = (file: string) => runScript([`--file=${file}`, ...CONFIRM, `--backup-dir=${backupDir}`, "--no-revalidate"]);
  const backups = () => fs.readdirSync(backupDir);

  beforeEach(async () => {
    await resetDatabase(prisma);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "blog-import-"));
    backupDir = path.join(dir, "backups");

    const gastro = await prisma.specialty.create({ data: { name: "Gastroenterology", slug: "gastroenterology", icon: "stethoscope" } });
    const ortho = await prisma.specialty.create({ data: { name: "Orthodontist", slug: "orthodontist", icon: "smile" } });
    ids = { gastro: gastro.id, ortho: ortho.id };
    await prisma.doctorProfile.create({
      data: { title: "Prof. Dr.", fullName: "Gastro Doc", slug: "dr-gastro", bio: "x", languages: ["en"], specialtyId: gastro.id },
    });
    await prisma.doctorProfile.create({
      data: { title: "Dr.", fullName: "Ortho Doc", slug: "dr-ortho", bio: "x", languages: ["en"], specialtyId: ortho.id },
    });
    await prisma.doctorProfile.create({
      data: { title: "Dr.", fullName: "Inactive Doc", slug: "dr-inactive", bio: "x", languages: ["en"], specialtyId: gastro.id, isActive: false },
    });
    const topic = (slug: string, extra: Record<string, unknown> = {}) =>
      prisma.careTopic.create({ data: { slug, bodyArea: "digestive", ...extra } });
    const linked = await topic("bile-duct-stones");
    await prisma.careTopicSpecialty.create({ data: { topicId: linked.id, specialtyId: gastro.id, weight: 3 } });
    await topic("general-topic");
    const red = await topic("red-flag-topic", { isRedFlag: true });
    await prisma.careTopicSpecialty.create({ data: { topicId: red.id, specialtyId: gastro.id, weight: 3 } });
    const other = await topic("teeth-topic");
    await prisma.careTopicSpecialty.create({ data: { topicId: other.id, specialtyId: ortho.id, weight: 3 } });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  it("kuru çalıştırma hiçbir şey yazmaz; plan, uyarı ve özet basar", async () => {
    const res = runScript([`--file=${writeBatch(baseBatch())}`, `--backup-dir=${backupDir}`]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("VARSAYILAN DİL EN DEĞİL");
    expect(res.stdout).toContain("ercp-explained");
    expect(res.stdout).toContain("oluştur");
    expect(res.stdout).toMatch(/Özet: yazı oluştur=2/);
    expect(await prisma.blogPost.count()).toBe(0);
    expect(await prisma.blogCategory.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "blog.import_batch" } })).toBe(0);
    expect(fs.existsSync(backupDir)).toBe(false);
  });

  it("--confirm yanlışsa ya da --operator yoksa reddedilir", () => {
    const file = writeBatch(baseBatch());
    expect(runScript([`--file=${file}`, "--confirm=yanlis", "--operator=x"]).status).not.toBe(0);
    expect(runScript([`--file=${file}`, "--confirm=import-blog"]).status).not.toBe(0);
  });

  const failing: [string, (b: Batch) => void, RegExp][] = [
    ["pasif hekim", (b) => ((b.posts[0] as PostJson).reviewerDoctorSlug = "dr-inactive"), /aktif değil/],
    ["yanlış uzmanlık eşleşmesi", (b) => ((b.posts[0] as PostJson).reviewerDoctorSlug = "dr-ortho"), /eşleşmiyor/],
    ["red-flag konu", (b) => ((b.posts[0] as PostJson).careTopicSlugs = ["red-flag-topic"]), /isRedFlag/],
    ["uzmanlıkla eşleşmeyen konu", (b) => ((b.posts[0] as PostJson).careTopicSlugs = ["teeth-topic"]), /bağlı değil/],
    ["bilinmeyen kategori", (b) => ((b.posts[0] as PostJson).categorySlug = "nope"), /ne partide tanımlı ne DB/],
    ["seyahat yazısında hekim", (b) => ((b.posts[1] as PostJson).reviewerDoctorSlug = "dr-gastro"), /reviewerDoctorSlug null olmalı/],
    ["tıbbi yazı tıbbi olmayan kategoride", (b) => ((b.posts[0] as PostJson).categorySlug = "health-travel"), /tıbbi olmayan kategori/],
    ["bilinmeyen uzmanlık", (b) => ((b.posts[0] as PostJson).specialtySlug = "nope"), /DB'de yok/],
    ["bilinmeyen konu", (b) => ((b.posts[0] as PostJson).careTopicSlugs = ["nope"]), /careTopic "nope" DB'de yok/],
    ["http kaynak", (b) => ((b.posts[0] as PostJson).references = [{ title: "x", publisher: "y", url: "http://a.com", accessedAt: "2026-11-01" }]), /references geçersiz/],
    ["tekrarlı slug", (b) => ((b.posts[1] as PostJson).slug = "ercp-explained"), /tekrar/],
    ["geçersiz slug", (b) => ((b.posts[0] as PostJson).slug = "Bad_Slug"), /slug biçimi/],
    ["tıbbi yazıda not_required", (b) => ((b.posts[0] as PostJson).medicalReviewStatus = "not_required"), /"pending" olmalı/],
    ["şema hatası", (b) => delete (b.posts[0] as PostJson).title, /şema/],
  ];
  it.each(failing)("doğrulama hatası yazımı engeller: %s", async (_name, mutate, pattern) => {
    const batch = baseBatch();
    mutate(batch);
    const res = real(writeBatch(batch));
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(pattern);
    expect(res.stderr).toContain("HİÇBİR ŞEY YAZILMADI");
    expect(await prisma.blogPost.count()).toBe(0);
    expect(await prisma.blogCategory.count()).toBe(0);
    expect(fs.existsSync(backupDir)).toBe(false);
  });

  it("hekimi olmayan uzmanlık hatadır", async () => {
    await prisma.doctorProfile.updateMany({ where: { slug: "dr-gastro" }, data: { isActive: false } });
    const res = real(writeBatch(baseBatch()));
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/aktif hekim yok/);
    expect(await prisma.blogPost.count()).toBe(0);
  });

  it("gerçek çalıştırma (varsayılan dil TR): kategori + yazı, translations.en, ContentSlug, yedek, audit", async () => {
    const res = real(writeBatch(baseBatch()));
    expect(res.status).toBe(0);

    const cat = await prisma.blogCategory.findUniqueOrThrow({ where: { slug: "digestive-health" } });
    expect(cat.isMedical).toBe(true);
    expect(cat.name).toBe("Digestive health");
    const catTr = cat.translations as Record<string, { name: string }>;
    expect(Object.keys(catTr).sort()).toEqual([...LOCALES_8].sort()); // kanonik ad + 8 çeviri = 9 dil
    expect((await prisma.blogCategory.findUniqueOrThrow({ where: { slug: "health-travel" } })).isMedical).toBe(false);

    const post = await prisma.blogPost.findUniqueOrThrow({ where: { slug: "ercp-explained" } });
    expect(post.status).toBe("DRAFT");
    expect(post.medicalReviewStatus).toBe("pending");
    expect(post.specialtyId).toBe(ids.gastro);
    expect(post.reviewerDoctorId).toBe((await prisma.doctorProfile.findUniqueOrThrow({ where: { slug: "dr-gastro" } })).id);
    expect(post.careTopicIds).toHaveLength(1);
    expect(post.categoryId).toBe(cat.id);
    expect(post.readingMinutes).toBe(7); // ~1300 kelime / 200
    expect(post.isFeatured).toBe(false);
    expect(post.coverImageUrl).toBeNull();
    expect(post.contentHtml).not.toContain("<script");
    expect(post.title).toBe("ERCP explained");
    expect((post.keyTakeaways as string[]).length).toBe(4);
    expect((post.faq as unknown[]).length).toBe(5);
    expect((post.references as unknown[]).length).toBe(3);
    const en = (post.translations as Record<string, Record<string, unknown>>).en!;
    expect(en.title).toBe("ERCP explained");
    expect(String(en.contentHtml)).not.toContain("<script");
    expect(en.readingMinutes).toBe(7);

    const travel = await prisma.blogPost.findUniqueOrThrow({ where: { slug: "istanbul-arrival-guide" } });
    expect(travel.medicalReviewStatus).toBe("not_required");
    expect(travel.reviewerDoctorId).toBeNull();
    expect(travel.specialtyId).toBeNull();
    expect(travel.status).toBe("DRAFT");

    const slugs = await prisma.contentSlug.findMany({ where: { entityType: "BLOG_POST", entityId: post.id } });
    expect(slugs.map((s) => s.locale).sort()).toEqual(["en", "tr"]);
    expect(slugs.every((s) => s.slug === "ercp-explained")).toBe(true);

    expect(backups()).toHaveLength(1);
    const backup = JSON.parse(fs.readFileSync(path.join(backupDir, backups()[0]!), "utf8"));
    expect(backup.created.posts).toHaveLength(2);
    expect(backup.created.categories).toHaveLength(2);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "blog.import_batch" } });
    expect(audit.actorEmail).toBe("script:test");
    expect(audit.metadata).toMatchObject({ batch: "99", operator: "test", postsCreated: 2, categoriesCreated: 2 });
  });

  it("varsayılan dil EN iken metin kanonik kolonlara yazılır, translations.en yazılmaz", async () => {
    await prisma.locale.update({ where: { code: "tr" }, data: { isDefault: false } });
    await prisma.locale.update({ where: { code: "en" }, data: { isDefault: true } });
    const res = real(writeBatch(baseBatch()));
    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain("VARSAYILAN DİL EN DEĞİL");
    const post = await prisma.blogPost.findUniqueOrThrow({ where: { slug: "ercp-explained" } });
    expect(post.title).toBe("ERCP explained");
    expect((post.translations as Record<string, unknown>).en).toBeUndefined();
    const slugs = await prisma.contentSlug.findMany({ where: { entityType: "BLOG_POST", entityId: post.id } });
    expect(slugs.map((s) => s.locale)).toEqual(["en"]);
  });

  it("ikinci çalıştırma idempotent: kopya yok, yedek/audit eklenmez", async () => {
    const file = writeBatch(baseBatch());
    expect(real(file).status).toBe(0);
    const again = real(file);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("Yapılacak değişiklik yok");
    expect(await prisma.blogPost.count()).toBe(2);
    expect(await prisma.blogCategory.count()).toBe(2);
    expect(await prisma.contentSlug.count({ where: { entityType: "BLOG_POST" } })).toBe(4);
    expect(backups()).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: "blog.import_batch" } })).toBe(1);
  });

  it("medicalReviewNote: oluşturmada yazılır; yalnızca not değişince güncellenir; alan yoksa mevcut not korunur; approved atlanır", async () => {
    const NOTE = "Tedavi sonrası seyahat süresi notunu özellikle kontrol edin.";
    const withNote = (note: string | null | undefined) => {
      const b = baseBatch();
      if (note !== undefined) (b.posts[0] as PostJson).medicalReviewNote = note;
      return b;
    };
    const noteOf = async () => (await prisma.blogPost.findUniqueOrThrow({ where: { slug: "ercp-explained" } })).medicalReviewNote;

    // oluşturma
    expect(real(writeBatch(withNote(NOTE))).status).toBe(0);
    expect(await noteOf()).toBe(NOTE);

    // aynı not: değişiklik yok
    const same = real(writeBatch(withNote(NOTE)));
    expect(same.stdout).toContain("Yapılacak değişiklik yok");

    // yalnızca not değişir: kuru çalıştırma "güncelle", gerçek çalıştırma yalnızca notu günceller
    const changed = writeBatch(withNote("Yeni not"));
    const dry = runScript([`--file=${changed}`, `--backup-dir=${backupDir}`]);
    expect(dry.stdout).toMatch(/ercp-explained\s+güncelle/);
    expect(real(changed).status).toBe(0);
    expect(await noteOf()).toBe("Yeni not");

    // alan yok: mevcut not korunur ve "değişiklik yok"
    const omitted = real(writeBatch(withNote(undefined)));
    expect(omitted.stdout).toContain("Yapılacak değişiklik yok");
    expect(await noteOf()).toBe("Yeni not");

    // null: notu temizler
    expect(real(writeBatch(withNote(null))).status).toBe(0);
    expect(await noteOf()).toBeNull();

    // 2000 karakter üstü şema hatası
    const long = real(writeBatch(withNote("x".repeat(2001))));
    expect(long.status).not.toBe(0);
    expect(long.stderr).toMatch(/şema/);

    // approved yazıda not da ezilmez
    await prisma.blogPost.update({ where: { slug: "ercp-explained" }, data: { medicalReviewStatus: "approved", medicalReviewNote: "hekim" } });
    expect(real(writeBatch(withNote(NOTE))).stdout).toContain("Yapılacak değişiklik yok");
    expect(await noteOf()).toBe("hekim");
  });

  it("DRAFT yazı güncellenir; kategoriye yalnızca eksik çeviri eklenir; approved ve PUBLISHED atlanır", async () => {
    const batch = baseBatch();
    expect(real(writeBatch(batch)).status).toBe(0);
    const original = await prisma.blogPost.findUniqueOrThrow({ where: { slug: "ercp-explained" } });

    // mevcut kategori çevirisi DEĞİŞMEZ, eksik olan eklenir
    await prisma.blogCategory.update({
      where: { slug: "digestive-health" },
      data: { translations: { tr: { name: "Elle düzeltilmiş" } } },
    });

    (batch.posts[0] as PostJson).title = "ERCP explained v2";
    (batch.posts[1] as PostJson).title = "Arriving v2";
    await prisma.blogPost.update({ where: { slug: "istanbul-arrival-guide" }, data: { medicalReviewStatus: "approved" } });
    const res = real(writeBatch(batch, "v2.json"));
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("güncelle");
    expect(res.stdout).toContain("onaylı");

    const updated = await prisma.blogPost.findUniqueOrThrow({ where: { slug: "ercp-explained" } });
    expect(updated.id).toBe(original.id);
    expect(updated.title).toBe("ERCP explained v2");
    expect(((updated.translations as Record<string, Record<string, unknown>>).en!).title).toBe("ERCP explained v2");
    expect((await prisma.blogPost.findUniqueOrThrow({ where: { slug: "istanbul-arrival-guide" } })).title).toBe("Arriving in Istanbul");
    const cat = (await prisma.blogCategory.findUniqueOrThrow({ where: { slug: "digestive-health" } })).translations as Record<string, { name: string }>;
    expect(cat.tr!.name).toBe("Elle düzeltilmiş");
    expect(cat.de!.name).toBe("Digestive health (de)");

    // PUBLISHED atlanır
    await prisma.blogPost.update({ where: { slug: "ercp-explained" }, data: { status: "PUBLISHED", medicalReviewStatus: "approved" } });
    (batch.posts[0] as PostJson).title = "ERCP explained v3";
    const res3 = real(writeBatch(batch, "v3.json"));
    expect(res3.status).toBe(0);
    expect((await prisma.blogPost.findUniqueOrThrow({ where: { slug: "ercp-explained" } })).title).toBe("ERCP explained v2");
    expect(await prisma.blogPost.count()).toBe(2);
  });

  it("restore: oluşturulanları siler, güncellenenleri geri alır; onaylı/yayındaki dokunulmaz; kuru restore yazmaz", async () => {
    const batch = baseBatch();
    expect(real(writeBatch(batch)).status).toBe(0);
    const first = path.join(backupDir, backups()[0]!);

    // kuru restore
    const dry = runScript([`--restore=${first}`]);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain("[kuru]");
    expect(await prisma.blogPost.count()).toBe(2);

    // yazı onaylanırsa silinmez
    await prisma.blogPost.update({ where: { slug: "istanbul-arrival-guide" }, data: { medicalReviewStatus: "approved" } });
    const res = runScript([`--restore=${first}`, ...CONFIRM]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("SİLİNMEDİ");
    expect(await prisma.blogPost.count({ where: { slug: "ercp-explained" } })).toBe(0);
    expect(await prisma.blogPost.count({ where: { slug: "istanbul-arrival-guide" } })).toBe(1);
    expect(await prisma.contentSlug.count({ where: { slug: "ercp-explained" } })).toBe(0);
    expect(await prisma.blogCategory.count({ where: { slug: "health-travel" } })).toBe(1); // yazı bağlı
    expect(await prisma.blogCategory.count({ where: { slug: "digestive-health" } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "blog.import_restore" } })).toBe(1);
  });

  it("restore güncellenen yazıyı/kategoriyi eski hâline döndürür", async () => {
    const batch = baseBatch();
    expect(real(writeBatch(batch)).status).toBe(0);
    await prisma.blogCategory.update({ where: { slug: "digestive-health" }, data: { translations: { tr: { name: "Eski" } } } });
    const beforePost = await prisma.blogPost.findUniqueOrThrow({ where: { slug: "ercp-explained" } });

    (batch.posts[0] as PostJson).title = "Yeni başlık";
    expect(real(writeBatch(batch, "v2.json")).status).toBe(0);
    expect((await prisma.blogPost.findUniqueOrThrow({ where: { slug: "ercp-explained" } })).title).toBe("Yeni başlık");

    const second = path.join(backupDir, backups().sort().at(-1)!);
    expect(JSON.parse(fs.readFileSync(second, "utf8")).updated.posts).toHaveLength(1);
    const res = runScript([`--restore=${second}`, ...CONFIRM]);
    expect(res.status).toBe(0);
    const after = await prisma.blogPost.findUniqueOrThrow({ where: { slug: "ercp-explained" } });
    expect(after.title).toBe(beforePost.title);
    expect(after.contentHtml).toBe(beforePost.contentHtml);
    expect(after.translations).toEqual(beforePost.translations);
    expect(await prisma.blogPost.count()).toBe(2);
    const cat = (await prisma.blogCategory.findUniqueOrThrow({ where: { slug: "digestive-health" } })).translations as Record<string, { name: string }>;
    expect(cat.tr!.name).toBe("Eski");
    expect(cat.de).toBeUndefined();
  });

  it("uyarılar: kelime sayısı, yasak ifade, kaynak eksik; yazımı engellemez", async () => {
    const batch = baseBatch();
    Object.assign(batch.posts[0] as PostJson, {
      contentHtml: "<p>The price is 50% lower and we guarantee the best result at 5 mg.</p>",
      sourcesMissing: true,
      sourcesNote: "NHS page missing",
    });
    const res = runScript([`--file=${writeBatch(batch)}`]);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/kelime sayısı \d+ \(hedef 1200-1800\)/);
    expect(res.stdout).toContain("YASAK İFADE TARAMASI");
    for (const term of ["price/cost/fee", "%", "guarantee", "best", "mg"]) expect(res.stdout).toContain(term);
    expect(res.stdout).toContain("KAYNAK EKSİK: NHS page missing");
  });
});
