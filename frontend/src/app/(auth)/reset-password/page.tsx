"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as authApi from "@/lib/api/auth";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

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
    return <Alert variant="error">Bağlantı geçersiz. Sıfırlama e-postasındaki bağlantıyı tekrar kullanın.</Alert>;
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      {error && <Alert variant="error">{error}</Alert>}
      <Field id="password" label="Yeni şifre" hint="En az 8 karakter." required>
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
        Şifreyi güncelle
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthPageShell
      title="Yeni şifre belirle"
      footer={
        <Link href="/login" className="font-medium text-primary hover:underline">
          Girişe dön
        </Link>
      }
    >
      <Suspense fallback={<Spinner className="h-5 w-5 text-primary" />}>
        <ResetPasswordForm />
      </Suspense>
    </AuthPageShell>
  );
}
