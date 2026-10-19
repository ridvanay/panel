"use client";

import { Checkbox } from "@/components/ui/checkbox";

/**
 * Paket G — şifre değiştirme formlarında (admin "Hesabım" ve site "Hesabım > Profil") isteğe bağlı
 * "Diğer cihazlardaki oturumları hemen kapat". İşaretli değilse diğer cihazlar en geç access token
 * süresi (15 dk) dolunca düşer; işaretliyse anında. Mevcut oturum her iki durumda da sürer.
 */
export function RevokeOtherSessionsOption({
  id,
  checked,
  onCheckedChange,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} className="mt-0.5" />
      <label htmlFor={id} className="text-sm text-foreground/80">
        Diğer cihazlardaki oturumları hemen kapat
        <span className="block text-xs text-foreground/50">
          İşaretlemezseniz diğer cihazlar en geç 15 dakika içinde oturumdan düşer. Bu cihazdaki oturumunuz açık kalır.
        </span>
      </label>
    </div>
  );
}

export function passwordChangedMessage(revokeOtherSessions: boolean): string {
  return revokeOtherSessions
    ? "Şifreniz değiştirildi. Diğer cihazlardaki oturumlarınız hemen kapatıldı."
    : "Şifreniz değiştirildi. Diğer cihazlardaki oturumlarınız en geç 15 dakika içinde kapanacak.";
}
