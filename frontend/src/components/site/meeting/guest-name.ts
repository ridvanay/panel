/**
 * Paket AG İş 3 — misafir görünen adı doğrulaması (tasarım §6.5). SAF yardımcı; sunucudaki kuralın birebir aynasıdır
 * (sunucu bağlayıcıdır, bu yalnızca anında geri bildirim içindir).
 */
export type GuestNameProblem = "tooShort" | "tooLong" | "invalidChars" | "reservedPrefix";

export type GuestNameResult = { ok: true; value: string } | { ok: false; reason: GuestNameProblem };

export const GUEST_NAME_MIN = 2;
export const GUEST_NAME_MAX = 40;

/** İzin verilen biçim: harf/işaret ile başlar; sonra harf, işaret, rakam, boşluk, nokta, kesme, tire. */
const ALLOWED = /^[\p{L}\p{M}][\p{L}\p{M}\p{Nd} .'\-]{1,39}$/u;
/** C0/C1 kontrol, sıfır genişlikli/yön işaretleri, bidi geçersiz kılma ve izolasyon karakterleri. */
const FORBIDDEN = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/u;
/** `participant-label.ts` kimlik önekleriyle karışmasın. */
const RESERVED_PREFIXES = ["meet-", "doctor:", "patient:", "interpreter:", "qa-listener-"];

/** NFC, baş/son boşluk kırpma, iç boşlukları teke indirme (boşluk benzeri karakterler dahil, kontrol karakterlerine dokunmaz). */
export function normalizeGuestName(input: string): string {
  return input.normalize("NFC").replace(/[ \t\r\n\f\v ]+/g, " ").trim();
}

export function validateGuestName(input: string): GuestNameResult {
  const value = normalizeGuestName(input);
  const length = [...value].length;
  if (length < GUEST_NAME_MIN) return { ok: false, reason: "tooShort" };
  if (length > GUEST_NAME_MAX) return { ok: false, reason: "tooLong" };
  if (FORBIDDEN.test(value)) return { ok: false, reason: "invalidChars" };
  // Rezerve önek, genel karakter kuralından önce denetlenir ("doctor:1" için daha açıklayıcı mesaj); ikisi de sunucuda reddedilir.
  const lower = value.toLowerCase();
  if (RESERVED_PREFIXES.some((prefix) => lower.startsWith(prefix))) return { ok: false, reason: "reservedPrefix" };
  if (!ALLOWED.test(value)) return { ok: false, reason: "invalidChars" };
  return { ok: true, value };
}
