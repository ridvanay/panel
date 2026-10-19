"use client";

import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { STAFF_TWO_FACTOR_SETUP_PATH, type StaffTwoFactorState } from "@/lib/staff-two-factor";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeStyle: "short" });

/**
 * Paket G — panel kabuğundaki personel 2FA uyarısı. "grace": son tarih bilgisi + kurulum bağlantısı;
 * "required": yalnızca 2FA kurulum sayfası açıkken gösterilir (kabuk diğer sayfaları buraya yönlendirir).
 */
export function StaffTwoFactorNotice({ state, requiredAt }: { state: StaffTwoFactorState; requiredAt: string | null }) {
  if (state === "none" || !requiredAt) return null;
  const deadline = dateFormatter.format(new Date(requiredAt));
  return (
    <Alert variant={state === "required" ? "error" : "warning"} className="mb-4">
      <span className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          {state === "required" ? (
            <>
              Yönetim paneline erişmek için iki adımlı doğrulamayı (2FA) kurmanız gerekiyor. Aşağıdaki
              “İki Adımlı Doğrulama” bölümünden kurulumu tamamlayın; ardından panel açılır.
            </>
          ) : (
            <>
              {deadline} itibarıyla yönetim paneli için iki adımlı doğrulama (2FA) zorunlu olacak.{" "}
              <Link href={STAFF_TWO_FACTOR_SETUP_PATH} className="font-medium underline">
                Şimdi kurun
              </Link>
            </>
          )}
        </span>
      </span>
    </Alert>
  );
}
