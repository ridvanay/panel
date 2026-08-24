"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";
import { isSafeInternalPath } from "@/lib/safe-redirect";

function RegisterForm() {
  const { register } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get("next");

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
      await register({ name, email, password });
      router.replace(isSafeInternalPath(next) ? next : "/dashboard");
    } catch (err) {
      setFieldErrors(fieldErrorsFrom(err));
      setError(friendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      {error && <Alert variant="error">{error}</Alert>}

      <Field id="name" label="Ad Soyad" error={fieldErrors.name} required>
        {(inputProps) => (
          <Input {...inputProps} autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
        )}
      </Field>

      <Field id="email" label="E-posta" error={fieldErrors.email} required>
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

      <Field id="password" label="Şifre" error={fieldErrors.password} hint="En az 8 karakter." required>
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
        Hesap oluştur
      </Button>
    </form>
  );
}

export default function RegisterPage() {
  return (
    <AuthPageShell
      title="Hesap oluştur"
      subtitle="Birkaç saniyede başlayın, kredi kartı gerekmez."
      footer={
        <>
          Zaten hesabınız var mı?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Giriş yapın
          </Link>
        </>
      }
    >
      <Suspense fallback={<Spinner className="h-5 w-5 text-primary" />}>
        <RegisterForm />
      </Suspense>
    </AuthPageShell>
  );
}
