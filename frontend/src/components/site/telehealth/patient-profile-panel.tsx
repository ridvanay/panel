"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, AlertTriangle, CircleCheck, IdCard, Mail, Phone } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import * as usersApi from "@/lib/api/users";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { AppointmentBooking, BookingIdentitySummary } from "@/lib/api/types";
import { useAuth } from "@/context/auth-context";
import { useActiveLocaleCode } from "@/context/locale-alternates-context";
import { formatFullDayLabel } from "@/lib/telehealth-format";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * `frontend/src/app/[lang]/(site)/hesabim/profil/page.tsx::ADDRESS_PHONE_REGEX` deseniyle
 * BİREBİR aynı — backend `backend/src/modules/users/users.schemas.ts` (`Address.phone`)
 * gevşek doğrulamasının istemci tarafı yansısı. Ülke koduna göre değişir, katı E.164 ZORUNLU DEĞİL.
 */
const PHONE_REGEX = /^[0-9+()\-\s]{7,20}$/;

/** `PATCH /users/me` gövdesini yansıtan istemci şeması — boş bırakılabilir (`phone: null` gönderilir). */
const contactFormSchema = z.object({
  phone: z
    .string()
    .trim()
    .refine((value) => value === "" || PHONE_REGEX.test(value), "Geçerli bir telefon numarası giriniz.")
    .optional(),
});

type ContactFormValues = z.infer<typeof contactFormSchema>;

/**
 * `.claude/architect-scope-telehealth-template.md` §9.8.5 KARAR P — `/patient/profile`. Yeni veri
 * TOPLANMAZ/uç AÇILMAZ: künye, `GET /patient/bookings` yanıtındaki EN GÜNCEL (`identity.capturedAt`
 * en son) `identity !== null` booking'in MASKELİ özetinden türetilir. `GET .../identity` (açık
 * numara döner, her çağrı denetim kaydı üretir) ASLA çağrılmaz.
 *
 * `.claude/design-notes-telehealth.md` §14.6 (ENGELLEYİCİ dil kuralı, §9.8.5 madde 4) — künye
 * `tone="neutral"`dır, "doğrulandı/verified"/yeşil/`CircleCheck` KESİNLİKLE KULLANILMAZ. E-posta
 * rozeti AYRI bir `<section>`da, `success` tonu SERBESTTİR (`emailVerifiedAt` GERÇEK bir doğrulama
 * kaydıdır, madde 5).
 */
function latestIdentity(bookings: AppointmentBooking[]): BookingIdentitySummary | null {
  let latest: BookingIdentitySummary | null = null;
  for (const booking of bookings) {
    if (!booking.identity) continue;
    if (!latest || new Date(booking.identity.capturedAt).getTime() > new Date(latest.capturedAt).getTime()) {
      latest = booking.identity;
    }
  }
  return latest;
}

function ProfileSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-28 w-full rounded-[var(--site-radius)]" />
      <Skeleton className="h-20 w-full rounded-[var(--site-radius)]" />
    </div>
  );
}

export function PatientProfilePanel() {
  const { user, refreshSession } = useAuth();
  const intlLocale = contentLocaleToIntl(useActiveLocaleCode());
  const [bookings, setBookings] = useState<AppointmentBooking[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setBookings(null);
    try {
      const page = await telehealthApi.listPatientBookings({ scope: "all", limit: 20 });
      setBookings(page.items);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const {
    register: registerContact,
    handleSubmit: handleContactFormSubmit,
    formState: { errors: contactErrors, isSubmitting: contactSaving },
    setError: setContactFormError,
    reset: resetContactForm,
  } = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: { phone: user?.phone ?? "" },
  });

  useEffect(() => {
    if (user) resetContactForm({ phone: user.phone ?? "" });
  }, [user, resetContactForm]);

  async function onContactSubmit(values: ContactFormValues) {
    try {
      await usersApi.updateMe({ phone: values.phone || null });
      await refreshSession();
      toast.success("Telefon numaranız güncellendi.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setContactFormError("root", { message });
      toast.error(message);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Profilim</h1>
        <p className="mt-1 text-sm text-foreground/60">Hesap bilgilerinizi ve son paylaştığınız kimlik özetini buradan görüntüleyin.</p>
      </div>

      {loadError && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {loadError}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      {bookings === null && !loadError ? (
        <ProfileSkeleton />
      ) : (
        <>
          <section className="space-y-3 rounded-[var(--site-radius)] border border-border bg-surface p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <IdCard className="h-4 w-4 text-foreground/50" aria-hidden="true" />
              Kimlik Bilgileri
            </h2>
            {(() => {
              const identity = bookings ? latestIdentity(bookings) : null;
              if (!identity) {
                return <p className="text-sm text-foreground/50">Kimlik bilgisi bulunmuyor</p>;
              }
              return (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral" size="sm" className="gap-1 font-mono tabular-nums">
                      {identity.maskedNumber}
                    </Badge>
                    <span className="text-sm text-foreground/60">{identity.citizenshipType === "TR" ? "T.C. Vatandaşı" : identity.countryCode}</span>
                  </div>
                  <p className="text-xs text-foreground/50">Kimlik bilgisi alındı — {formatFullDayLabel(identity.capturedAt, Intl.DateTimeFormat().resolvedOptions().timeZone, intlLocale)}</p>
                </div>
              );
            })()}
          </section>

          <section className="space-y-3 rounded-[var(--site-radius)] border border-border bg-surface p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Mail className="h-4 w-4 text-foreground/50" aria-hidden="true" />
              Hesap Bilgileri
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-foreground">{user?.email}</span>
              {user?.emailVerifiedAt ? (
                <Badge tone="success" solid size="sm" className="gap-1">
                  <CircleCheck className="h-3 w-3" aria-hidden="true" />
                  E-posta Doğrulandı
                </Badge>
              ) : (
                <Badge tone="neutral" size="sm" className="gap-1">
                  <Mail className="h-3 w-3" aria-hidden="true" />
                  E-posta Doğrulanmadı
                </Badge>
              )}
            </div>
          </section>

          <section className="space-y-3 rounded-[var(--site-radius)] border border-border bg-surface p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Phone className="h-4 w-4 text-foreground/50" aria-hidden="true" />
              İletişim Bilgileri
            </h2>

            {contactErrors.root?.message && (
              <Alert variant="error">
                <span className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {contactErrors.root.message}
                </span>
              </Alert>
            )}

            <form onSubmit={handleContactFormSubmit(onContactSubmit)} noValidate className="space-y-4">
              <Field id="name" label="Ad Soyad">
                {(inputProps) => <Input {...inputProps} value={user?.name ?? ""} disabled readOnly />}
              </Field>

              <Field id="phone" label="Telefon Numarası" error={contactErrors.phone?.message} hint="Ör. 0555 123 45 67">
                {(inputProps) => (
                  <Input {...inputProps} type="tel" autoComplete="tel" placeholder="0555 123 45 67" {...registerContact("phone")} />
                )}
              </Field>

              <Button type="submit" loading={contactSaving}>
                Kaydet
              </Button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
