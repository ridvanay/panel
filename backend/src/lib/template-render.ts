/**
 * §10.3 E-posta & Bildirim Şablonu Yöneticisi — allow-list'e dayalı, güvenli değişken
 * render'ı. Bir template engine / `eval` KULLANILMAZ (enjeksiyon riski, bkz. ARCHITECTURE.md §10.3).
 * Yalnızca `allowedKeys` içindeki `{{key}}` kalıpları değiştirilir; eşleşmeyen (ya da
 * allow-list dışı) kalıplar OLDUĞU GİBİ bırakılır. Değerler HTML-escape edilerek basılır.
 */

const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderTemplate(template: string, values: Record<string, string>, allowedKeys: string[]): string {
  const allowed = new Set(allowedKeys);

  return template.replace(PLACEHOLDER_PATTERN, (match, key: string) => {
    if (!allowed.has(key) || !(key in values)) return match;
    return escapeHtml(values[key]!);
  });
}
