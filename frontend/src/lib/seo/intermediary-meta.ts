/**
 * Paket AH — meta description (aracı kuruluş vurgusu): `dict.intermediary.description`'ın ilk cümlesi
 * ("WM Health is an international health tourism intermediary organization, not a healthcare provider.").
 * Tam açıklama uzun (SEO için ~160 karakter hedeflenir); ilk cümle kimlik vurgusunu taşır. Cümle sınırı
 * bulunamazsa metin ~200 karakterde kesilir.
 */
export function intermediaryMetaDescription(description: string): string {
  const text = description.trim();
  const match = /^(.+?[.!?。۔])(?:\s|$)/.exec(text);
  const sentence = match?.[1] ?? text;
  return sentence.length <= 200 ? sentence : `${sentence.slice(0, 197).trimEnd()}…`;
}
