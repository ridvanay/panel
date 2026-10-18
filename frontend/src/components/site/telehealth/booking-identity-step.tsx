"use client";

import { forwardRef, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, CircleCheck } from "lucide-react";
import type { BookingIdentityInput, CitizenshipType, SitePage } from "@/lib/api/types";
import {
  calculateAgeYears,
  isValidPassportNumber,
  isValidTurkishIdentityNumber,
  MAX_IDENTITY_AGE_YEARS,
  MIN_IDENTITY_AGE_YEARS,
  normalizeIdentityNumber,
  parseIdentityBirthDateParts,
  serializeIdentityBirthDate,
} from "@/lib/telehealth-identity";
import { ISO_COUNTRIES_EXCLUDING_TR } from "@/lib/iso-countries";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { usePortalStrings } from "@/lib/i18n/use-portal-strings";
import type { PortalStrings } from "@/lib/i18n/site-dictionaries/en/portal";

/**
 * Grid görevi (2026-09-14) Görev 1 — eski `identity-step-dialog.tsx`'in `Dialog`/`DialogContent`
 * SARMALAYICISI kaldırılmış, `booking-wizard.tsx`'in 3. adımına (Hasta & Kimlik) GÖMÜLMÜŞ hâli.
 * `AvailabilityCalendar`'ın eski ad-soyad/e-posta formu da (`bookingFormSchema`, AYNI şema) BU
 * ADIMA taşındı — "Hasta & Kimlik Bilgileri" artık TEK bir adımda birleşiyor.
 *
 * Bu bileşen KENDİ submit butonunu RENDER ETMEZ (sağ sütundaki sticky "Hizmet Özeti" panelinin
 * TEK "Devam Et" butonu — `doctor-service-summary.tsx` — dışarıdan tetikler). Dış buton bu
 * bileşenin `<form>`'unu `ref.current.requestSubmit()` ile TETİKLER (native form submit,
 * Enter tuşu da AYNI yolu izler); doğrulama SONUCU (`canContinue`) `onCanContinueChange` ile
 * ANLIK olarak yukarı bildirilir ki dış buton kullanıcı hâlâ formu doldururken devre dışı kalsın.
 *
 * GÜVENLİK (kritik, [DPI] §6 madde 4) — kimlik numarası yalnızca React state'te (bellekte)
 * tutulur, `localStorage`/`sessionStorage`/URL/analitik olayına ASLA yazılmaz (eski dosyadan
 * DEĞİŞMEDEN taşındı).
 *
 * qa-agent NOTU — eski `telehealth-identity-ui.ts` yardımcı fonksiyonları `page.getByRole("dialog",
 * { name: "Kimlik Bilgileri" })` ile SCOPE ediyordu; bu adım ARTIK bir `Dialog` DEĞİL, doğrudan
 * sayfanın İÇİNDE (bkz. `data-testid="booking-identity-step"` kök `<form>`). Alan `label`'ları/
 * `id`'leri (`identityNumber`, `passportNumber`, `identityConsent`, "T.C. Kimlik Numarası", "Gün"/
 * "Ay"/"Yıl") BİREBİR KORUNDU — qa-agent yalnızca `dialog` scope'unu bu `data-testid`'e çevirmesi
 * yeterli olmalı.
 */

function buildBookingFormSchema(t: PortalStrings["identity"]) {
  return z.object({
    patientName: z.string().trim().min(1, t.nameRequired).max(120),
    patientEmail: z.string().trim().min(1, t.emailRequired).email(t.emailInvalid).max(255),
  });
}
type BookingFormValues = z.infer<ReturnType<typeof buildBookingFormSchema>>;

/** Ay adları aktif dilde `Intl` ile üretilir (eski sabit `TR_MONTHS` listesinin yerine). */
function buildMonthNames(intlLocale: string): string[] {
  const formatter = new Intl.DateTimeFormat(intlLocale, { month: "long", timeZone: "UTC" });
  return Array.from({ length: 12 }, (_, i) => formatter.format(new Date(Date.UTC(2000, i, 1))));
}

