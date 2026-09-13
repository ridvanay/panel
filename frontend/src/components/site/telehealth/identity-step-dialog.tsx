"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * `.claude/architect-scope-doctor-portfolio-identity-console.md` (**[DPI]**) §2.6 +
 * `.claude/design-notes-doctor-portfolio-console.md` §2 — booking akışına entegre "Kimlik
 * Bilgileri" adımı. Başlık KESİNLİKLE "Kimlik Bilgileri"dir — "Kimlik Doğrulama" YASAK ([DPI] §2.5).
 *
 * GÜVENLİK (kritik, [DPI] §6 madde 4): kimlik numarası bu bileşenin İÇİNDE yalnızca React state'te
 * (bellekte) tutulur — `localStorage`/`sessionStorage`/URL/analitik olayına ASLA yazılmaz. Girdi
 * `autoComplete="off"` + T.C. için `inputMode="numeric"` taşır.
 *
 * TCKN/pasaport format denetimi `lib/telehealth-identity.ts`'in (backend `lib/identity.ts`'in
 * BİREBİR istemci kopyası) saf fonksiyonlarıyla yapılır — bu YALNIZCA anlık UX geri bildirimidir,
 * **sunucu doğrulaması asıldır** ve 422 gövdesi bu bileşene `serverFieldErrors` ile geri yansıtılır.
 */

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

interface IdentityStepDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  /** `422 VALIDATION_ERROR`'ın `details` alanı — `identityNumber`/`countryCode`/`birthDate`. */
  serverFieldErrors?: Record<string, string>;
  serverError?: string | null;
  onContinue: (identity: BookingIdentityInput) => void;
  kvkkPage: Pick<SitePage, "title" | "slug"> | null;
  lang: string;
  defaultLocaleCode: string;
}

export function IdentityStepDialog({
  open,
  onOpenChange,
  submitting,
  serverFieldErrors,
  serverError,
  onContinue,
  kvkkPage,
  lang,
  defaultLocaleCode,
}: IdentityStepDialogProps) {
  const [citizenshipType, setCitizenshipType] = useState<Exclude<CitizenshipType, "FOREIGN_RESIDENT">>("TR");
  const [tcNumber, setTcNumber] = useState("");
  const [passportNumber, setPassportNumber] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [consent, setConsent] = useState(false);

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

  const identityFieldError =
    citizenshipType === "TR" ? serverFieldErrors?.identityNumber : serverFieldErrors?.identityNumber;
  const countryFieldError = serverFieldErrors?.countryCode;

  const canContinue =
    (citizenshipType === "TR" ? tcStatus === "valid" : Boolean(countryCode) && passportStatus === "valid") &&
    birthDateParsed !== null &&
    (age === null || age >= MIN_IDENTITY_AGE_YEARS) &&
    consent;

  function handleContinue() {
    if (!canContinue || !birthDateParsed) return;
    const identity: BookingIdentityInput =
      citizenshipType === "TR"
        ? { citizenshipType: "TR", identityNumber: normalizedTc, countryCode: "TR", birthDate: serializeIdentityBirthDate(birthDateParsed) }
        : {
            citizenshipType: "FOREIGN",
            identityNumber: normalizedPassport,
            countryCode,
            birthDate: serializeIdentityBirthDate(birthDateParsed),
          };
    onContinue(identity);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Kimlik Bilgileri</DialogTitle>
          <DialogDescription>
            Randevunuzun size düzenlenecek reçete/epikriz belgeleriyle doğru şekilde ilişkilendirilebilmesi için
            aşağıdaki bilgiler gereklidir.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={citizenshipType}
          onValueChange={(value) => setCitizenshipType(value as "TR" | "FOREIGN")}
        >
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

        <Button
          type="button"
          size="lg"
          className="w-full rounded-[var(--site-radius)]"
          disabled={!canContinue}
          loading={submitting}
          onClick={handleContinue}
        >
          Devam Et
        </Button>
      </DialogContent>
    </Dialog>
  );
}
