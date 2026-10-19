"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import * as securityApi from "@/lib/api/security";
import type { StaffTwoFactorPolicy } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { useNow } from "@/hooks/use-now";

const DAY_MS = 24 * 60 * 60 * 1000;
const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeStyle: "short" });

/** `<input type="date">` için yerel YYYY-MM-DD. */
function toDateInputValue(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Paket G — Admin → Güvenlik: personel (ADMIN/MANAGER) için zorunlu 2FA anahtarı. YALNIZCA ADMIN'e
 * render edilir; değiştirmek için kendi 2FA'sı etkin olmalı ve şifre + doğrulama kodu girilir. Tarih en
 * az 7 gün ileride olmalı (bekleme süresinde personel uyarı şeridi görür).
 */
export function StaffTwoFactorPolicyCard({ actorHasTwoFactor }: { actorHasTwoFactor: boolean }) {
  const [policy, setPolicy] = useState<StaffTwoFactorPolicy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPolicy(await securityApi.getStaffTwoFactorPolicy());
      setLoadError(null);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const now = useNow();
  const minGraceDays = policy?.minGraceDays ?? 7;
  const minDate = toDateInputValue(now + minGraceDays * DAY_MS + DAY_MS);

  async function submit(requiredAt: string | null) {
    setSaving(true);
    setError(null);
    try {
      const next = await securityApi.updateStaffTwoFactorPolicy({ requiredAt, password, code });
      setPolicy(next);
      setPassword("");
      setCode("");
      setDate("");
      toast.success(requiredAt ? "Personel için zorunlu 2FA planlandı." : "Personel için zorunlu 2FA kapatıldı.");
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="admin-h2 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Personel için zorunlu 2FA
        </h2>
        <p className="mt-1 admin-text-secondary">
          Açıldığında, belirlediğiniz tarihten itibaren iki adımlı doğrulaması kapalı yöneticiler (ADMIN/MANAGER) panele
          yalnızca 2FA kurulum sayfasından girebilir. Tarih en az {minGraceDays} gün ileride olmalı; bu sürede ilgili
          kişiler uyarı görür.
        </p>
      </div>

      {loadError ? (
        <Alert variant="error">{loadError}</Alert>
      ) : policy === null ? (
        <div className="flex justify-center py-4">
          <Spinner className="h-5 w-5 text-primary" />
        </div>
      ) : (
        <>
          <p className="text-sm text-foreground">
            Durum:{" "}
            <strong>
              {policy.requiredAt
                ? new Date(policy.requiredAt).getTime() <= now
                  ? `Aktif (${dateFormatter.format(new Date(policy.requiredAt))} itibarıyla)`
                  : `Planlandı — ${dateFormatter.format(new Date(policy.requiredAt))}`
                : "Kapalı"}
            </strong>
          </p>

          {policy.staffWithoutTwoFactor.length > 0 && (
            <div className="text-sm">
              <p className="font-medium text-foreground">2FA&apos;sı kapalı aktif personel ({policy.staffWithoutTwoFactor.length}):</p>
              <ul className="mt-1 list-disc pl-5 text-foreground/70">
                {policy.staffWithoutTwoFactor.map((u) => (
                  <li key={u.id}>
                    {u.email} ({u.role})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!actorHasTwoFactor ? (
            <Alert variant="warning">Bu ayarı değiştirmek için önce kendi hesabınızda 2FA&apos;yı etkinleştirin.</Alert>
          ) : (
            <div className="space-y-3">
              {error && <Alert variant="error">{error}</Alert>}
              <Field id="staff-2fa-date" label="Zorunluluk tarihi" hint={`En erken ${minGraceDays} gün sonrası.`}>
                {(inputProps) => <Input {...inputProps} type="date" min={minDate} value={date} onChange={(e) => setDate(e.target.value)} />}
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="staff-2fa-password" label="Şifreniz" required>
                  {(inputProps) => (
                    <Input {...inputProps} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  )}
                </Field>
                <Field id="staff-2fa-code" label="Doğrulama kodu" required>
                  {(inputProps) => (
                    <Input {...inputProps} inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
                  )}
                </Field>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  loading={saving}
                  disabled={!date || !password || code.length !== 6}
                  onClick={() => void submit(new Date(`${date}T09:00:00`).toISOString())}
                >
                  {policy.requiredAt ? "Tarihi güncelle" : "Zorunluluğu planla"}
                </Button>
                {policy.requiredAt && (
                  <Button type="button" variant="outline" loading={saving} disabled={!password || code.length !== 6} onClick={() => void submit(null)}>
                    Zorunluluğu kapat
                  </Button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
