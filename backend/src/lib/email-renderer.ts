/**
 * §10.16.4 E-posta Şablonu Blok Editörü — sunucu tarafı render (KRİTİK güvenlik kısıtı).
 *
 * KARAR (ARCHITECTURE.md §10.16.4, bağlayıcı): e-posta HTML'i istemciden ASLA kabul edilmez.
 * İstemci yalnızca yapısal blok verisi (`EmailBlock[]`) gönderir; bu modül onu tablo-tabanlı,
 * satır-içi (`inline`) stilli e-posta HTML'ine dönüştürür. Satır-içi `style` değerleri
 * KULLANICI GİRDİSİNDEN DEĞİL, doğrulanmış token'lardan üretilir (hizalama enum'ı,
 * `^#[0-9a-fA-F]{6}$` renk, `none|sm|md|lg` boşluk enum'ı) — kullanıcı HİÇBİR KOŞULDA ham CSS
 * yazamaz.
 *
 * Değişken (`{{...}}`) render'ı BU MODÜLÜN İŞİ DEĞİLDİR — çıktıdaki `{{key}}` kalıpları OLDUĞU
 * GİBİ bırakılır; çağıran taraf (email-templates.service.ts) `lib/template-render.ts::renderTemplate`
 * ile allow-list'e dayalı, HTML-escape'li ikinci bir geçiş uygular (§10.16.4).
 *
 * Bu dosya SAF'tır (DB/IO YOKTUR, `computePageSeoScore` ile AYNI ilke) — site adı/logo/hukuki
 * sayfa linkleri gibi DB'den gelen veriler `EmailRenderContext` olarak DIŞARIDAN verilir
 * (bkz. `modules/email-templates/email-templates.service.ts::buildEmailRenderContext`).
 */
import { sanitizeEmailRichText } from "./html-sanitize";

export interface EmailRenderContext {
  siteName: string;
  siteUrl: string;
  /** `SiteSettings.logoUrl` — `logo-header` bloğu `useSiteLogo: true` iken kullanılır. */
  logoUrl: string | null;
  /** `status=PUBLISHED`, `deletedAt=null`, `isLegalDocument=true` olan `Page`ler (§10.16.4 KVKK footer). */
  legalPages: { title: string; url: string }[];
}

const SPACING_PX: Record<string, number> = { none: 0, sm: 8, md: 16, lg: 32 };
const ALIGN_VALUES = new Set(["left", "center", "right"]);
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
/** button.href — TAMAMEN tek bir değişken olabilir (§10.16.4). */
const HREF_VARIABLE_ONLY_PATTERN = /^\{\{[A-Za-z0-9_]+\}\}$/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Öznitelik değerleri için de HTML-escape yeterlidir (çift tırnaklı öznitelikler kullanılıyor). */
const escapeAttr = escapeHtml;

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function resolveHexColor(value: unknown, fallback: string | null): string | null {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value) ? value : fallback;
}

interface ResolvedBlockStyle {
  align: "left" | "center" | "right";
  backgroundColor: string | null;
  textColor: string | null;
  paddingY: number;
  paddingX: number;
}

function resolveContainerStyle(style: unknown): ResolvedBlockStyle {
  const s = (style && typeof style === "object" ? style : {}) as Record<string, unknown>;
  const align = typeof s.align === "string" && ALIGN_VALUES.has(s.align) ? (s.align as "left" | "center" | "right") : "left";
  const paddingY = typeof s.paddingY === "string" && s.paddingY in SPACING_PX ? SPACING_PX[s.paddingY]! : SPACING_PX.md!;
  const paddingX = typeof s.paddingX === "string" && s.paddingX in SPACING_PX ? SPACING_PX[s.paddingX]! : SPACING_PX.md!;

  return {
    align,
    backgroundColor: resolveHexColor(s.backgroundColor, null),
    textColor: resolveHexColor(s.textColor, null),
    paddingY,
    paddingX,
  };
}

function cellStyle(resolved: ResolvedBlockStyle): string {
  const parts = [`padding:${resolved.paddingY}px ${resolved.paddingX}px`, `text-align:${resolved.align}`, "font-family:Arial,Helvetica,sans-serif"];
  if (resolved.backgroundColor) parts.push(`background-color:${resolved.backgroundColor}`);
  if (resolved.textColor) parts.push(`color:${resolved.textColor}`);
  return parts.join(";");
}

function isValidButtonHref(href: string): boolean {
  if (HREF_VARIABLE_ONLY_PATTERN.test(href)) return true;
  return /^https?:\/\//i.test(href) || /^mailto:/i.test(href);
}

