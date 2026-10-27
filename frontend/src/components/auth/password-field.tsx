"use client";

import { useId, useState, type InputHTMLAttributes } from "react";
import { Check, Circle, Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ApiClientError } from "@/lib/api/error";
import { PASSWORD_RULES, checkPassword, type PasswordContext, type PasswordRule } from "@/lib/password-policy";
import type { AuthStrings } from "@/lib/i18n/site-dictionaries/en/auth";

/**
 * Paket S — yeni şifre alanı: "Şifreyi göster" düğmesi, canlı kural listesi ve güç göstergesi.
 * Kurallar `lib/password-policy.ts`ten (backend kural setinin birebir kopyası) gelir; asıl kontrol
 * sunucudadır, burası yalnızca rehberlik eder. Kontrollü (`value`/`onChange`) ya da react-hook-form
 * (`inputProps` içinde `register(...)`) ile kullanılabilir; `value` her durumda kurallar için verilir.
 */
export type PasswordRuleStrings = AuthStrings["passwordRules"];

const LEVEL_TONES = ["bg-danger", "bg-danger", "bg-warning", "bg-success/80", "bg-success"] as const;

export function PasswordField({
  id,
  label,
  value,
  error,
  hint,
  required,
  context,
  strings,
  inputProps,
  showRules = true,
}: {
  id: string;
  label: string;
  /** Kurallar için güncel değer (RHF'de `watch(...)`). */
  value: string;
  error?: string;
  hint?: string;
  required?: boolean;
  context?: PasswordContext;
  strings: PasswordRuleStrings;
  /** `Input`'a aktarılacak ek öznitelikler (ör. `register("newPassword")` ya da `value`/`onChange`). */
  inputProps?: InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> };
  showRules?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const rulesId = useId();
  const check = checkPassword(value, context);
  const describedBy = [error ? `${id}-error` : hint ? `${id}-hint` : null, showRules ? rulesId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1.5" data-testid={`password-field-${id}`}>
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <div className="relative">
        <Input
          autoComplete="new-password"
          {...inputProps}
          id={id}
          type={visible ? "text" : "password"}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={[describedBy, inputProps?.["aria-describedby"]].filter(Boolean).join(" ") || undefined}
          className="pe-10"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          // Etiket duruma göre değişir ("Şifreyi göster"/"Şifreyi gizle"); ayrıca aria-pressed kullanılmaz.
          aria-label={visible ? strings.hide : strings.show}
          aria-controls={id}
          className="absolute inset-y-0 end-0 flex w-10 items-center justify-center text-foreground/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-xs text-foreground/60">
            {hint}
          </p>
        )
      )}
      {showRules && (
        <div id={rulesId} className="space-y-1.5 pt-0.5">
          <div className="flex items-center gap-2" aria-live="polite">
            <div className="flex flex-1 gap-1" aria-hidden="true">
              {[1, 2, 3, 4].map((i) => (
                <span key={i} className={cn("h-1.5 flex-1 rounded-full", value && check.score >= i ? LEVEL_TONES[check.score] : "bg-muted")} />
              ))}
            </div>
            <span className="min-w-16 text-end text-xs text-foreground/70" data-testid="password-strength">
              {value ? `${strings.strength}: ${strings.levels[check.score]}` : ""}
            </span>
          </div>
          <p className="text-xs font-medium text-foreground/70">{strings.rulesTitle}</p>
          <ul className="space-y-0.5 text-xs">
            {PASSWORD_RULES.map((rule) => {
              const ok = value.length > 0 && check.rules[rule];
              return (
                <li key={rule} data-rule={rule} data-ok={ok} className={cn("flex items-start gap-1.5", ok ? "text-success" : "text-foreground/60")}>
                  {ok ? <Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /> : <Circle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />}
                  <span>
                    <span className="sr-only">{ok ? "✓ " : "✗ "}</span>
                    {strings[rule]}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Sunucunun döndürdüğü kural kodlarını (`error.details.passwordRules`) aktif dilde tek bir mesaja
 * çevirir; şifre politikası hatası değilse `null`.
 */
export function passwordPolicyMessage(err: unknown, strings: PasswordRuleStrings): string | null {
  if (!(err instanceof ApiClientError)) return null;
  const codes = (err.details?.passwordRules ?? []).filter((code): code is PasswordRule => (PASSWORD_RULES as readonly string[]).includes(code));
  if (codes.length === 0) return null;
  // Arapçada noktalı virgül "؛" (inceleme bulgusu).
  const separator = /[\u0600-\u06FF]/.test(strings.serverInvalid) ? "؛ " : "; ";
  return strings.serverInvalid.replace("{rules}", codes.map((code) => strings[code].charAt(0).toLocaleLowerCase() + strings[code].slice(1)).join(separator));
}
