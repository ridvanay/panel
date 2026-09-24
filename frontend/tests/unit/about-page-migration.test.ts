import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ABOUT_ICON_KEYS, ABOUT_MAX_APPROACH_ITEMS, ABOUT_MAX_DOCTORS, ABOUT_MAX_TREATMENT_ITEMS, ABOUT_MIN_DOCTORS, buildDefaultAboutBlock } from "@/lib/about-page";
import { TEMPLATE_EDITABLE_FIELDS } from "@/lib/page-builder/template-fields";
import { aboutStrings as enAboutStrings } from "@/lib/i18n/site-dictionaries/en/about";
import { aboutStrings as trAboutStrings } from "@/lib/i18n/site-dictionaries/tr/about";

/**
 * Veri migration'ı (`backend/prisma/migrations/*_add_about_page_content`) sözlük metinlerinin o anki
 * bir KOPYASINI taşır; frontend/backend de birer "ayna" liste tutar. Bu dosya ikisinin de kaymadığını
 * doğrular (backend dosyaları metin olarak okunur — derleme bağımlılığı eklenmez).
 */
const repoRoot = resolve(__dirname, "../../..");
const migrationSql = readFileSync(resolve(repoRoot, "backend/prisma/migrations/20260924120000_add_about_page_content/migration.sql"), "utf8");
const backendTemplate = readFileSync(resolve(repoRoot, "backend/src/lib/about-page-template.ts"), "utf8");
const backendTemplateFields = readFileSync(resolve(repoRoot, "backend/src/lib/page-template-fields.ts"), "utf8");

function dollarQuoted(tag: string): unknown {
  const match = migrationSql.match(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`));
  if (!match) throw new Error(`$${tag}$ bloğu bulunamadı`);
  return JSON.parse(match[1]!);
}

describe("about veri migration'ı", () => {
  it("tr içeriği (başlık, blok, SEO) sözlükle birebir aynıdır", () => {
    expect(dollarQuoted("about_tr")).toEqual({
      title: "Hakkımızda",
      blocks: [buildDefaultAboutBlock(trAboutStrings)],
      seoTitle: trAboutStrings.metaTitle,
      seoDescription: trAboutStrings.metaDescription,
    });
  });

  it("en içeriği (başlık, blok, SEO) sözlükle birebir aynıdır", () => {
    expect(dollarQuoted("about_en")).toEqual({
      title: "About Us",
      blocks: [buildDefaultAboutBlock(enAboutStrings)],
      seoTitle: enAboutStrings.metaTitle,
      seoDescription: enAboutStrings.metaDescription,
    });
  });

  it("varsayılan dili locales tablosundan okur ve yalnızca en/tr için ekleme yapar", () => {
    expect(migrationSql).toContain(`FROM "locales" WHERE "isDefault" = true`);
    expect(migrationSql).toContain(`WHERE d."code" IN ('en', 'tr')`);
  });

  it("yalnızca INSERT içerir, var olan kaydı koruyan koşulu taşır ve tek ifadedir", () => {
    const statements = migrationSql.replace(/--.*$/gm, "").replace(/\$about_(tr|en)\$[\s\S]*?\$about_\1\$/g, "''");
    expect(statements).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/i);
    expect(statements).toContain(`WHERE NOT EXISTS (SELECT 1 FROM "pages" WHERE "slug" = 'about')`);
    expect(statements).toContain("ON CONFLICT DO NOTHING");
    expect(statements.trim().split(";").filter((part) => part.trim().length > 0)).toHaveLength(1);
  });
});

describe("backend ↔ frontend ayna listeleri", () => {
  it("ikon listesi aynıdır", () => {
    const block = backendTemplate.match(/ABOUT_ICON_KEYS = \[([\s\S]*?)\] as const/)![1]!;
    const backendKeys = [...block.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(backendKeys).toEqual([...ABOUT_ICON_KEYS]);
  });

  it("sınırlar aynıdır", () => {
    const value = (name: string) => Number(backendTemplate.match(new RegExp(`${name} = (\\d+)`))![1]);
    expect(value("ABOUT_MAX_TREATMENT_ITEMS")).toBe(ABOUT_MAX_TREATMENT_ITEMS);
    expect(value("ABOUT_MAX_APPROACH_ITEMS")).toBe(ABOUT_MAX_APPROACH_ITEMS);
    expect(value("ABOUT_MIN_DOCTORS")).toBe(ABOUT_MIN_DOCTORS);
    expect(value("ABOUT_MAX_DOCTORS")).toBe(ABOUT_MAX_DOCTORS);
  });

  it("şablon modu alan haritasındaki about-page girdisi aynıdır", () => {
    const line = backendTemplateFields.match(/"about-page": \[(.*?)\]/)![1]!;
    expect([...line.matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual(TEMPLATE_EDITABLE_FIELDS["about-page"]);
  });
});
