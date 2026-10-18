"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Mail, ShieldOff } from "lucide-react";
import * as usersAdminApi from "@/lib/api/users-admin";
import type { AdminUser } from "@/lib/api/types";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { useAuthOptional } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ResetTwoFactorDialog } from "@/components/admin/users/reset-two-factor-dialog";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

/**
 * 2026-10-18 (Paket B1) — doktor detayındaki "Bağlı hesap" satırı: 2FA durumu, son giriş ve iki
 * işlem ("2FA'yı sıfırla", "Etkinleştirme e-postasını yeniden gönder"). Kullanıcı bilgisi
 * `GET /admin/users/{id}` ile okunur (yalnızca ADMIN) — MANAGER için yalnızca bağlantı durumu kalır.
 * Bağlama/çözme hâlâ `/admin/users`'tadır (K8).
 */
export function DoctorLinkedAccountPanel({ userId }: { userId: string | null }) {
  const currentUser = useAuthOptional()?.user ?? null;
  const isAdmin = currentUser?.role === "ADMIN";
  const [account, setAccount] = useState<AdminUser | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resending, setResending] = useState(false);

  const load = useCallback(async () => {
    if (!userId || !isAdmin) return;
    try {
      setAccount(await usersAdminApi.getAdminUser(userId));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiClientError && err.status === 403 ? null : friendlyErrorMessage(err));
    }
  }, [userId, isAdmin]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- veri çekme; setState yalnızca await sonrası çalışır
    void load();
  }, [load]);

  async function handleResendActivation() {
    if (!account) return;
    setResending(true);
    try {
      const result = await usersAdminApi.resendActivationEmail(account.id);
      if (result.emailStatus === "sent") toast.success("Etkinleştirme (şifre belirleme) e-postası gönderildi.");
      else toast.warning("E-posta gönderilemedi; SMTP ayarlarını kontrol edin.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Bağlı hesap</p>
          <p className="text-xs text-foreground/60">
            {!userId ? "Bağlı hesap yok" : account ? `${account.name} · ${account.email}` : "Bağlı ✓"}
          </p>
        </div>
        <Link href="/admin/users" className="text-xs font-medium text-primary hover:underline">
          Bağlantıyı /admin/users üzerinden yönetin →
        </Link>
      </div>

      {loadError && <p className="text-xs text-danger">{loadError}</p>}

      {account && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/60">
            <Badge tone={account.twoFactorEnabled ? "success" : "warning"} size="sm">
              {account.twoFactorEnabled ? "2FA açık" : "2FA kapalı — ilk girişte kurulacak"}
            </Badge>
            <span>Son giriş: {account.lastLoginAt ? dateFormatter.format(new Date(account.lastLoginAt)) : "hiç giriş yapmadı"}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {account.twoFactorEnabled && account.role !== "ADMIN" && account.id !== currentUser?.id && (
              <Button type="button" variant="outline" size="sm" onClick={() => setResetOpen(true)}>
                <ShieldOff className="h-3.5 w-3.5" />
                2FA&apos;yı sıfırla
              </Button>
            )}
            {account.lastLoginAt === null && account.status === "ACTIVE" && (
              <Button type="button" variant="outline" size="sm" loading={resending} onClick={() => void handleResendActivation()}>
                <Mail className="h-3.5 w-3.5" />
                Etkinleştirme e-postasını yeniden gönder
              </Button>
            )}
          </div>
        </>
      )}

      <ResetTwoFactorDialog open={resetOpen} onOpenChange={setResetOpen} user={account} onReset={setAccount} />
    </div>
  );
}