function buildYearOptions(now: Date): number[] {
  const currentYear = now.getUTCFullYear();
  const years: number[] = [];
  for (let y = currentYear - MIN_IDENTITY_AGE_YEARS; y >= currentYear - MAX_IDENTITY_AGE_YEARS; y--) years.push(y);
  return years;
}

interface BookingIdentityStepProps {
  submitting: boolean;
  /** `422 VALIDATION_ERROR`'ın `details` alanı — `identityNumber`/`countryCode`/`birthDate`. */
  serverFieldErrors?: Record<string, string>;
  serverError?: string | null;
  onContinue: (identity: BookingIdentityInput, patientName: string, patientEmail: string) => void;
  /** Dış "Devam Et" butonunun `disabled` durumu için — her doğrulama değişiminde çağrılır. */
  onCanContinueChange: (canContinue: boolean) => void;
  kvkkPage: Pick<SitePage, "title" | "slug"> | null;
  lang: string;
  defaultLocaleCode: string;
}

export const BookingIdentityStep = forwardRef<HTMLFormElement, BookingIdentityStepProps>(function BookingIdentityStep(
  { submitting, serverFieldErrors, serverError, onContinue, onCanContinueChange, kvkkPage, lang, defaultLocaleCode },
  ref
) {
  const { t, lang: uiLang, intlLocale } = usePortalStrings();
  const bookingFormSchema = useMemo(() => buildBookingFormSchema(t.identity), [t]);
  const monthNames = useMemo(() => buildMonthNames(intlLocale), [intlLocale]);
  const countryOptions = useMemo(() => {
    if (uiLang === "tr") return ISO_COUNTRIES_EXCLUDING_TR.map((c) => ({ code: c.code, name: c.nameTr }));
    let regionNames: Intl.DisplayNames | null = null;
    try {
      regionNames = new Intl.DisplayNames([intlLocale], { type: "region" });
    } catch {
      regionNames = null;
    }
    return ISO_COUNTRIES_EXCLUDING_TR.map((c) => ({ code: c.code, name: regionNames?.of(c.code) ?? c.nameTr })).sort((a, b) =>
      a.name.localeCompare(b.name, intlLocale)
    );
  }, [uiLang, intlLocale]);
  const [consentBefore, consentAfter = ""] = t.identity.consentText.split("{notice}");
  const [citizenshipType, setCitizenshipType] = useState<Exclude<CitizenshipType, "FOREIGN_RESIDENT">>("TR");
  const [tcNumber, setTcNumber] = useState("");
  const [passportNumber, setPassportNumber] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [consent, setConsent] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<BookingFormValues>({
    resolver: zodResolver(bookingFormSchema),
    defaultValues: { patientName: "", patientEmail: "" },
  });
  const patientNameValue = watch("patientName");
  const patientEmailValue = watch("patientEmail");

  const now = useMemo(() => new Date(), []);
  const yearOptions = useMemo(() => buildYearOptions(now), [now]);

  const normalizedTc = normalizeIdentityNumber("TR", tcNumber);
  const tcStatus: "idle" | "valid" | "invalid" =
    normalizedTc.length < 11 ? "idle" : isValidTurkishIdentityNumber(normalizedTc) ? "valid" : "invalid";

  const normalizedPassport = normalizeIdentityNumber("FOREIGN", passportNumber);
  const passportStatus: "idle" | "valid" | "invalid" =
    normalizedPassport.length < 6 ? "idle" : isValidPassportNumber(normalizedPassport) ? "valid" : "invalid";

  const birthDateParsed =
    day && month && year ? parseIdentityBirthDateParts(Number(year), Number(month), Number(day), now) : null;
  const age = birthDateParsed ? calculateAgeYears(birthDateParsed, now) : null;
  const birthDateError =
    day && month && year && !birthDateParsed
      ? t.identity.birthDateInvalid
      : age !== null && age < MIN_IDENTITY_AGE_YEARS
        ? t.identity.minorNotAllowed
        : (serverFieldErrors?.birthDate ?? null);

  const identityFieldError = serverFieldErrors?.identityNumber;
  const countryFieldError = serverFieldErrors?.countryCode;

  const identityCanContinue =
    (citizenshipType === "TR" ? tcStatus === "valid" : Boolean(countryCode) && passportStatus === "valid") &&
    birthDateParsed !== null &&
    (age === null || age >= MIN_IDENTITY_AGE_YEARS) &&
    consent;

  const patientInfoValid = bookingFormSchema.safeParse({
    patientName: patientNameValue,
    patientEmail: patientEmailValue,
  }).success;

  const canContinue = identityCanContinue && patientInfoValid;

  // `onCanContinueChange` — `booking-wizard.tsx`'ten `setIdentityCanContinue` (bir `useState`
  // setter'ı) DOĞRUDAN geçirilir; setter referansı React tarafından SABİT tutulur, bu yüzden
  // dependency dizisine GÜVENLE eklenebilir (gereksiz efekt tekrarı YOK).
  useEffect(() => {
    onCanContinueChange(canContinue);
  }, [canContinue, onCanContinueChange]);

  function onPatientInfoValid(values: BookingFormValues) {
    if (!identityCanContinue || !birthDateParsed) return;
    const identity: BookingIdentityInput =
      citizenshipType === "TR"
        ? { citizenshipType: "TR", identityNumber: normalizedTc, countryCode: "TR", birthDate: serializeIdentityBirthDate(birthDateParsed) }
        : {
            citizenshipType: "FOREIGN",
            identityNumber: normalizedPassport,
            countryCode,
            birthDate: serializeIdentityBirthDate(birthDateParsed),
          };
    onContinue(identity, values.patientName, values.patientEmail);
  }

  return (
    <form
      ref={ref}
      data-testid="booking-identity-step"
      className="space-y-4 rounded-[var(--site-radius)] border border-border bg-surface p-4 sm:p-5"
      onSubmit={handleSubmit(onPatientInfoValid)}
      noValidate
    >
      <div>
        <h3 className="text-sm font-semibold text-foreground">{t.identity.patientInfoTitle}</h3>
        <p className="mt-0.5 text-xs text-foreground/60">{t.identity.patientInfoDescription}</p>
      </div>

      <Field id="patientName" label={t.identity.fullName} error={errors.patientName?.message} required>
        {(inputProps) => <Input {...inputProps} {...register("patientName")} />}
      </Field>
      <Field
        id="patientEmail"
        label={t.identity.email}
        error={errors.patientEmail?.message}
        required
        hint={t.identity.emailHint}
      >
        {(inputProps) => <Input {...inputProps} type="email" {...register("patientEmail")} />}
      </Field>

      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-semibold text-foreground">{t.identity.identityTitle}</h3>
        <p className="mt-0.5 text-xs text-foreground/60">
          {t.identity.identityDescription}
        </p>
      </div>

      <Tabs value={citizenshipType} onValueChange={(value) => setCitizenshipType(value as "TR" | "FOREIGN")}>
        <TabsList className="w-full">
          <TabsTrigger value="TR" className="flex-1">
            {t.identity.turkishCitizen}
          </TabsTrigger>
          <TabsTrigger value="FOREIGN" className="flex-1">
            {t.identity.foreignNational}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="TR" className="mt-4 space-y-4">
          <Field id="identityNumber" label={t.identity.tcNumber} required error={identityFieldError}>
            {(inputProps) => (
              <div className="relative">
                <Input
                  {...inputProps}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={11}
                  placeholder={t.identity.tcPlaceholder}
                  value={tcNumber}
                  onChange={(e) => setTcNumber(e.target.value.replace(/[^\d]/g, "").slice(0, 11))}
                  className={cn(
                    "pr-28",
                    tcStatus === "valid" && "border-success focus-visible:ring-success/30",
                    tcStatus === "invalid" && "border-danger focus-visible:ring-danger/30"
                  )}
                />
                {tcStatus !== "idle" && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2">
                    {tcStatus === "valid" ? (
                      <Badge tone="success" solid size="sm" className="gap-1">
                        <CircleCheck className="h-3 w-3" aria-hidden="true" />
                        {t.identity.valid}
                      </Badge>
                    ) : (
                      <Badge tone="danger" solid size="sm" className="gap-1">
                        <AlertCircle className="h-3 w-3" aria-hidden="true" />
                        {t.identity.invalid}
                      </Badge>
                    )}
                  </span>
                )}
              </div>
            )}
          </Field>
        </TabsContent>

        <TabsContent value="FOREIGN" className="mt-4 space-y-4">
          <Field id="identityCountryCode" label={t.identity.nationality} required error={countryFieldError}>
            {(inputProps) => (
              <Select {...inputProps} value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
                <option value="" disabled>
                  {t.identity.selectCountry}
                </option>
                {countryOptions.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field id="passportNumber" label={t.identity.passportNumber} required error={identityFieldError}>
            {(inputProps) => (
              <div className="relative">
                <Input
                  {...inputProps}
                  autoComplete="off"
                  maxLength={20}
                  placeholder={t.identity.passportPlaceholder}
                  value={passportNumber}
                  onChange={(e) => setPassportNumber(e.target.value.toUpperCase())}
                  className={cn(
                    "pr-28",
                    passportStatus === "valid" && "border-success focus-visible:ring-success/30",
                    passportStatus === "invalid" && "border-danger focus-visible:ring-danger/30"
                  )}
                />
                {passportStatus !== "idle" && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2">
                    {passportStatus === "valid" ? (
                      <Badge tone="success" solid size="sm" className="gap-1">
                        <CircleCheck className="h-3 w-3" aria-hidden="true" />
                        {t.identity.valid}
                      </Badge>
                    ) : (
                      <Badge tone="danger" solid size="sm" className="gap-1">
                        <AlertCircle className="h-3 w-3" aria-hidden="true" />
                        {t.identity.invalid}
                      </Badge>
                    )}
                  </span>
                )}
              </div>
            )}
          </Field>
        </TabsContent>
      </Tabs>

      <Field id="birthDate" label={t.identity.birthDate} required error={birthDateError ?? undefined}>
        {() => (
          <div className="grid grid-cols-3 gap-2">
            <Select aria-label={t.identity.day} value={day} onChange={(e) => setDay(e.target.value)}>
              <option value="" disabled>
                {t.identity.day}
              </option>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
            <Select aria-label={t.identity.month} value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="" disabled>
                {t.identity.month}
              </option>
              {monthNames.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </Select>
            <Select aria-label={t.identity.year} value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="" disabled>
                {t.identity.year}
              </option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>
        )}
      </Field>

      <div className="flex items-start gap-2">
        <Checkbox id="identityConsent" checked={consent} onCheckedChange={(checked) => setConsent(checked === true)} className="mt-0.5" />
        <label htmlFor="identityConsent" className="text-xs leading-5 text-foreground/70">
          {consentBefore}
          {kvkkPage ? (
            <Link
              href={withLocalePrefix(`/${kvkkPage.slug}`, lang, defaultLocaleCode)}
              target="_blank"
              className="text-primary underline-offset-4 hover:underline"
            >
              {t.identity.kvkkNotice}
            </Link>
          ) : (
            t.identity.kvkkNotice
          )}
          {consentAfter}
        </label>
      </div>

      {serverError && <Alert variant="error">{serverError}</Alert>}

      {/* Gerçek submit butonu YOK — sağ sütundaki "Hizmet Özeti" panelinin TEK "Devam Et" butonu
          bu formu `requestSubmit()` ile tetikler (`booking-wizard.tsx`). `submitting` durumu da
          o butonun `loading` prop'una taşınır. */}
      <span className="sr-only" aria-live="polite">
        {submitting ? t.identity.submitting : ""}
      </span>
    </form>
  );
});
