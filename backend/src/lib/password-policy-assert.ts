import { ValidationError } from "./errors";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, checkPassword, type PasswordContext, type PasswordRule } from "./password-policy";

/**
 * Paket S — şifre politikası ihlalinde `422 VALIDATION_ERROR`. `details[field]` Türkçe mesajlar
 * (mevcut form hata gösterimi), `details.passwordRules` kural kodları — frontend bunları site
 * sözlüğünden 6 dile çevirir (`auth.passwordRules.*`).
 */
export const PASSWORD_RULE_MESSAGES_TR: Record<PasswordRule, string> = {
  length: `Şifre ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} karakter olmalı.`,
  groups: "Şifre küçük harf, büyük harf, rakam ve sembolden en az üçünü içermeli.",
  notDigitsOnly: "Şifre yalnızca rakamlardan oluşamaz.",
  noSequence: "Şifrenin çoğu ardışık ya da tekrarlı karakterlerden oluşamaz (ör. 123456, abcdef, qwerty, aaaaaa).",
  notCommon: "Bu şifre çok yaygın; tahmin edilmesi kolay.",
  notPersonal: "Şifre e-posta adresinizi ya da adınızı içeremez.",
};

export function assertPasswordPolicy(password: string, context: PasswordContext, field = "password"): void {
  const { failed } = checkPassword(password, context);
  if (failed.length === 0) return;
  throw new ValidationError(PASSWORD_RULE_MESSAGES_TR[failed[0]!], {
    [field]: failed.map((rule) => PASSWORD_RULE_MESSAGES_TR[rule]),
    passwordRules: failed,
  });
}
