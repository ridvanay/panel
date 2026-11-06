"use client";

import { useState, type FormEvent } from "react";
import { AuthLink } from "@/components/auth/auth-link";
import { useRouter } from "next/navigation";
import * as authApi from "@/lib/api/auth";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { useFriendlyError } from "@/lib/i18n/use-portal-strings";
import { useAuthStrings } from "@/lib/i18n/use-auth-strings";
import { PasswordField, passwordPolicyMessage } from "@/components/auth/password-field";
import { useLocationToken } from "@/lib/use-location-token";

/**
 * Paket AP — bağlantı `/reset-password#token=<…>`: token `#` parçasında gelir (sunucuya, log'a, `Referer`'a gitmez),
 * adresten silinir, sekmede `sessionStorage`'da tutulur ve POST gövdesiyle gider. Eski `?token=` geçiş süresince.
 */
function ResetPasswordForm() {
  const router = useRouter();
  const { ready, token } = useLocationToken({ hashKey: "token", legacyQueryKey: "token", storageKey: "reset-password-token" });
  const authStrings = useAuthStrings();
  const t = authStrings.reset;
  const friendlyErrorMessage = useFriendlyError();

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authApi.resetPassword(token ?? "", password);
      try {
        window.sessionStorage.removeItem("reset-password-token");
      } catch {
        /* depolama engelli: yok sayılır */
      }
      router.replace("/login");
    } catch (err) {
      // Paket S — şifre politikası ihlali: sunucunun kural kodları aktif dilde.
      setError(passwordPolicyMessage(err, authStrings.passwordRules) ?? friendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) return <Spinner className="h-5 w-5 text-primary" />;
  if (!token) {
    return <Alert variant="error">{t.invalidLink}</Alert>;
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      {error && <Alert variant="error">{error}</Alert>}
      <PasswordField
        id="password"
        label={t.newPassword}
        hint={t.passwordHint}
        required
        value={password}
        strings={authStrings.passwordRules}
        inputProps={{ value: password, onChange: (e) => setPassword(e.target.value) }}
      />
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
      <ResetPasswordForm />
    </AuthPageShell>
  );
}
