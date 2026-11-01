/**
 * Paket Z1 — yazı içindekiler tablosu (saf fonksiyon, DOM'suz; sunucuda çalışır).
 * `<h2>`/`<h3>` başlıklarından liste üretir ve her başlığa (yoksa) benzersiz bir `id` ekler.
 * Türkçe, Arapça, Kiril gibi harfler korunur (Unicode \p{L}); tekrar eden başlıklara `-2`, `-3` eklenir.
 */
export interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

const HEADING_RE = /<h([23])((?:\s[^>]*)?)>([\s\S]*?)<\/h\1>/gi;
const ID_ATTR_RE = /\sid\s*=\s*("([^"]*)"|'([^']*)')/i;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

export function headingText(innerHtml: string): string {
  return decodeEntities(innerHtml.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Başlık metninden id: küçük harf, harf/rakam korunur, kalan her şey tek `-`. */
export function slugifyHeading(text: string): string {
  const slug = text
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

export function buildToc(html: string): { html: string; items: TocItem[] } {
  if (!html) return { html: "", items: [] };
  const used = new Set<string>();
  // Önce var olan id'leri ayır ki üretilen id'ler onlarla çakışmasın.
  for (const match of html.matchAll(HEADING_RE)) {
    const existing = ID_ATTR_RE.exec(match[2] ?? "");
    const value = existing?.[2] ?? existing?.[3];
    if (value) used.add(value);
  }
  const items: TocItem[] = [];
  const out = html.replace(HEADING_RE, (full, levelRaw: string, attrs: string, inner: string) => {
    const text = headingText(inner);
    if (!text) return full;
    const level = (levelRaw === "2" ? 2 : 3) as 2 | 3;
    const existing = ID_ATTR_RE.exec(attrs);
    const existingId = existing?.[2] ?? existing?.[3];
    if (existingId) {
      items.push({ id: existingId, text, level });
      return full;
    }
    const base = slugifyHeading(text);
    let id = base;
    let n = 2;
    while (used.has(id)) {
      id = `${base}-${n}`;
      n += 1;
    }
    used.add(id);
    items.push({ id, text, level });
    return `<h${levelRaw}${attrs} id="${id}">${inner}</h${levelRaw}>`;
  });
  return { html: out, items };
}

/**
 * Yazının ortasına kart koymak için güvenli bölme: yalnızca üst düzey `<h2` başlangıçlarında bölünür
 * (HTML'i asla bir tablo ya da liste içinde kesmez). En az 2 H2 yoksa bölünmez.
 */
export function splitAtMiddleHeading(html: string): [string, string] | null {
  const positions: number[] = [];
  const re = /<h2[\s>]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) positions.push(m.index);
  if (positions.length < 2) return null;
  const at = positions[Math.floor(positions.length / 2)]!;
  return [html.slice(0, at), html.slice(at)];
}
