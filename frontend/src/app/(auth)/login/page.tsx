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
import { isSafeInternalPath } from "@/lib/safe-redirect";
import { resolvePostLoginPath } from "@/lib/post-login-destination";
import { listPublicModules } from "@/lib/api/modules";
import type { User } from "@/lib/api/types";

interface TwoFactorChallenge {
  challengeToken: string;
}

function LoginForm() {
  const { login, verifyTwoFactor } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * §K4 — doktor hesabı VE `next` yok/güvensizse `telehealth` modülünün açık olup olmadığını
   * kontrol eder (`GET /modules`). Bu çağrı BİLEREK SADECE doktor kullanıcılar için yapılır —
   * doktor OLMAYAN hiç kimse (§10.21'in 4 diğer rolü + hasta) bu ekstra isteği ASLA atmaz.
   */
  async function goToDestination(user: User) {
    let telehealthEnabled = false;
    if (user.doctorProfileId !== null && !isSafeInternalPath(next)) {
      try {
        const modules = await listPublicModules();
        telehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
      } catch {
        telehealthEnabled = false;
      }
    }
    router.replace(resolvePostLoginPath({ next, doctorProfileId: user.doctorProfileId, telehealthEnabled }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login({ email, password });
      if (result.requiresTwoFactor) {
        setChallenge({ challengeToken: result.challengeToken });
        return;
      }
      await goToDestination(result.user);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(event: FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    setError(null);
    setSubmitting(true);
    try {
      const user = await verifyTwoFactor(challenge.challengeToken, code);
      await goToDestination(user);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (challenge) {
    return (
      <form className="space-y-4" onSubmit={handleVerify} noValidate>
        {error && <Alert variant="error">{error}</Alert>}

        <p className="text-sm text-foreground/60">
          Kimlik doğrulama uygulamanızdaki 6 haneli kodu ya da bir yedek kodu girin.
        </p>

        <Field id="code" label="Doğrulama Kodu" required>
          {(inputProps) => (
            <Input
              {...inputProps}
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              autoFocus
              required
              placeholder="123456 veya XXXX-XXXX"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
        </Field>

        <Button type="submit" className="w-full" loading={submitting}>
          Doğrula
        </Button>

        <div className="flex justify-center text-sm">
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => {
              setChallenge(null);
              setCode("");
              setError(null);
            }}
          >
            Geri
          </button>
        </div>
      </form>
    );
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
