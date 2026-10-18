import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Paket A2 (2026-10-18) — "bitti kriteri": hasta portalı, doktor portalı, randevu sihirbazı ve
 * site başlığındaki kullanıcı menüsü dosyalarında sabit kodlanmış (sözlükten gelmeyen) Türkçe veya
 * İngilizce kullanıcı metni kalmamalı. TypeScript AST'si üzerinden taranır (yorumlar doğal olarak
 * hariçtir):
 *   - JSX metin düğümleri (harf içeren),
 *   - kullanıcıya dönük JSX attribute'larındaki string/template değerler (`title`, `label`, `aria-label`…),
 *   - `toast.*(...)` ve zod doğrulama mesajları (`.min(…, "mesaj")`, `.refine(…, "mesaj")`…),
 *   - Türkçe karakter içeren HER string literal.
 * Bilinçli istisnalar aşağıda dosya bazında listelenir (marka adı, sembol vb.).
 */

const SRC = path.resolve(__dirname, "../../src");

/** KIRMIZI ÇİZGİ dosyaları (salt okunur — `docs/prompts/2026-10-02-wm-health-icerik-guncellemesi.md`). */
const RED_LINE_FILES = new Set([
  "components/site/telehealth/consultation-room.tsx",
  "components/site/telehealth/booking-payment-step.tsx",
  "components/site/telehealth/doctor-consultation-note-dialog.tsx",
]);

/** Yalnızca görüşme odasında (KIRMIZI ÇİZGİ ağacı) kullanılan bileşenler — kapsam dışı. */
const CONSULTATION_ONLY_FILES = new Set([
  "components/site/telehealth/recording-controls.tsx",
  "components/site/telehealth/recording-indicator.tsx",
  "components/site/telehealth/recording-consent-dialog.tsx",
]);

/** Dosya bazında izinli literal metinler (çevrilmesi anlamsız: semboller, marka, birim kodu…). */
const ALLOWED: Record<string, readonly string[]> = {
  // Platform marka adları — her dilde aynı.
  "components/site/telehealth/doctor-social-links-editor.tsx": ["Instagram", "Facebook", "YouTube", "LinkedIn", "X (Twitter)", "TikTok", "https://"],
  "components/site/telehealth/doctor-publications-editor.tsx": ["https://"],
  // Alan adı → sözlük ANAHTARI eşlemesi (`title: "title"`), görünen metin değil.
  "components/site/telehealth/doctor-cv-fields.tsx": ["title", "description"],
  // Menü yoksa gösterilen yedek "Blog" bağlantısı — iki dilde de aynı.
  "components/site/site-header.tsx": ["Blog"],
};

const UI_ATTRIBUTES = new Set([
  "title",
  "description",
  "label",
  "placeholder",
  "aria-label",
  "alt",
  "hint",
  "confirmText",
  "cancelText",
  "confirmLabel",
  "cancelLabel",
  "emptyText",
  "helperText",
  "subtitle",
  "tooltip",
  "activeLabel",
  "loadingText",
  "message",
  "aria-description",
  "errorMessage",
]);

const VALIDATION_METHODS = new Set(["min", "max", "length", "regex", "email", "refine", "url", "uuid", "nonempty"]);
const TURKISH_CHARS = /[çğıöşüÇĞİÖŞÜ]/;
const HAS_WORD = /[A-Za-zçğıöşüÇĞİÖŞÜ]{2,}/;

function listScopedFiles(): string[] {
  const roots = ["app/[lang]/(site)/patient", "app/[lang]/(doctor)", "components/site/telehealth"];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) files.push(path.relative(SRC, full).split(path.sep).join("/"));
    }
  };
  for (const root of roots) walk(path.join(SRC, root));
  files.push("components/site/site-header.tsx");
  return files.filter((f) => !RED_LINE_FILES.has(f) && !CONSULTATION_ONLY_FILES.has(f));
}

function textOf(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" ");
  return null;
}

/** İçe aktarma, tip literal'i ve geliştiriciye dönük `throw new Error("…")` mesajları kullanıcı metni değildir. */
function isInsideImportOrType(node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p)) return true;
    if (ts.isNewExpression(p) && p.expression.getText() === "Error") return true;
  }
  return false;
}

/** `{ label: "…", title: "…" }` gibi kullanıcıya dönük obje alanları. */
function isUiObjectProperty(node: ts.Node): boolean {
  const p = node.parent;
  return !!p && ts.isPropertyAssignment(p) && p.initializer === node && UI_ATTRIBUTES.has(p.name.getText().replace(/["']/g, ""));
}

function enclosingUiAttribute(node: ts.Node): string | null {
  let p: ts.Node | undefined = node.parent;
  if (p && ts.isJsxExpression(p)) p = p.parent;
  if (p && ts.isJsxAttribute(p)) {
    const name = p.name.getText();
    return UI_ATTRIBUTES.has(name) ? name : null;
  }
  return null;
}

function isToastOrValidationArgument(node: ts.Node): boolean {
  const call = node.parent;
  if (!call || !ts.isCallExpression(call) || !call.arguments.includes(node as ts.Expression)) return false;
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const owner = callee.expression.getText();
  if (owner === "toast") return true;
  return VALIDATION_METHODS.has(callee.name.text) && call.arguments.indexOf(node as ts.Expression) > 0;
}

function findHardcodedUiStrings(relativePath: string): string[] {
  const source = fs.readFileSync(path.isAbsolute(relativePath) ? relativePath : path.join(SRC, relativePath), "utf8");
  const sf = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const allowed = new Set(ALLOWED[relativePath] ?? []);
  const findings: string[] = [];

  const report = (node: ts.Node, text: string) => {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!trimmed || allowed.has(trimmed)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
    findings.push(`${relativePath}:${line + 1}: ${trimmed}`);
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      if (HAS_WORD.test(node.text)) report(node, node.text);
    } else {
      const text = textOf(node);
      if (text !== null && !isInsideImportOrType(node)) {
        if (TURKISH_CHARS.test(text)) report(node, text);
        else if (HAS_WORD.test(text) && (enclosingUiAttribute(node) || isUiObjectProperty(node) || isToastOrValidationArgument(node))) report(node, text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

describe("portal i18n — sabit kodlanmış kullanıcı metni yok", () => {
  it("kapsamdaki dosyalarda sözlük dışı kullanıcı metni kalmamış", () => {
    const findings = listScopedFiles().flatMap((file) => findHardcodedUiStrings(file));
    expect(findings).toEqual([]);
  });

  it("tarayıcı gerçekten yakalıyor (kendi kendini doğrulama)", () => {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "portal-scan-")), "fixture.tsx");
    fs.writeFileSync(tmp, 'export const X = () => <Button title="Kaydet" aria-label={`${1} kayıt`}>Save now</Button>;\nconst y = "İptal";\n');
    try {
      expect(findHardcodedUiStrings(tmp)).toHaveLength(4);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
