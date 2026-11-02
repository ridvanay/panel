"use client";

import { Mail } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DEFAULT_BOOKING_NOTIFICATION_RECIPIENT } from "@/lib/booking-notification-recipients";

export interface BookingRecipientsCardProps {
  /** `true` = alan hiç ayarlanmamış (kayıtlı değer `null`) → varsayılan adres kullanılır. */
  useDefault: boolean;
  /** Alan metni (`useDefault` iken boş). */
  value: string;
  /** İstemci doğrulama hatası (varsa). */
  error?: string;
  onChange: (value: string) => void;
  onResetToDefault: () => void;
}

/**
 * Paket AG - Admin → Ayarlar: "Randevu bildirimi alıcıları". Alan boş bırakılırsa (ve "varsayılan" kullanılmıyorsa)
 * bildirim GİTMEZ; "Varsayılana dön" `null` gönderir (kodda varsayılan adres).
 */
export function BookingRecipientsCard({ useDefault, value, error, onChange, onResetToDefault }: BookingRecipientsCardProps) {
  return (
    <Card className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Mail className="h-4 w-4" />
        </span>
        <div>
          <h2 className="admin-h2">Randevu bildirimi alıcıları</h2>
          <p className="mt-0.5 admin-text-secondary">
            Yeni, iptal edilen veya saati değişen her randevuda bu adreslere bildirim e-postası gider (hasta bilgisi içermez).
          </p>
        </div>
      </div>
      <Field
        id="bookingNotificationRecipients"
        label="Alıcı e-posta adresleri"
        hint="Virgülle ayırın. Boş bırakılırsa bildirim gönderilmez."
        error={error}
      >
        {(inputProps) => (
          <Input
            {...inputProps}
            type="text"
            inputMode="email"
            autoComplete="off"
            value={value}
            placeholder={useDefault ? `Varsayılan: ${DEFAULT_BOOKING_NOTIFICATION_RECIPIENT}` : "ornek@alanadi.com, baska@alanadi.com"}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </Field>
      {useDefault ? (
        <p className="text-xs text-foreground/60" data-testid="booking-recipients-default-note">
          Varsayılan alıcı kullanılıyor: <strong>{DEFAULT_BOOKING_NOTIFICATION_RECIPIENT}</strong>
        </p>
      ) : (
        <div className="flex items-center gap-3">
          {value.trim() === "" && (
            <p className="text-xs text-warning" data-testid="booking-recipients-empty-note">
              Alan boş — randevu bildirimi gönderilmeyecek.
            </p>
          )}
          <Button type="button" variant="outline" size="sm" onClick={onResetToDefault}>
            Varsayılana dön
          </Button>
        </div>
      )}
    </Card>
  );
}
