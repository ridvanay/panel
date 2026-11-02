"use client";

import { useState } from "react";
import { toast } from "sonner";
import { setMeetingHostAccess } from "@/lib/api/meetings";
import type { AdminUser } from "@/lib/api/types";
import { fmt, useMeetingErrorMessage, useMeetingStrings } from "@/lib/i18n/use-meeting-strings";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";

/** Yetki yalnızca panel rolleri (ADMIN/MANAGER/EDITOR) ve doktor profiline bağlı kullanıcılara verilebilir (tasarım §2). */
export function isMeetingHostEligible(user: Pick<AdminUser, "role" | "doctorProfileId" | "status">): boolean {
  if (user.status === "DELETED") return false;
  return user.role === "ADMIN" || user.role === "MANAGER" || user.role === "EDITOR" || user.doctorProfileId !== null;
}

/**
 * Paket AG İş 3 — Admin → Kullanıcılar: "Harici toplantı oluşturabilir" anahtarı (yalnızca ADMIN bu sayfayı görür).
 * ADMIN satırı kilitli ve açıktır (adminler her zaman yetkili). Değişiklik onay diyaloğuyla yapılır; geri alma, kullanıcının
 * gelecekteki toplantılarının iptal edileceğini ve açık odaların kapatılacağını açıkça söyler (S3).
 */
export function MeetingHostToggle({ user, onChanged }: { user: AdminUser; onChanged: () => void }) {
  const { t } = useMeetingStrings();
  const errorMessage = useMeetingErrorMessage();
  const [pendingValue, setPendingValue] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isMeetingHostEligible(user)) return null;

  const isAdminRole = user.role === "ADMIN";
  const checked = isAdminRole || user.canHostMeetings === true;
  const inputId = `meeting-host-${user.id}`;

  async function confirm() {
    if (pendingValue === null) return;
    setLoading(true);
    try {
      await setMeetingHostAccess(user.id, pendingValue);
      toast.success(pendingValue ? t.hostAccessGrantedToast : t.hostAccessRevokedToast);
      setPendingValue(null);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
      setPendingValue(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2 flex items-center gap-2" data-testid="meeting-host-toggle">
      <Switch
        id={inputId}
        size="sm"
        checked={checked}
        disabled={isAdminRole || loading}
        // Tabloda her satırda aynı görünür etiket tekrar ettiği için erişilebilir ad kullanıcıyı da içerir (görünür metni kapsar).
        aria-label={`${t.hostAccessLabel}: ${user.name}`}
        onCheckedChange={(value) => setPendingValue(Boolean(value))}
      />
      <span className="text-xs leading-tight text-foreground/70">
        {t.hostAccessLabel}
        {isAdminRole && <span className="block text-[11px] text-foreground/50">{t.hostAccessAdminNote}</span>}
      </span>
      <ConfirmDialog
        open={pendingValue !== null}
        onOpenChange={(open) => {
          if (!open) setPendingValue(null);
        }}
        title={pendingValue ? t.hostAccessGrantTitle : t.hostAccessRevokeTitle}
        description={fmt(pendingValue ? t.hostAccessGrantBody : t.hostAccessRevokeBody, { name: user.name })}
        confirmText={pendingValue ? t.hostAccessConfirmGrant : t.hostAccessConfirmRevoke}
        cancelText={t.dialogCancel}
        tone={pendingValue ? "default" : "danger"}
        loading={loading}
        onConfirm={() => void confirm()}
      />
    </div>
  );
}
