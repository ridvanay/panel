"use client";

import { Suspense, useState, type FormEvent } from "react";
import { AuthLink } from "@/components/auth/auth-link";
import { useRouter, useSearchParams } from "next/navigation";
import * as authApi from "@/lib/api/auth";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { useFriendlyError } from "@/lib/i18n/use-portal-strings";
import { useAuthStrings } from "@/lib/i18n/use-auth-strings";

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const t = useAuthStrings().reset;
  const friendlyErrorMessage = useFriendlyError();

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authApi.resetPassword(token, password);
      router.replace("/login");
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return <Alert variant="error">{t.invalidLink}</Alert>;
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      {error && <Alert variant="error">{error}</Alert>}
      <Field id="password" label={t.newPassword} hint={t.passwordHint} required>
        {(inputProps) => (
          <Input
            {...inputProps}
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      <Button type="submit" className="w-full" loading={submitting}>
        {t.submit}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  const t = useAuthStrings().reset;
  return (
    <AuthPageShell
      title={t.title}
      footer={
        <AuthLink href="/login" className="font-medium text-primary hover:underline">
          {t.backToLogin}
        </AuthLink>
      }
    >
      <Suspense fallback={<Spinner className="h-5 w-5 text-primary" />}>
        <ResetPasswordForm />
      </Suspense>
    </AuthPageShell>
  );
}
