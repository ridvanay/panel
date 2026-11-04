import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Paket AH (Faz 1, §5) — ziyaretçiye dönük kodda SABİT TÜRKÇE METİN taraması.
 *
 * Türkçe ziyaretçiden kaldırıldı; ziyaretçi bileşenlerinde, sayfalarında, SEO/OG üreticilerinde ve API
 * hata mesajlarında Türkçe metin kalmamalıdır. Tarama TypeScript AST'si üzerinden yapılır: yalnızca
 * dize sabitleri, şablon dizeleri ve JSX metinleri taranır — YORUM SATIRLARI ve import yolları taranmaz.
 *
 * Tespit:
 *  - Türkçe harfler `çğıöşÇĞİÖŞÜ` (UI kodunda) / yalnızca Türkçeye özgü `ğıİ` (diğer dillerin sözlüklerinde:
 *    Almanca ö/ü, Fransızca ç, Romence ş meşrudur) ve
 *  - yaygın Türkçe sözcükler (için, değil, randevu, sepet, ödeme, lütfen …).
 *
 * Kapsam DIŞI (bilinçli, gerekçeli — aşağıdaki EXEMPT listesi): admin paneli (ayrı dizin, taranmaz), hekim portalı,
 * e-ticaret modülü (products modülü kapalıyken 404; sepet/ödeme ziyaretçiye 301 ile kapalı), personel panelleri,
 * Türkçe sözlük klasörü (`site-dictionaries/tr/`). Her istisnanın gerekçesi raporda listelenir.
 */

const SRC = path.resolve(__dirname, "../../src");

/** Taranan kökler (src'ye göre). Admin (`app/admin`, `components/admin`) bilerek DIŞARIDA. */
const ROOTS = [
  "components/site",
  "components/shared",
  "components/auth",
  "app/[lang]",
  "app/(auth)",
  "app/layout.tsx",
  "app/not-found.tsx",
  "app/global-error.tsx",
  "app/sitemap.xml",
  "app/sitemaps",
  "app/llms.txt",
  "app/llms-full.txt",
  "app/robots.txt",
  "lib",
  "proxy.ts",
];