/**
 * `useSiteLogo: true` iken logo tanımsızsa (`context.logoUrl` null) blok HİÇ render edilmez
 * (§10.16.4).
 *
 * GÜVENLİK DÜZELTMESİ (security-agent denetimi) — savunma derinliği: `renderImage` (aşağıda)
 * `data.url`'i yalnızca `^https?://` ile eşleşiyorsa render eder, ama bu fonksiyon `data.logoUrl`
 * için (kullanıcının site logosu YERİNE özel bir logo girdiği yol) böyle bir şema kontrolü
 * YAPMIYORDU — yalnızca boş olmadığını kontrol edip doğrudan `src` özniteliğine yazıyordu.
 * `EmailLogoHeaderDataSchema.logoUrl` (schemas/entities.ts) şema seviyesinde de bir URL/şema
 * kısıtı TAŞIMADIĞI için (serbest `z.string().nullable()`), API'yi doğrudan çağıran bir istemci
 * `logoUrl: "javascript:..."` ya da devasa bir `data:` URI yazdırabilirdi. `<img src="javascript:…">`
 * modern tarayıcılarda ÇALIŞTIRILMAZ (bu yüzden XSS DEĞİL), ama tutarsızdır ve `data:` şeması
 * DB/e-posta gövdesini şişirebilir — bu yüzden `renderImage` ile AYNI kısıt burada da uygulanır.
 */
function renderLogoHeader(data: Record<string, unknown>, context: EmailRenderContext): string | null {
  const height = clampNumber(data.height, 16, 120, 48);
  const useSiteLogo = data.useSiteLogo === true;
  const customLogoUrl = typeof data.logoUrl === "string" && /^https?:\/\//i.test(data.logoUrl) ? data.logoUrl : null;
  const url = useSiteLogo ? context.logoUrl : customLogoUrl;
  if (!url) return null;

  return `<img src="${escapeAttr(url)}" height="${height}" alt="${escapeAttr(context.siteName)}" style="display:block;height:${height}px;width:auto;max-width:100%;border:0;" />`;
}

function renderHeading(data: Record<string, unknown>): string {
  const level = data.level === 1 || data.level === 3 ? data.level : 2;
  const fontSize = level === 1 ? 28 : level === 3 ? 18 : 22;
  const text = typeof data.text === "string" ? data.text : "";
  return `<div style="font-size:${fontSize}px;line-height:1.3;font-weight:700;margin:0;">${escapeHtml(text)}</div>`;
}

/** `data.html` — savunma derinliği: yazma yolunda zaten sanitize edilmiş olsa da render'da TEKRAR geçirilir. */
function renderText(data: Record<string, unknown>): string {
  const html = typeof data.html === "string" ? sanitizeEmailRichText(data.html) : "";
  return `<div style="font-size:15px;line-height:1.6;">${html}</div>`;
}

function renderButton(data: Record<string, unknown>): string {
  const label = typeof data.label === "string" ? data.label : "";
  const rawHref = typeof data.href === "string" ? data.href : "";
  const href = isValidButtonHref(rawHref) ? rawHref : "#";
  const backgroundColor = resolveHexColor(data.backgroundColor, "#4f46e5")!;
  const textColor = resolveHexColor(data.textColor, "#ffffff")!;
  const radius = data.radius === "sm" ? 6 : data.radius === "full" ? 999 : 0;

  return `<a href="${escapeAttr(href)}" style="display:inline-block;background-color:${backgroundColor};color:${textColor};padding:12px 24px;border-radius:${radius}px;text-decoration:none;font-weight:600;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(label)}</a>`;
}

