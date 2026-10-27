"use client";

import { Suspense, useState, type FormEvent } from "react";
import { AuthLink } from "@/components/auth/auth-link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { fieldErrorsFrom } from "@/lib/api/friendly-error";
import { useFriendlyError, useLocalizedFieldErrors } from "@/lib/i18n/use-portal-strings";
import { useAuthStrings } from "@/lib/i18n/use-auth-strings";
import { isSafeInternalPath } from "@/lib/safe-redirect";
import { PasswordField, passwordPolicyMessage } from "@/components/auth/password-field";

function RegisterForm() {
  const { register } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const authStrings = useAuthStrings();
  const t = authStrings.register;
  const friendlyErrorMessage = useFriendlyError();
  const localizeFieldErrors = useLocalizedFieldErrors();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      // `.claude/architect-scope-guest-account-otp.md` §2.1/§8.1 (bağlayıcı) — `register()`
      // ARTIK oturum KURMAZ, `/dashboard`e yönlendirme YOKTUR. Kullanıcı `/verify-email`e
      // gider; `resendAvailableAt`/`expiresAt` orada kod gönderiliş anına göre geri sayım/hint
      // göstermek için taşınır, `?next` VARSA korunur.
      const result = await register({ name, email, password });
      const query = new URLSearchParams({
        email: result.email,
        resendAvailableAt: result.resendAvailableAt,
        expiresAt: result.expiresAt,
      });
      if (isSafeInternalPath(next)) query.set("next", next);
      router.replace(`/verify-email?${query.toString()}`);
    } catch (err) {
      // Paket S — şifre politikası ihlali: sunucunun kural kodları aktif dilde.
      const policy = passwordPolicyMessage(err, authStrings.passwordRules);
      setFieldErrors(policy ? { password: policy } : localizeFieldErrors(fieldErrorsFrom(err)));
      setError(policy ? null : friendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      {error && <Alert variant="error">{error}</Alert>}

      <Field id="name" label={t.name} error={fieldErrors.name} required>
        {(inputProps) => (
          <Input {...inputProps} autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
        )}
      </Field>

      <Field id="email" label={t.email} error={fieldErrors.email} required>
        {(inputProps) => (
          <Input
            {...inputProps}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
      </Field>

      <PasswordField
        id="password"
        label={t.password}
        error={fieldErrors.password}
        hint={t.passwordHint}
        required
        value={password}
        context={{ email, name }}
        strings={authStrings.passwordRules}
        inputProps={{ value: password, onChange: (e) => setPassword(e.target.value) }}
      />

      <Button type="submit" className="w-full" loading={submitting}>
        {t.submit}
      </Button>
    </form>
  );
}

export default function RegisterPage() {
  const t = useAuthStrings().register;
  return (
    <AuthPageShell
      title={t.title}
      subtitle={t.subtitle}
      footer={
        <>
          {t.haveAccount}{" "}
          <AuthLink href="/login" className="font-medium text-primary hover:underline">
            {t.loginLink}
          </AuthLink>
        </>
      }
    >
      <Suspense fallback={<Spinner className="h-5 w-5 text-primary" />}>
        <RegisterForm />
      </Suspense>
    </AuthPageShell>
  );
}
