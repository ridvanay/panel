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
const RESERVED_PREFIXES = ["meet-", "doctor:", "patient:", "interpreter:", "qa-listener-"];

export type GuestNameResult = { ok: true; name: string } | { ok: false; reason: string };

export function normalizeGuestName(input: string): GuestNameResult {
  const nfc = input.normalize("NFC");
  if (FORBIDDEN_CODE_POINTS.test(nfc)) return { ok: false, reason: "Ad görünmez veya kontrol karakteri içeremez." };
  const name = nfc.trim().replace(/\s+/g, " ");
  const length = [...name].length;
  if (length < 2 || length > 40) return { ok: false, reason: "Ad 2 ile 40 karakter arasında olmalıdır." };
  if (!ALLOWED.test(name)) return { ok: false, reason: "Ad yalnızca harf, rakam, boşluk, nokta, kesme işareti ve tire içerebilir." };
  const lower = name.toLocaleLowerCase("en");
  if (RESERVED_PREFIXES.some((prefix) => lower.startsWith(prefix))) return { ok: false, reason: "Bu ad kullanılamaz." };
  return { ok: true, name };
}