/** `data.url` yalnızca http(s) ise render edilir (savunma derinliği — `javascript:`/`data:` asla). */
function renderImage(data: Record<string, unknown>): string | null {
  const url = typeof data.url === "string" ? data.url : "";
  if (!/^https?:\/\//i.test(url)) return null;
  const alt = typeof data.alt === "string" ? data.alt : "";
  const width = typeof data.width === "number" && Number.isFinite(data.width) && data.width > 0 ? Math.round(data.width) : null;

  return `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}"${width ? ` width="${width}"` : ""} style="display:block;max-width:100%;height:auto;border:0;" />`;
}

function renderDivider(data: Record<string, unknown>): string {
  const thickness = data.thickness === 2 || data.thickness === 4 ? data.thickness : 1;
  const color = resolveHexColor(data.color, "#e5e7eb")!;
  return `<hr style="border:none;border-top:${thickness}px solid ${color};margin:0;" />`;
}

/** Kullanıcının EK footer'ı (adres/imza) — zorunlu KVKK footer'ının YERİNE GEÇMEZ (bkz. altta). */
function renderUserFooter(data: Record<string, unknown>): string {
  const text = typeof data.text === "string" ? data.text : "";
  return `<div style="font-size:12px;line-height:1.5;color:#6b7280;">${escapeHtml(text).replace(/\n/g, "<br />")}</div>`;
}

function renderBlockInner(type: unknown, data: Record<string, unknown>, context: EmailRenderContext): string | null {
  switch (type) {
    case "logo-header":
      return renderLogoHeader(data, context);
    case "heading":
      return renderHeading(data);
    case "text":
      return renderText(data);
    case "button":
      return renderButton(data);
    case "image":
      return renderImage(data);
    case "divider":
      return renderDivider(data);
    case "footer":
      return renderUserFooter(data);
    default:
      return null;
  }
}

/**
 * Zorunlu KVKK footer'ı (compliance kancası, BAĞLAYICI — §10.16.4). Kullanıcının `footer`
 * bloğundan BAĞIMSIZ olarak çıktının EN SONUNA eklenir; kullanıcı bunu silemez/kapatamaz.
 * Hiç hukuki sayfa yoksa yalnızca site adı basılır (çağıran taraf bu durumda `app.log.warn` ile
 * ayrıca uyarır — bkz. `email-templates.service.ts::buildEmailRenderContext`).
 *
 * `buildComplianceFooterContent` iki tüketicisi vardır: `renderComplianceFooterRow` (BLOCKS
 * modu — tablo satırı) ve `renderComplianceFooterFragment` (RAW modu — bağımsız `<div>`, bkz.
 * `email-templates.service.ts::sendEmailUsingTemplateRow`). İkisi de AYNI içerikten türer ki
 * RAW şablonlar (WELCOME/PASSWORD_RESET/SYSTEM_ANNOUNCEMENT/ORDER_CONFIRMATION/ORG_INVITATION —
 * bkz. prisma/seed.ts) BLOCKS şablonlarıyla aynı uyum garantisine sahip olsun (compliance-agent
 * denetimi: RAW şablonlar `renderEmailBlocksToHtml`'i HİÇ ÇAĞIRMAZ, footer önceden yalnızca
 * BLOCKS moduna eklenmişti — bu boşluk kapatıldı).
 */
function buildComplianceFooterContent(context: EmailRenderContext): string {
  const siteNameHtml = escapeHtml(context.siteName);
  const legalLinksHtml = context.legalPages
    .map((page) => `<a href="${escapeAttr(page.url)}" style="color:#6b7280;text-decoration:underline;">${escapeHtml(page.title)}</a>`)
    .join(" &middot; ");

  return legalLinksHtml ? `${siteNameHtml}<br />${legalLinksHtml}` : siteNameHtml;
}

function renderComplianceFooterRow(context: EmailRenderContext): string {
  const content = buildComplianceFooterContent(context);
  return `<tr><td style="padding:24px 16px;text-align:center;font-size:12px;line-height:1.6;color:#9ca3af;font-family:Arial,Helvetica,sans-serif;border-top:1px solid #e5e7eb;">${content}</td></tr>`;
}

/**
 * RAW modu (§10.3'ten devralınan ham HTML şablonları) tablo düzeninde DEĞİLDİR — bu yüzden
 * `renderComplianceFooterRow`'un `<tr><td>` çıktısı doğrudan eklenemez. Aynı görsel/metinsel
 * içeriği bağımsız bir `<div>` olarak üretir; `sendEmailUsingTemplateRow` ve
 * `renderTemplatePreviewOrTest` (RAW dalı) bunu render edilmiş `bodyHtml`'in SONUNA ekler.
 */
export function renderComplianceFooterFragment(context: EmailRenderContext): string {
  const content = buildComplianceFooterContent(context);
  return `<div style="margin-top:24px;padding:24px 16px;text-align:center;font-size:12px;line-height:1.6;color:#9ca3af;font-family:Arial,Helvetica,sans-serif;border-top:1px solid #e5e7eb;">${content}</div>`;
}

function wrapEmailDocument(rowsHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f3f4f6;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;">
            ${rowsHtml}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * `blocks` (istemciden gelen/zod ile doğrulanmış yapısal veri, ya da DB'deki kayıtlı `Json`)
 * → satır-içi stilli, tablo-tabanlı e-posta HTML'i. `{{key}}` değişken kalıpları render
 * EDİLMEDEN çıktıda kalır (bkz. modül başlığı).
 *
 * Bilinmeyen/bozuk bir blok şekli (örn. Prisma `Json`'dan gelen eski/kısmi veri) SESSİZCE
 * ATLANIR — `seo-score.ts`/`sanitize-blocks.ts` ile AYNI savunmacı yaklaşım.
 */
export function renderEmailBlocksToHtml(blocks: unknown[], context: EmailRenderContext): string {
  const rows: string[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    const data = (b.data && typeof b.data === "object" ? b.data : {}) as Record<string, unknown>;
    const inner = renderBlockInner(b.type, data, context);
    if (inner === null) continue;

    const resolvedStyle = resolveContainerStyle(b.style);
    rows.push(`<tr><td style="${cellStyle(resolvedStyle)}">${inner}</td></tr>`);
  }

  rows.push(renderComplianceFooterRow(context));

  return wrapEmailDocument(rows.join(""));
}
