"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

/** §4.3/§4.5 — `verify-email` ile BİREBİR AYNI jenerik hata (`VERIFICATION_CODE_INVALID`),
 * amaç eşleşmezse de aynı gövde döner (numaralandırma yüzeyi yok). */
function activateAccountErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError && err.code === "VERIFICATION_CODE_INVALID") {
    return "Kod hatalı veya süresi dolmuş, yeniden gönderin.";
  }
  return friendlyErrorMessage(err);
}

/**
 * `.claude/architect-scope-guest-account-otp.md` §5/§8.2 — misafir randevu ödemesiyle açılmış
 * hesabın aktivasyon ekranı. `[lang]` site tarafındadır (auth grubunda DEĞİL) çünkü e-postadaki
 * bağlantının hedefi budur. `?email=` ZORUNLUDUR — backend aktivasyon e-postasındaki
 * `activation_url` bunu taşır (§7.3, kod URL'ye ASLA konmaz).
 */
function ActivateAccountForm() {
  const { activateAccount } = useAuth();
  const router = useRouter();
  const localize = useLocalizePath();
  const email = useSearchParams().get("email");

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!email) {
    return (
      <Alert variant="error">Bağlantı geçersiz. Aktivasyon e-postasındaki bağlantıyı tekrar kullanın.</Alert>
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== passwordConfirm) {
      setError("Parolalar eşleşmiyor.");
      return;
    }
    setSubmitting(true);
    try {
      await activateAccount({ email: email as string, code, password });
      // §5.7/§8.2 — başarıda hasta portalına yönlendirilir, kullanıcı hesabını neden aktive
      // ettiğini orada (randevusunu) görür. Portal kodu bu görevde DEĞİŞTİRİLMEZ.
      router.replace(localize("/patient/bookings"));
    } catch (err) {
      setError(activateAccountErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      {error && <Alert variant="error">{error}</Alert>}

      <p className="text-sm text-foreground/60">
        <strong className="font-medium text-foreground">{email}</strong> adresine gönderilen 6 haneli kodu ve yeni
        parolanızı girin.
      </p>

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

      <Field id="passwordConfirm" label="Yeni şifre (tekrar)" required>
        {(inputProps) => (
          <Input
            {...inputProps}
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
          />
        )}
      </Field>

      <Button type="submit" className="w-full" loading={submitting} disabled={code.length !== 6}>
        Hesabımı aktive et
      </Button>
    </form>
  );
}

export default function ActivateAccountPage() {
  return (
    <AuthPageShell
      title="Hesabınızı aktive edin"
      subtitle="Randevunuzla ilişkilendirilen hesabınıza erişmek için kodu ve yeni parolanızı belirleyin."
      footer={
        <Link href="/login" className="font-medium text-primary hover:underline">
          Zaten hesabınız var mı? Giriş yapın
        </Link>
      }
    >
      <Suspense fallback={<Spinner className="h-5 w-5 text-primary" />}>
        <ActivateAccountForm />
      </Suspense>
    </AuthPageShell>
  );
}
