"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { isSafeInternalPath } from "@/lib/safe-redirect";
import { isDoctorPortalPath, resolvePostLoginPath } from "@/lib/post-login-destination";
import { SITE_ORIGIN, isDoctorHostname, isSubdomainModeEnabled, toDoctorOrigin } from "@/lib/doctor-host";
import { listPublicModules } from "@/lib/api/modules";
import type { User } from "@/lib/api/types";

interface TwoFactorChallenge {
  challengeToken: string;
}

export interface LoginFormProps {
  /**
   * `.claude/architect-scope-doctor-subdomain.md` §4 — `"default"` mevcut SaaS/site girişi
   * (`(auth)/login`). `"doctor"` — `/doctor/login`: kayıt bağlantısı SUNMAZ (bu prop'un kendisi
   * değil, çağıran `page.tsx`'in `AuthPageShell` footer'ı) ve giriş yapan hesabın
   * `doctorProfileId === null` olması durumunda SESSİZCE `/dashboard`'a düşürmek YERİNE açık bir
   * hata mesajı gösterir (ana siteye dönüş bağlantısıyla birlikte).
   */
  variant?: "default" | "doctor";
}

const NOT_A_DOCTOR_MESSAGE =
  "Bu hesap bir doktor profiline bağlı değil. Doktor portalına yalnızca sisteme kayıtlı bir doktor profiliyle ilişkilendirilmiş hesaplar erişebilir.";

/**
 * `.claude/architect-scope-doctor-subdomain.md` §4 — eskiden `app/(auth)/login/page.tsx` İÇİNDE
 * tanımlıydı (2FA challenge akışı, `goToDestination`, `friendlyErrorMessage`); KOPYALANMADAN bu
 * paylaşılan modüle taşındı — hem `(auth)/login/page.tsx` hem `(doctor)/doctor/login/page.tsx`
 * BUNU import eder.
 *
 * `useSearchParams()` kullanır — çağıran `page.tsx` bu bileşeni bir `<Suspense>` sınırı İÇİNDE
 * render ETMEK ZORUNDADIR (eski davranışla AYNI, bkz. çağıran taraflar).
 */
export function LoginForm({ variant = "default" }: LoginFormProps) {
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
   * §K4 + `post-login-destination.ts` §KESİN öncelik sırası — doktor hesabı VE `next` zaten
   * `/doctor` altında güvenli bir yol DEĞİLSE `telehealth` modülünün açık olup olmadığını
   * kontrol eder (`GET /modules`). `next` zaten `/doctor` altındaysa `resolvePostLoginPath`
   * `telehealthEnabled`'ın değerinden BAĞIMSIZ olarak AYNI sonucu (`next`) üretir (bkz. o
   * dosya) — bu durumda gereksiz bir `GET /modules` isteği ATILMAZ. Bu çağrı BİLEREK SADECE
   * doktor kullanıcılar için yapılır — doktor OLMAYAN hiç kimse (§10.21'in 4 diğer rolü +
   * hasta) bu ekstra isteği ASLA atmaz.
   *
   * `variant === "doctor"` + `doctorProfileId === null` — §4 KARARI: sessizce `/dashboard`'a
   * düşürülmez, açık bir hata gösterilir (kullanıcı zaten `/doctor/login`'e ULAŞMIŞTIR).
   *
   * §5.6 — `resolvePostLoginPath()` bir doktor portalı path'i döndürdüyse VE subdomain modu
   * AÇIKSA VE şu an doktor host'unda DEĞİLSEK, hedef `toDoctorOrigin(path)` ile TAM SAYFA açılır
   * (`router.replace` bir RSC navigasyonu başlatır; proxy'nin döndüğü cross-origin 307'yi Next
   * istemci router'ının izlemesi garanti değildir — bkz. karar dokümanı §5.6/§6).
   */
  async function goToDestination(user: User) {
    if (variant === "doctor" && user.doctorProfileId === null) {
      setError(NOT_A_DOCTOR_MESSAGE);
      return;
    }

    let telehealthEnabled = false;
    const nextIsSafeDoctorPortalPath = isSafeInternalPath(next) && isDoctorPortalPath(next);
    if (user.doctorProfileId !== null && !nextIsSafeDoctorPortalPath) {
      try {
        const modules = await listPublicModules();
        telehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
      } catch {
        telehealthEnabled = false;
      }
    }

    const destination = resolvePostLoginPath({ next, doctorProfileId: user.doctorProfileId, telehealthEnabled });
    if (isSubdomainModeEnabled() && isDoctorPortalPath(destination) && !isDoctorHostname(window.location.hostname)) {
      window.location.assign(toDoctorOrigin(destination));
      return;
    }
    router.replace(destination);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login({ email, password });
      if (result.kind === "twoFactor") {
        setChallenge({ challengeToken: result.challengeToken });
        return;
      }
      if (result.kind === "emailVerification") {
        // §2.3/§8.1 — kod OTOMATİK GÖNDERİLMEZ; ekran "Kod gönder" eylemiyle açılır.
        router.push(`/verify-email?email=${encodeURIComponent(result.email)}${next ? `&next=${encodeURIComponent(next)}` : ""}`);
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
      {error && (
        <Alert variant="error">
          {error}
          {/* §4 KARARI — `doctorProfileId === null` hata mesajının yanında ana siteye dönüş bağlantısı. */}
          {variant === "doctor" && error === NOT_A_DOCTOR_MESSAGE && (
            <div className="mt-2">
              {/* Doktor host'unda "/" portal ana sayfasına rewrite edilir — ana siteye dönmek
                  subdomain modu açıkken CROSS-ORIGIN bir bağlantı gerektirir (§3.6/§6.4). */}
              <Link href={isSubdomainModeEnabled() ? SITE_ORIGIN : "/"} className="font-medium underline">
                Ana siteye dön
              </Link>
            </div>
          )}
        </Alert>
      )}

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
