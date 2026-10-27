/**
 * Paket S (2026-10-27) — şifre politikası, TEK kural seti. Backend (`backend/src/lib/password-policy.ts`)
 * asıl kontrolü yapar; frontend kopyası (`frontend/src/lib/password-policy.ts`, içerik BİREBİR AYNI)
 * yalnızca canlı rehberlik içindir. Kurallar yalnızca YENİ şifre belirlenirken uygulanır (kayıt,
 * sıfırlama, hesap etkinleştirme, şifre değiştirme, admin'in şifre belirlemesi); giriş ekranında
 * uygulanmaz, mevcut şifreler geçersiz sayılmaz.
 *
 *  - 10–128 karakter (Unicode kod noktası).
 *  - Dört gruptan en az üçü: küçük harf, büyük harf, rakam, sembol (Türkçe ve diğer alfabeler harf sayılır).
 *  - Yalnızca rakam olamaz.
 *  - Ardışık/tekrarlı diziler (12345, abcde, qwerty, 11111, aaaaa) şifrenin yarısından fazlası olamaz.
 *  - Yaygın şifre listesinde olamaz (büyük/küçük harf duyarsız; baştaki/sondaki rakam ve semboller atılarak da).
 *  - E-postanın `@` öncesi kısmını ya da kullanıcının adını içeremez.
 */
import { COMMON_PASSWORDS, EXTRA_COMMON_PASSWORDS } from "./common-passwords";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_MIN_GROUPS = 3;

export const PASSWORD_RULES = ["length", "groups", "notDigitsOnly", "noSequence", "notCommon", "notPersonal"] as const;
export type PasswordRule = (typeof PASSWORD_RULES)[number];

export interface PasswordContext {
  email?: string | null;
  name?: string | null;
}

export interface PasswordCheck {
  /** Her kuralın sağlanıp sağlanmadığı. */
  rules: Record<PasswordRule, boolean>;
  failed: PasswordRule[];
  /** Bulunan karakter grubu sayısı (0–4). */
  groups: number;
  /** Güç göstergesi 0–4 (kurallardan bağımsız bir rehber; geçerlilik `failed.length === 0`). */
  score: 0 | 1 | 2 | 3 | 4;
}

/** Türkçe büyük/küçük harf + aksan + uyumluluk biçimi (tam genişlik vb., NFKC) duyarsız karşılaştırma için. */
function fold(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i");
}

function countGroups(chars: string[]): number {
  let lower = false;
  let upper = false;
  let digit = false;
  let symbol = false;
  for (const ch of chars) {
    if (/\p{Lu}|\p{Lt}/u.test(ch)) upper = true;
    else if (/\p{Ll}|\p{Lo}|\p{Lm}/u.test(ch)) lower = true;
    else if (/\p{Nd}/u.test(ch)) digit = true;
    else symbol = true;
  }
  return [lower, upper, digit, symbol].filter(Boolean).length;
}

const KEYBOARD_ROWS = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm", "qwertzuiop", "azertyuiop", "qwertyuıopğü", "asdfghjklşi", "zxcvbnmöç"];

/** İki ardışık karakterin ilişkisi: tekrar, +1/−1 (alfabe/rakam) ya da klavye satırında komşu. */
function relation(a: string, b: string): string | null {
  if (a === b) return "rep";
  const ca = a.codePointAt(0)!;
  const cb = b.codePointAt(0)!;
  if (/[\p{L}\p{Nd}]/u.test(a) && /[\p{L}\p{Nd}]/u.test(b)) {
    if (cb - ca === 1) return "+1";
    if (cb - ca === -1) return "-1";
  }
  for (const row of KEYBOARD_ROWS) {
    const ia = row.indexOf(a);
    const ib = row.indexOf(b);
    if (ia >= 0 && ib >= 0) {
      if (ib - ia === 1) return `kb+${row}`;
      if (ib - ia === -1) return `kb-${row}`;
    }
  }
  return null;
}

/** Ardışık/tekrarlı dizilere (en az 3 karakter) düşen karakter sayısı. */
export function sequenceCharCount(password: string): number {
  const chars = [...password.toLocaleLowerCase("tr-TR")];
  const marked = new Array<boolean>(chars.length).fill(false);
  let runStart = 0;
  let runRel: string | null = null;
  const close = (end: number) => {
    // `runStart..end` karakterleri aynı ilişkiyle bağlı; en az 3 karakterse işaretle.
    if (runRel && end - runStart + 1 >= 3) for (let k = runStart; k <= end; k++) marked[k] = true;
  };
  for (let i = 1; i < chars.length; i++) {
    const rel = relation(chars[i - 1]!, chars[i]!);
    if (rel && rel === runRel) continue;
    close(i - 1);
    runRel = rel;
    runStart = i - 1;
  }
  close(chars.length - 1);
  return marked.filter(Boolean).length;
}

function isCommon(password: string): boolean {
  // NFKC: tam genişlikli/uyumluluk biçimli karakterler (ör. "Ｐａｓｓｗｏｒｄ１") listeyi aşamasın.
  const normalized = password.normalize("NFKC");
  const lower = normalized.toLocaleLowerCase("tr-TR");
  const plain = normalized.toLowerCase();
  const strip = (s: string) => s.replace(/^[\p{Nd}\p{P}\p{S}\s]+|[\p{Nd}\p{P}\p{S}\s]+$/gu, "");
  const candidates = [lower, plain, strip(lower), strip(plain), fold(strip(lower))].filter((c) => c.length >= 4 || c === lower);
  return candidates.some((c) => COMMON_PASSWORDS.has(c) || EXTRA_COMMON_PASSWORDS.has(c));
}

function containsPersonal(password: string, context: PasswordContext): boolean {
  const pw = fold(password);
  const needles = new Set<string>();
  const local = context.email?.split("@")[0] ?? "";
  if (fold(local).length >= 3) needles.add(fold(local));
  for (const part of fold(local).split(/[._+\-\d]+/)) if (part.length >= 4) needles.add(part);
  for (const part of fold(context.name ?? "").split(/[^\p{L}]+/u)) if (part.length >= 3) needles.add(part);
  return [...needles].some((needle) => pw.includes(needle));
}

export function checkPassword(password: string, context: PasswordContext = {}): PasswordCheck {
  const chars = [...password];
  const groups = countGroups(chars);
  const rules: Record<PasswordRule, boolean> = {
    length: chars.length >= PASSWORD_MIN_LENGTH && chars.length <= PASSWORD_MAX_LENGTH,
    groups: groups >= PASSWORD_MIN_GROUPS,
    notDigitsOnly: chars.length > 0 && !/^\p{Nd}+$/u.test(password),
    noSequence: chars.length > 0 && sequenceCharCount(password) * 2 <= chars.length,
    notCommon: chars.length > 0 && !isCommon(password),
    notPersonal: chars.length > 0 && !containsPersonal(password, context),
  };
  const failed = PASSWORD_RULES.filter((rule) => !rules[rule]);
  let score = 0;
  if (chars.length > 0) {
    if (failed.length === 0) score = chars.length >= 14 && groups === 4 ? 4 : 3;
    else {
      // Yaygın/kişisel/yalnızca rakam şifre "çok zayıf"; diğer eksikler "zayıf".
      const hard = failed.some((r) => r === "notCommon" || r === "notPersonal" || r === "notDigitsOnly");
      score = Math.min([rules.length, rules.groups, rules.noSequence].filter(Boolean).length, hard ? 1 : 2);
    }
  }
  return { rules, failed, groups, score: Math.min(4, Math.max(0, score)) as PasswordCheck["score"] };
}
