/**
 * Bayt cinsinden bir dosya boyutunu okunaklı bir birime çevirir — PDF döküman kartında
 * `Media.sizeBytes` için kullanılır (bkz. `.claude/design-notes-ecommerce-storefront.md` §8).
 * Basamak: `< 1024` → "{n} B", `< 1024²` → "{n/1024, 1 ondalık} KB", üstü → "{n/1024², 1 ondalık} MB".
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
