/**
 * §10.16.1/§10.16.5 — özel değişken anahtarı `^[a-z][a-z0-9_]{0,39}$` (backend
 * `EMAIL_CUSTOM_VARIABLE_KEY_PATTERN`) ile doğrulanır. İstemci, kullanıcının girdiği (Türkçe
 * olabilen) etiketten bu deseni sağlayan ASCII bir anahtar önerir (backend `slugify`'ın istemci
 * tarafı ön izleme eşdeğeri — bkz. `components/admin/blog/category-select.tsx`).
 */
export const CUSTOM_VARIABLE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export function slugifyVariableKey(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/ç/g, "c")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

  if (!base) return "";
  // Anahtar bir HARFLE başlamalıdır — rakamla başlıyorsa önüne "v" eklenir.
  return /^[a-z]/.test(base) ? base : `v${base}`.slice(0, 40);
}
