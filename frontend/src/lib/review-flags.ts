/** ISO-2 kodu → bayrak emojisi (bölgesel gösterge çifti). Geçersiz kodda boş string. */
export function countryFlag(code: string | null | undefined): string {
  if (!code || !/^[a-z]{2}$/i.test(code)) return "";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Ad → en çok 2 baş harf; çözülemezse `null` (çağıran simge gösterir). */
export function reviewInitials(name: string | null): string | null {
  if (!name) return null;
  const letters = name
    .trim()
    .split(/\s+/)
    .map((part) => [...part.replace(/[^\p{L}\p{N}]/gu, "")][0] ?? "")
    .filter(Boolean)
    .slice(0, 2)
    .join("");
  return letters ? letters.toLocaleUpperCase() : null;
}
