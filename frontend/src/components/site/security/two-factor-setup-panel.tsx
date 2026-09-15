"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import * as securityApi from "@/lib/api/security";
import type { TwoFactorSetupResponse } from "@/lib/api/types";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { BackupCodesList } from "@/app/[lang]/(site)/hesabim/profil/page";

function extractManualSecret(otpauthUrl: string): string | null {
  try {
    return new URL(otpauthUrl).searchParams.get("secret");
  } catch {
    return null;
  }
}

interface TwoFactorSetupPanelProps {
  /**
   * Yedek kodlar kullanıcıya gösterildikten SONRA, kullanıcının açık bir eylemiyle (ör. "Portala
   * Gir") çağrılır. Bu bileşen kendi başına navigasyon/refresh KARARI VERMEZ — o karar çağırana
   * (`doctor-portal-shell.tsx`) aittir.
   */
  onCompleted: () => void;
}

/**
 * `.claude/architect-scope-doctor-subdomain.md` §5.6.2 — `/hesabim/profil` ve
 * `app/admin/settings/security/page.tsx`teki 2FA kurulum mantığının BİREBİR aynısı, yalnızca
 * **enable yolu** (setup → QR → kod → enable → yedek kodlar). `disable`/`regenerateBackupCodes`/
 * oturum yönetimi BU bileşene GİRMEZ — onlar `hesabim/profil/page.tsx`te kalır.
 *
 * `.site-scope` paletiyle uyumludur (admin panelin ayrı token sistemi KULLANILMAZ) — bu bileşen
 * yalnızca `.site-scope` ağacı içinde (ör. `doctor-portal-shell.tsx`) mount edilmelidir.
 *
 * Yedek kodlar gösterildikten sonra OTOMATİK geçiş YASAKTIR (kodlar bir daha gösterilemez);
 * kullanıcı açıkça "Portala Gir"e basmalıdır.
 */
export function TwoFactorSetupPanel({ onCompleted }: TwoFactorSetupPanelProps) {
  const [setupData, setSetupData] = useState<TwoFactorSetupResponse | null>(null);
  const [setupLoading, setSetupLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  // `doctor-portal-provider.tsx`teki AYNI desen (`react-hooks/set-state-in-effect`) — effect
  // gövdesinde SENKRON `setState` çağrısı YASAK; `setupLoading`in başlangıç değeri zaten `true`
  // (yukarıdaki `useState(true)`), bu yüzden ilk yüklemede EK bir senkron çağrıya gerek yok.
  const loadSetup = useCallback(async () => {
    try {
      const data = await securityApi.setupTwoFactor();
      setSetupData(data);
      setSetupError(null);
    } catch (err) {
      setSetupError(friendlyErrorMessage(err));
    } finally {
      setSetupLoading(false);
    }
  }, []);

  useEffect(() => {
    // `hesabim/profil/page.tsx`teki `loadSessions` çağırım deseninin AYNISI — `loadSetup`
    // doğrudan referansla ÇAĞRILMAZ, bir `await` ile SARMALANIR (statik analiz bu şekilde
    // senkron `setState` UYARISI ÜRETMEZ).
    (async () => {
      await loadSetup();
    })();
  }, [loadSetup]);

  // "Tekrar Dene" butonu bir event handler'dır (effect DEĞİL) — burada `setSetupLoading(true)`
  // senkron olarak çağrılması güvenlidir.
  function handleRetryLoadSetup() {
    setSetupLoading(true);
    setSetupError(null);
    void loadSetup();
  }

  async function handleEnable() {
    if (!setupData) return;
    setEnableError(null);
    setEnabling(true);
    try {
      const result = await securityApi.enableTwoFactor({ setupToken: setupData.setupToken, code });
      setBackupCodes(result.backupCodes);
      toast.success("İki faktörlü doğrulama etkinleştirildi.");
    } catch (err) {
      setEnableError(friendlyErrorMessage(err));
    } finally {
      setEnabling(false);
    }
  }

  const manualSecret = setupData ? extractManualSecret(setupData.otpauthUrl) : null;

  if (backupCodes) {
    return (
      <div className="w-full space-y-4 text-left">
        <BackupCodesList codes={backupCodes} />
        <Button type="button" className="w-full rounded-[var(--site-radius)]" onClick={onCompleted}>
          Portala Gir
        </Button>
      </div>
    );
  }

  if (setupLoading) {
    return (
      <div className="flex w-full justify-center py-8">
        <Spinner className="h-6 w-6 text-[var(--site-primary)]" />
      </div>
    );
  }

  if (setupError || !setupData) {
    return (
      <div className="w-full space-y-3">
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {setupError ?? "Kurulum bilgisi alınamadı."}
          </span>
        </Alert>
        <Button type="button" variant="outline" className="w-full" onClick={handleRetryLoadSetup}>
          Tekrar Dene
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4 text-left">
      <p className="text-center text-xs text-foreground/60">
        Kimlik doğrulama uygulamanızla (Google Authenticator, 1Password vb.) QR kodu tarayın.
      </p>

      <div className="flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- data URI, next/image uygun değil */}
        <img src={setupData.qrCodeDataUrl} alt="QR kod" className="h-40 w-40 rounded-lg border border-border" />
      </div>

      {manualSecret && (
        <p className="break-all text-center text-xs text-foreground/60">
          QR kodu tarayamıyorsanız manuel giriş kodu: <span className="font-mono">{manualSecret}</span>
        </p>
      )}

      {enableError && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {enableError}
          </span>
        </Alert>
      )}

      <Field id="doctor-2fa-setup-code" label="Doğrulama Kodu" required>
        {(inputProps) => (
          <Input {...inputProps} required placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
        )}
      </Field>

      <Button type="button" className="w-full rounded-[var(--site-radius)]" loading={enabling} onClick={handleEnable}>
        Doğrula ve Etkinleştir
      </Button>
    </div>
  );
}
