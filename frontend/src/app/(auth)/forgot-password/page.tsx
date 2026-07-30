"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import * as authApi from "@/lib/api/auth";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

export default function ForgotPasswordPage() {
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
      title="Şifremi unuttum"
      subtitle="E-posta adresinize bir sıfırlama bağlantısı gönderelim."
      footer={
        <Link href="/login" className="font-medium text-primary hover:underline">
          Girişe dön
        </Link>
      }
    >
      {submitted ? (
        <Alert variant="success">
          Bu e-posta adresine kayıtlı bir hesap varsa, birazdan bir şifre sıfırlama bağlantısı alacaksınız.
        </Alert>
      ) : (
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
          <Button type="submit" className="w-full" loading={submitting}>
            Sıfırlama bağlantısı gönder
          </Button>
        </form>
      )}
    </AuthPageShell>
  );
}
