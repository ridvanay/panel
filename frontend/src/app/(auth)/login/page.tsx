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
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ email, password });
      router.replace(next && next.startsWith("/") ? next : "/dashboard");
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      {error && <Alert variant="error">{error}</Alert>}

      <Field id="email" label="E-posta" required>
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

      <Field id="password" label="Şifre" required>
        {(inputProps) => (
          <Input
            {...inputProps}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>

      <div className="flex justify-end text-sm">
        <Link href="/forgot-password" className="text-primary hover:underline">
          Şifremi unuttum
        </Link>
      </div>

      <Button type="submit" className="w-full" loading={submitting}>
        Giriş yap
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthPageShell
      title="Giriş yap"
      subtitle="Hesabınıza erişmek için bilgilerinizi girin."
      footer={
        <>
          Hesabınız yok mu?{" "}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Kayıt olun
          </Link>
        </>
      }
    >
      <Suspense fallback={<Spinner className="h-5 w-5 text-primary" />}>
        <LoginForm />
      </Suspense>
    </AuthPageShell>
  );
}
