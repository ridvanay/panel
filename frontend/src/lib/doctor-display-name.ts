/**
 * Paket U (C1, 2026-10-28) — doktor adının ziyaretçiye açık gösterimi. Aynı mantığın API kopyası (tek kaynak):
 * `backend/src/lib/doctor-display-name.ts`; bu kopya admin formundaki canlı önizleme için — İKİSİ AYNI KALMALI
 * (her iki tarafta aynı örneklerle test edilir).
 *
 * Kural:
 *  1. `publicName` doluysa o gösterilir (elle düzeltme).
 *  2. Kurucu (`isFounder`) tam adla gösterilir.
 *  3. Diğerleri: ad baş harfleri + soyad. Soyad, `fullName` içinde tamamı BÜYÜK yazılmış kelimelerdir
 *     ("Ayşe Zehra ÖZDEMİR KAYA" → "ÖZDEMİR KAYA"); yoksa son kelime. Tamamı büyük soyad Türkçe
 *     kurallarıyla küçültülür ve her (tireli) parçanın yalnızca ilk harfi büyük kalır ("YILDIRIM" →
 *     "Yıldırım"). Zaten karışık yazılmış soyad olduğu gibi kalır ("Türkmen").
 *  Unvan (`title`) bu fonksiyona dahil DEĞİLDİR; çağıran taraf mevcut (çevrilmiş) unvanı başa ekler.
 *  `fullName` veritabanında DEĞİŞMEZ; admin, CRM, audit ve doktorun kendi portalı tam adı görür.
 */
export interface DoctorNameSource {
  fullName: string;
  isFounder?: boolean | null;
  publicName?: string | null;
}

const LOCALE = "tr";

function hasLetters(word: string): boolean {
  return (word.match(/\p{L}/gu) ?? []).length >= 2;
}

function isAllCaps(word: string): boolean {
  return hasLetters(word) && word === word.toLocaleUpperCase(LOCALE) && word !== word.toLocaleLowerCase(LOCALE);
}

/** Tamamı büyük harfli kelimeyi Türkçe kurallarla "Baş harfi büyük" yazar; tireli parçalar ayrı ayrı. */
function formatSurnameWord(word: string): string {
  if (!isAllCaps(word)) return word;
  return word
    .split("-")
    .map((part) => (part ? part.charAt(0).toLocaleUpperCase(LOCALE) + part.slice(1).toLocaleLowerCase(LOCALE) : part))
    .join("-");
}

export function abbreviateDoctorName(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words.map(formatSurnameWord).join("");
  const capsIndexes = words.map((w, i) => (isAllCaps(w) ? i : -1)).filter((i) => i >= 0);
  const surnameIdx = capsIndexes.length > 0 && capsIndexes.length < words.length ? capsIndexes : [words.length - 1];
  const given = words.filter((_, i) => !surnameIdx.includes(i));
  const surname = surnameIdx.map((i) => formatSurnameWord(words[i]!)).join(" ");
  const initials = given.map((w) => `${w.charAt(0).toLocaleUpperCase(LOCALE)}.`).join(" ");
  return initials ? `${initials} ${surname}` : surname;
}

export function doctorDisplayName(doctor: DoctorNameSource): string {
  const manual = doctor.publicName?.trim();
  if (manual) return manual;
  const full = doctor.fullName.trim().replace(/\s+/g, " ");
  if (doctor.isFounder) return full;
  return abbreviateDoctorName(full);
}

/**
 * Ziyaretçi bileşenleri için: API'nin hazırladığı görünen ad (`displayName`). Public yanıtlarda
 * `fullName` da zaten görünen addır (sunucu kısaltır); eski yanıt biçimine karşı yedek olarak kullanılır.
 */
export function publicDoctorName(doctor: { displayName?: string; fullName: string }): string {
  return doctor.displayName ?? doctor.fullName;
}
