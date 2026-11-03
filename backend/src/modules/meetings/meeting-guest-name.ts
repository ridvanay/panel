/**
 * Paket AG (İş 3) — misafir görünen adı doğrulaması (sunucu bağlayıcıdır; istemci aynı kuralları gösterir).
 * Ad yalnızca React metin düğümü olarak render edilir (`dangerouslySetInnerHTML` yok), e-postaya konmaz.
 *
 * Kurallar: NFC normalize → kontrol/biçim karakterleri (Cc, Cf: sıfır genişlik, bidi geçersiz kılma vb.) yasak →
 * baş/son boşluk kırp + iç boşlukları teke indir → 2–40 kod noktası → `^[\p{L}\p{M}][\p{L}\p{M}\p{Nd} .'’\-]{1,39}$`
 * → katılımcı kimliği önekleriyle başlayamaz (etiketleme karışmasın).
 */
const FORBIDDEN_CODE_POINTS = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/u;
const ALLOWED = /^[\p{L}\p{M}][\p{L}\p{M}\p{Nd} .'’-]{1,39}$/u;
// "patient coordinator" / "coordinator": hasta koordinatörü etiketi taklit edilemez (AI İş 3).
const RESERVED_PREFIXES = ["meet-", "doctor:", "patient:", "interpreter:", "qa-listener-", "patient coordinator", "coordinator"];

/**
 * Taklit korumasi (AI Is 3): NFKC + harf disi her seyi at + kucuk harfe katla (+ yaygin Kiril/Yunan benzer harfleri Latin'e esle);
 * sonuc personel/kurum etiketlerinden birini ICERIYORSA ad reddedilir (basta olmasi sart degil: "Ayse (Coordinator)" de yakalanir).
 */
const IMPERSONATION_FRAGMENTS = ["coordinator", "koordinat", "wmhealth", "support", "admin"];
const CONFUSABLES: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "к": "k", "м": "m", "т": "t", "н": "h", "в": "b", "і": "i", "ѕ": "s", "ј": "j", "ԁ": "d", "ɡ": "g",
  "ο": "o", "α": "a", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ρ": "p", "τ": "t", "υ": "u", "χ": "x",
  "ı": "i",
};

export function foldForImpersonation(name: string): string {
  const letters = name.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}]/gu, "");
  return [...letters].map((ch) => CONFUSABLES[ch] ?? ch).join("");
}

export type GuestNameResult = { ok: true; name: string } | { ok: false; reason: string };

export function normalizeGuestName(input: string): GuestNameResult {
  const nfc = input.normalize("NFC");
  if (FORBIDDEN_CODE_POINTS.test(nfc)) return { ok: false, reason: "The name cannot contain invisible or control characters." };
  const name = nfc.trim().replace(/\s+/g, " ");
  const length = [...name].length;
  if (length < 2 || length > 40) return { ok: false, reason: "The name must be between 2 and 40 characters." };
  if (!ALLOWED.test(name)) return { ok: false, reason: "The name can only contain letters, digits, spaces, dots, apostrophes and hyphens." };
  const lower = name.toLocaleLowerCase("en");
  if (RESERVED_PREFIXES.some((prefix) => lower.startsWith(prefix))) return { ok: false, reason: "This name cannot be used." };
  const folded = foldForImpersonation(name);
  if (IMPERSONATION_FRAGMENTS.some((fragment) => folded.includes(fragment))) return { ok: false, reason: "This name cannot be used." };
  return { ok: true, name };
}
