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

const bookingFormSchema = z.object({
  patientName: z.string().trim().min(1, "Ad soyad gerekli.").max(120),
  patientEmail: z.string().trim().min(1, "E-posta gerekli.").email("Geçerli bir e-posta girin.").max(255),
});
type BookingFormValues = z.infer<typeof bookingFormSchema>;

const TR_MONTHS = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

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
      ? "Geçersiz doğum tarihi."
      : age !== null && age < MIN_IDENTITY_AGE_YEARS
        ? "Bu platform 18 yaşından küçük kullanıcılar için kullanılamaz."
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
        <h3 className="text-sm font-semibold text-foreground">Hasta Bilgileri</h3>
        <p className="mt-0.5 text-xs text-foreground/60">Randevu kaydınızla ilişkilendirilecek iletişim bilgileri.</p>
      </div>

      <Field id="patientName" label="Ad soyad" error={errors.patientName?.message} required>
        {(inputProps) => <Input {...inputProps} {...register("patientName")} />}
      </Field>
      <Field
        id="patientEmail"
        label="E-posta"
        error={errors.patientEmail?.message}
        required
        hint="Ödeme onaylandığında güvenli erişim bağlantınız bu adrese gönderilecektir."
      >
        {(inputProps) => <Input {...inputProps} type="email" {...register("patientEmail")} />}
      </Field>

      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-semibold text-foreground">Kimlik Bilgileri</h3>
        <p className="mt-0.5 text-xs text-foreground/60">
          Randevunuzun size düzenlenecek reçete/epikriz belgeleriyle doğru şekilde ilişkilendirilebilmesi için gereklidir.
        </p>
      </div>

      <Tabs value={citizenshipType} onValueChange={(value) => setCitizenshipType(value as "TR" | "FOREIGN")}>
        <TabsList className="w-full">
          <TabsTrigger value="TR" className="flex-1">
            T.C. Vatandaşı
          </TabsTrigger>
          <TabsTrigger value="FOREIGN" className="flex-1">
            Yabancı Uyruklu
          </TabsTrigger>
        </TabsList>

        <TabsContent value="TR" className="mt-4 space-y-4">
          <Field id="identityNumber" label="T.C. Kimlik Numarası" required error={identityFieldError}>
            {(inputProps) => (
              <div className="relative">
                <Input
                  {...inputProps}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={11}
                  placeholder="11 haneli kimlik numaranız"
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
                        Geçerli
                      </Badge>
                    ) : (
                      <Badge tone="danger" solid size="sm" className="gap-1">
                        <AlertCircle className="h-3 w-3" aria-hidden="true" />
                        Geçersiz
                      </Badge>
                    )}
                  </span>
                )}
              </div>
            )}
          </Field>
        </TabsContent>

        <TabsContent value="FOREIGN" className="mt-4 space-y-4">
          <Field id="identityCountryCode" label="Uyruk Ülkesi" required error={countryFieldError}>
            {(inputProps) => (
              <Select {...inputProps} value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
                <option value="" disabled>
                  Ülke seçin
                </option>
                {ISO_COUNTRIES_EXCLUDING_TR.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.nameTr}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field id="passportNumber" label="Pasaport Numarası" required error={identityFieldError}>
            {(inputProps) => (
              <div className="relative">
                <Input
                  {...inputProps}
                  autoComplete="off"
                  maxLength={20}
                  placeholder="Pasaport numaranız"
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
                        Geçerli
                      </Badge>
                    ) : (
                      <Badge tone="danger" solid size="sm" className="gap-1">
                        <AlertCircle className="h-3 w-3" aria-hidden="true" />
                        Geçersiz
                      </Badge>
                    )}
                  </span>
                )}
              </div>
            )}
          </Field>
        </TabsContent>
      </Tabs>

      <Field id="birthDate" label="Doğum Tarihi" required error={birthDateError ?? undefined}>
        {() => (
          <div className="grid grid-cols-3 gap-2">
            <Select aria-label="Gün" value={day} onChange={(e) => setDay(e.target.value)}>
              <option value="" disabled>
                Gün
              </option>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
            <Select aria-label="Ay" value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="" disabled>
                Ay
              </option>
              {TR_MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </Select>
            <Select aria-label="Yıl" value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="" disabled>
                Yıl
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
          {kvkkPage ? (
            <Link
              href={withLocalePrefix(`/${kvkkPage.slug}`, lang, defaultLocaleCode)}
              target="_blank"
              className="text-primary underline-offset-4 hover:underline"
            >
              KVKK Aydınlatma Metni
            </Link>
          ) : (
            "KVKK Aydınlatma Metni"
          )}
          {"'"}ni okudum; ad-soyad, e-posta, T.C. Kimlik No/Pasaport No, doğum tarihi ve uyruk bilgim dahil kişisel
          verilerimin bu randevu kapsamında işlenmesine açık rızamı veriyorum.
        </label>
      </div>

      {serverError && <Alert variant="error">{serverError}</Alert>}

      {/* Gerçek submit butonu YOK — sağ sütundaki "Hizmet Özeti" panelinin TEK "Devam Et" butonu
          bu formu `requestSubmit()` ile tetikler (`booking-wizard.tsx`). `submitting` durumu da
          o butonun `loading` prop'una taşınır. */}
      <span className="sr-only" aria-live="polite">
        {submitting ? "Randevu oluşturuluyor…" : ""}
      </span>
    </form>
  );
});
