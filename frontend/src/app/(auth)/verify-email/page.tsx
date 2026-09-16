"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import * as authApi from "@/lib/api/auth";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { isSafeInternalPath } from "@/lib/safe-redirect";

/**
 * `.claude/architect-scope-guest-account-otp.md` §3.6/§8.1 — backend'in kendi (DB tabanlı,
 * hedef-başına) cooldown'u zaten var; bu sabit yalnızca frontend'in İYİMSER UX göstergesi
 * içindir (backend başarı/cooldown'ı ayırt etmediği gibi biz de etmeyiz, bkz. `handleResend`).
 */
const RESEND_COOLDOWN_MS = 60_000;

/** §4.3 — `VERIFICATION_CODE_INVALID` tek jenerik hatasını kullanıcı dostu göster. */
function verifyEmailErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError && err.code === "VERIFICATION_CODE_INVALID") {
    return "Kod hatalı veya süresi dolmuş, yeniden gönderin.";
  }
  return friendlyErrorMessage(err);
}

function parseFutureTimestamp(value: string | null): number | null {
  if (!value) return null;
  const ts = Date.parse(value);
  if (Number.isNaN(ts) || ts <= Date.now()) return null;
  return ts;
}

function secondsUntil(timestamp: number | null): number {
  if (!timestamp) return 0;
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
}

/**
 * `?email=` ZORUNLUDUR — hem `/register` (kayıt sonrası, `resendAvailableAt`/`expiresAt` taşır)
 * hem `/login`in `requiresEmailVerification` dalı (kod OTOMATİK GÖNDERİLMEDİĞİ için bu ikinci
 * girişte `resendAvailableAt` YOKTUR, buton "Kod gönder" olarak açılır) BURAYA yönlendirir.
 */
function VerifyEmailForm() {
  const { verifyEmail } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get("email");
  const next = params.get("next");
  const initialResendAvailableAt = params.get("resendAvailableAt");
  const expiresAtHint = params.get("expiresAt");

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [codeAlreadySent, setCodeAlreadySent] = useState(() => Boolean(initialResendAvailableAt));
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(() => parseFutureTimestamp(initialResendAvailableAt));
  // İlk değer `cooldownUntil`'den DOĞRUDAN türetilir (senkron setState'ten kaçınmak için) —
  // aşağıdaki effect yalnızca saniye başına GERİ SAYIMI günceller (bir "abonelik", ilk hesaplama
  // DEĞİL, bkz. react-hooks/set-state-in-effect).
  const [remainingSeconds, setRemainingSeconds] = useState(() => secondsUntil(cooldownUntil));

  useEffect(() => {
    if (!email) router.replace("/login");
  }, [email, router]);

  useEffect(() => {
    if (!cooldownUntil) return;
    const interval = setInterval(() => setRemainingSeconds(secondsUntil(cooldownUntil)), 1000);
    return () => clearInterval(interval);
  }, [cooldownUntil]);

  if (!email) {
    return <Spinner className="h-5 w-5 text-primary" />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await verifyEmail({ email: email as string, code });
      router.replace(isSafeInternalPath(next) ? next : "/dashboard");
    } catch (err) {
      setError(verifyEmailErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setError(null);
    setResendNotice(null);
    setResending(true);
    try {
      // §3.5 — backend HER koşulda `202` döner (kullanıcı yok / zaten doğrulanmış / cooldown
      // içinde ayırt edilemez); biz de ayırt etmeyiz, iyimser bir "gönderildi" mesajı gösteririz.
      await authApi.resendVerificationCode({ email: email as string });
      setCodeAlreadySent(true);
      setCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
      // Olay işleyicisi içinde — effect'in ilk "tick"ini beklemeden anında doğru değeri gösterir.
      setRemainingSeconds(Math.ceil(RESEND_COOLDOWN_MS / 1000));
      setResendNotice("Yeni bir kod gönderildiyse birkaç dakika içinde e-postanıza ulaşacaktır.");
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setResending(false);
    }
  }

  const cooldownActive = remainingSeconds > 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground/60">
        <strong className="font-medium text-foreground">{email}</strong> adresine gönderilen 6 haneli kodu girin.
        {expiresAtHint && " Kod kısa süre içinde geçerliliğini yitirir."}
      </p>

      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        {error && <Alert variant="error">{error}</Alert>}
        {resendNotice && !error && <Alert variant="success">{resendNotice}</Alert>}

        <Field id="code" label="Doğrulama Kodu" required>
          {(inputProps) => (
            <Input
              {...inputProps}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              autoFocus
              required
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
            />
          )}
        </Field>

        <Button type="submit" className="w-full" loading={submitting} disabled={code.length !== 6}>
          Doğrula
        </Button>
      </form>

      <div className="flex justify-center text-sm">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          loading={resending}
          disabled={cooldownActive || resending}
          onClick={handleResend}
        >
          {cooldownActive
            ? `${remainingSeconds} saniye sonra tekrar gönderebilirsiniz`
            : codeAlreadySent
              ? "Kodu tekrar gönder"
              : "Kod gönder"}
        </Button>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthPageShell
      title="E-postanızı doğrulayın"
      subtitle="Hesabınızı etkinleştirmek için e-postanıza gönderdiğimiz kodu girin."
      footer={
        <>
          Yanlış hesap mı?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Girişe dön
          </Link>
        </>
      }
    >
      <Suspense fallback={<Spinner className="h-5 w-5 text-primary" />}>
        <VerifyEmailForm />
      </Suspense>
    </AuthPageShell>
  );
}