/** Dizin ya da dosya öneki (src'ye göre, `/` ayraçlı) + gerekçe. */
const EXEMPT: { prefix: string; reason: string }[] = [
  // Türkçe sözlük klasörleri (ziyaretçiye servis edilmez; dil kapatıldı).
  { prefix: "lib/i18n/site-dictionaries/tr/", reason: "Türkçe sözlük klasörü" },
  { prefix: "lib/i18n/matcher-dictionaries/tr.ts", reason: "Türkçe eşleştirme sözlüğü" },
  // Admin/personel arayüz sözlükleri ve yardımcıları.
  { prefix: "lib/i18n/dictionaries/", reason: "admin paneli arayüz sözlükleri (iç araç, Türkçe kalabilir)" },
  { prefix: "lib/api/admin-", reason: "admin API istemcileri" },
  { prefix: "lib/api/crm.ts", reason: "admin CRM istemcisi" },
  { prefix: "lib/api/reports.ts", reason: "admin raporları" },
  { prefix: "lib/api/upload.ts", reason: "admin medya yükleme" },
  { prefix: "lib/api/doctor-showcase.ts", reason: "hekim vitrini (ziyaretçiden kaldırıldı; hekim portalı)" },
  { prefix: "lib/email-blocks/", reason: "admin e-posta editörü" },
  { prefix: "lib/page-builder/registry.ts", reason: "admin sayfa oluşturucu etiketleri" },
  { prefix: "lib/page-builder/presets.ts", reason: "admin sayfa oluşturucu hazır ayarları" },
  { prefix: "lib/site-settings/", reason: "admin görünüm ayarı etiketleri (palet/yazı tipi adları)" },
  { prefix: "lib/sliders/design-tokens.ts", reason: "admin slider tasarım etiketleri" },
  { prefix: "lib/role-badge.ts", reason: "admin rol rozetleri" },
  { prefix: "lib/stats-range.ts", reason: "admin istatistik aralığı" },
  { prefix: "lib/video-upload.ts", reason: "admin video yükleme" },
  { prefix: "lib/booking-notification-recipients.ts", reason: "admin Ayarlar doğrulaması" },
  { prefix: "lib/emergency-notice.ts", reason: "admin acil durum uyarısı doğrulaması" },
  { prefix: "lib/password-policy.ts", reason: "klavye dizilimi kalıpları (veri, metin değil)" },
  { prefix: "lib/common-passwords.ts", reason: "yaygın parola listesi (veri)" },
  { prefix: "lib/telehealth-format.ts", reason: "hekim konsolu 'TSİ' kısaltması (e2e sözleşmesi)" },
  { prefix: "lib/legacy-turkish-text.ts", reason: "Türkçe metin TESPİT eden yardımcı" },
  { prefix: "lib/contact-hours.ts", reason: "Paket AK — panelde girilen Türkçe gün adlarını TESPİT edip ziyaretçi diline eşleyen yardımcı (eşleme anahtarı)" },
  // Hekim portalı.
  { prefix: "app/[lang]/(doctor)/", reason: "hekim portalı (kapsam dışı)" },
  { prefix: "components/site/telehealth/", reason: "hekim portalı/konsolu, randevu-ödeme adımları (ziyaretçi girişleri /request'e 301)" },
  { prefix: "components/site/interpreter/", reason: "tercüman paneli (personel)" },
  { prefix: "app/[lang]/(site)/interpreter/", reason: "tercüman paneli sayfaları (personel)" },
  { prefix: "lib/iso-countries.ts", reason: "randevu kimlik adımı ülke adları (hekim/randevu akışı)" },
  // Hesap güvenliği ortak bileşenleri (admin + hekim + hesap).
  { prefix: "components/site/security/", reason: "2FA kurulum paneli (admin/hekim/hesap ortak)" },
  { prefix: "components/shared/revoke-other-sessions-option.tsx", reason: "oturum kapatma seçeneği (admin/hesap ortak)" },
  // E-ticaret modülü (products modülü kapalıyken tüm rotalar 404; sepet/ödeme/checkout ziyaretçiye 301 ile /request).
  { prefix: "components/site/cart-drawer.tsx", reason: "e-ticaret modülü" },
  { prefix: "components/site/add-to-cart-button.tsx", reason: "e-ticaret modülü" },
  { prefix: "components/site/favorite-button.tsx", reason: "e-ticaret modülü" },
  { prefix: "components/site/free-shipping-progress.tsx", reason: "e-ticaret modülü" },
  { prefix: "components/site/product-card.tsx", reason: "e-ticaret modülü" },
  { prefix: "components/site/product-card-media.tsx", reason: "e-ticaret modülü" },
  { prefix: "components/site/catalog/", reason: "e-ticaret modülü" },
  { prefix: "components/site/checkout/", reason: "e-ticaret modülü" },
  { prefix: "components/site/product/", reason: "e-ticaret modülü" },
  { prefix: "components/site/hesabim/", reason: "e-ticaret hesabım kabuğu" },
  { prefix: "lib/order-", reason: "e-ticaret sipariş durumu" },
  { prefix: "lib/product-json-ld.ts", reason: "e-ticaret modülü" },
  { prefix: "app/[lang]/(site)/cart/", reason: "e-ticaret modülü" },
  { prefix: "app/[lang]/(site)/checkout/", reason: "e-ticaret modülü" },
  { prefix: "app/[lang]/(site)/products/", reason: "e-ticaret modülü" },
  { prefix: "app/[lang]/(site)/hesabim/", reason: "e-ticaret hesabım sayfaları" },
  { prefix: "app/[lang]/(site)/siparislerim/", reason: "e-ticaret modülü" },
  { prefix: "app/[lang]/(site)/portfolio/", reason: "portföy modülü (şablon modülü; kapalıyken 404)" },
  { prefix: "components/site/portfolio-card.tsx", reason: "portföy modülü" },
];

/** Veri olarak Türkçe anahtar taşıyan satırlar (görünen metin değil). */
const ALLOWED_TEXT: { file: string; text: RegExp; reason: string }[] = [
  { file: "*", text: /^Français$/, reason: "Fransızcanın yerel dil adı" },
  { file: "components/site/home/home-journey.tsx", text: /^(birleşik krallık|amerika birleşik devletleri)$/i, reason: "ülke eşleştirme anahtarları (admin girdisi eşleşmesi)" },
];

const TURKISH_LETTERS = /[çğıöşÇĞİÖŞÜ]/;
const TURKISH_ONLY_LETTERS = /[ğıİ]/;
const TURKISH_WORDS =
  /(?:^|[\s"'`(>])(için|değil|olarak|veya|hakkında|randevu\w*|hekim\w*|sepet\w*|ödeme\w*|kaydet|lütfen|şifre\w*|kullanıcı\w*|yükleniyor|devam|iletişim|hakkımızda|tüm|giriş|çıkış|tekrar dene|ana sayfa|kopyala|paylas|gonder|olustu|basarili|bulunamadi|kaydedildi|silindi|seciniz|musteri|siparisw*)(?=$|[\s"'`.,:;!?)<])/i;

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function isExempt(rel: string): boolean {
  return EXEMPT.some((e) => rel === e.prefix || rel.startsWith(e.prefix));
}

function collectFiles(): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(abs)) walk(path.join(abs, name));
      return;
    }
    if (!/\.(ts|tsx)$/.test(abs) || /\.test\./.test(abs) || abs.endsWith(".d.ts")) return;
    out.push(abs);
  };
  for (const root of ROOTS) {
    const abs = path.join(SRC, root);
    if (fs.existsSync(abs)) walk(abs);
  }
  return out;
}

