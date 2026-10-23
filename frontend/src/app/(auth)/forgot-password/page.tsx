"use client";

import { useState, type FormEvent } from "react";
import { AuthLink } from "@/components/auth/auth-link";
import * as authApi from "@/lib/api/auth";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useFriendlyError } from "@/lib/i18n/use-portal-strings";
import { useAuthStrings } from "@/lib/i18n/use-auth-strings";

export default function ForgotPasswordPage() {
  const t = useAuthStrings().forgot;
  const friendlyErrorMessage = useFriendlyError();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authApi.forgotPassword(email);
      // Backend, e-posta var/yok fark etmeksizin her zaman 202 döner (enumeration önleme).
      setSubmitted(true);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPageShell
      title={t.title}
      subtitle={t.subtitle}
      footer={
        <AuthLink href="/login" className="font-medium text-primary hover:underline">
          {t.backToLogin}
        </AuthLink>
      }
    >
      {submitted ? (
        <Alert variant="success">{t.sentNotice}</Alert>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          {error && <Alert variant="error">{error}</Alert>}
          <Field id="email" label={t.email} required>
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
          <Button type="submit" className="w-full" loading={submitting}>
            {t.submit}
          </Button>
        </form>
      )}
    </AuthPageShell>
  );
}
