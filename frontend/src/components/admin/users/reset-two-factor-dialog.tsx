"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ShieldOff } from "lucide-react";
import * as usersAdminApi from "@/lib/api/users-admin";
import type { AdminUser } from "@/lib/api/types";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ResetTwoFactorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` iken dialog içeriği render edilmez. */
  user: Pick<AdminUser, "id" | "name" | "email" | "lastLoginAt"> | null;
  onReset?: (user: AdminUser) => void;
}

/**
 * 2026-10-18 (Paket B1) — "2FA'yı sıfırla". Yalnızca ADMIN (backend zorlar); işlemi yapan admin
 * KENDİ authenticator kodunu girer (step-up). Hedefin tüm oturumları kapanır ve bilgilendirme
 * e-postası gider; kullanıcı bir sonraki girişte 2FA'yı kendi cihazında yeniden kurar.
 * Hesap hiç giriş yapmamışsa (admin kurulumu) aynı anda şifre belirleme e-postası da önerilir.
 */
export function ResetTwoFactorDialog({ open, onOpenChange, user, onReset }: ResetTwoFactorDialogProps) {
  const [code, setCode] = useState("");
  const [sendActivation, setSendActivation] = useState(false);
  const [error, setError] = useState<{ message: string; needsOwn2fa: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const neverLoggedIn = user?.lastLoginAt === null;

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- `support/templates` İLE AYNI desen: dialog her açılışta formu sıfırlar
      setCode("");
      setError(null);
      setSendActivation(false);
    }
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (!submitting) onOpenChange(next);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!user) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setError({ message: "Authenticator uygulamanızdaki 6 haneli kodu girin.", needsOwn2fa: false });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await usersAdminApi.resetUserTwoFactor(user.id, code.trim());
      if (result.emailStatus === "sent") {
        toast.success("2FA sıfırlandı, oturumlar kapatıldı ve kullanıcıya bilgilendirme e-postası gönderildi.");
      } else {
        toast.warning("2FA sıfırlandı ve oturumlar kapatıldı, ancak bilgilendirme e-postası gönderilemedi.");
      }
      if (sendActivation && neverLoggedIn) {
        try {
          const activation = await usersAdminApi.resendActivationEmail(user.id);
          if (activation.emailStatus === "sent") toast.success("Şifre belirleme e-postası gönderildi.");
          else toast.warning("Şifre belirleme e-postası gönderilemedi.");
        } catch (err) {
          toast.error(friendlyErrorMessage(err));
        }
      }
      onReset?.(result.user);
      onOpenChange(false);
    } catch (err) {
      setError({
        message: friendlyErrorMessage(err),
        needsOwn2fa: err instanceof ApiClientError && err.code === "STEP_UP_2FA_NOT_ENABLED",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
              <ShieldOff className="h-4 w-4" />
            </span>
            <div>
              <DialogTitle>2FA&apos;yı sıfırla</DialogTitle>
              <DialogDescription className="mt-1">
                {user ? `"${user.name}" (${user.email}) hesabının iki adımlı doğrulaması kaldırılacak.` : undefined}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/70">
            <li>Kullanıcının tüm açık oturumları kapatılır.</li>
            <li>Kullanıcıya &quot;2FA&apos;nız yönetici tarafından sıfırlandı&quot; e-postası gider.</li>
            <li>Doktor hesabıysa, bir sonraki girişte 2FA&apos;yı kendi cihazında kurmadan panele giremez.</li>
          </ul>

          {error && (
            <Alert variant="error">
              <span>
                {error.message}
                {error.needsOwn2fa && (
                  <>
                    {" "}
                    <Link href="/admin/settings/security" className="font-medium underline">
                      Güvenlik ayarlarına git
                    </Link>
                  </>
                )}
              </span>
            </Alert>
          )}

          <Field id="reset-2fa-code" label="Kendi doğrulama kodunuz" required>
            {(inputProps) => (
              <Input
                {...inputProps}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            )}
          </Field>
          <p className="-mt-2 text-xs text-foreground/50">İşlemi onaylamak için kendi authenticator uygulamanızdaki kodu girin.</p>

          {neverLoggedIn && (
            <label className="flex items-start gap-2 text-sm text-foreground/80">
              <Checkbox checked={sendActivation} onCheckedChange={(v) => setSendActivation(v === true)} aria-label="Şifre belirleme e-postası da gönder" />
              <span>
                Aynı anda şifre belirleme (etkinleştirme) e-postası da gönder — hesap hiç giriş yapmamış; kullanıcı şifresini ve 2FA&apos;sını
                kendisi kursun.
              </span>
            </label>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
              Vazgeç
            </Button>
            <Button type="submit" variant="destructive" loading={submitting}>
              2FA&apos;yı sıfırla
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