interface Finding {
  file: string;
  line: number;
  text: string;
}

function scanFile(abs: string, mode: "ui" | "dictionary"): Finding[] {
  const rel = toPosix(path.relative(SRC, abs));
  const source = fs.readFileSync(abs, "utf8");
  const sf = ts.createSourceFile(abs, source, ts.ScriptTarget.Latest, true, abs.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const findings: Finding[] = [];
  const letters = mode === "ui" ? TURKISH_LETTERS : TURKISH_ONLY_LETTERS;
  const visit = (node: ts.Node) => {
    let text: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) text = node.text;
    else if (ts.isJsxText(node)) text = node.getText();
    const parent = node.parent;
    const isModuleSpecifier = parent && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent));
    if (text && !isModuleSpecifier && (letters.test(text) || TURKISH_WORDS.test(text))) {
      const trimmed = text.trim();
      const allowed = ALLOWED_TEXT.some((a) => (a.file === "*" || a.file === rel) && a.text.test(trimmed));
      if (!allowed) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        findings.push({ file: rel, line: line + 1, text: trimmed.replace(/\s+/g, " ").slice(0, 80) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

describe("Paket AH — ziyaretçi kodunda sabit Türkçe metin yok", () => {
  it("ziyaretçi bileşenleri, sayfaları, SEO üreticileri ve API mesajları Türkçe metin içermez", () => {
    const findings: Finding[] = [];
    for (const abs of collectFiles()) {
      const rel = toPosix(path.relative(SRC, abs));
      if (isExempt(rel)) continue;
      // Diğer dillerin sözlükleri ayrı testte (Türkçeye özgü harfler) taranır.
      if (/^lib\/i18n\/(site-dictionaries|matcher-dictionaries)\//.test(rel)) continue;
      findings.push(...scanFile(abs, "ui"));
    }
    const report = findings.map((f) => `${f.file}:${f.line}  ${f.text}`).join("\n");
    expect(report).toBe("");
  });

  it("EN ve diğer dillerin sözlükleri Türkçeye özgü harf/sözcük içermez", () => {
    const findings: Finding[] = [];
    for (const abs of collectFiles()) {
      const rel = toPosix(path.relative(SRC, abs));
      if (!/^lib\/i18n\/(site-dictionaries|matcher-dictionaries)\//.test(rel)) continue;
      if (isExempt(rel)) continue;
      findings.push(...scanFile(abs, "dictionary"));
    }
    const report = findings.map((f) => `${f.file}:${f.line}  ${f.text}`).join("\n");
    expect(report).toBe("");
  });

  it("tarama gerçekten çalışıyor: bilinen Türkçe örnek yakalanır, yorum satırı yakalanmaz", () => {
    const sample = path.join(SRC, "__scan_probe__.tsx");
    const original = fs.existsSync(sample);
    expect(original).toBe(false);
    const probe = ts.createSourceFile(
      sample,
      `// Yorum satırında Türkçe karakter: ığü\nexport const a = "Lütfen tekrar deneyin"; export const b = "Please try again";`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    const texts: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isStringLiteral(n)) texts.push(n.text);
      ts.forEachChild(n, visit);
    };
    visit(probe);
    expect(texts.filter((t) => TURKISH_LETTERS.test(t) || TURKISH_WORDS.test(t))).toEqual(["Lütfen tekrar deneyin"]);
  });

  it("istisna listesinin her kaydı mevcut bir dosya/dizin işaret eder (ölü istisna yok)", () => {
    const stale = EXEMPT.filter((e) => {
      const abs = path.join(SRC, e.prefix);
      if (fs.existsSync(abs)) return false;
      // Önek eşleşmesi (ör. "lib/order-", "lib/api/admin-") — dizinde başlayan en az bir dosya olmalı.
      const dir = path.dirname(abs);
      const base = path.basename(abs);
      return !(fs.existsSync(dir) && fs.readdirSync(dir).some((n) => n.startsWith(base)));
    });
    expect(stale.map((s) => s.prefix)).toEqual([]);
  });
});
