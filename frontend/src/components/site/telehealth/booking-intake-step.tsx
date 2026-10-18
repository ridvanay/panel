"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { useFriendlyError, usePortalStrings } from "@/lib/i18n/use-portal-strings";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { fetchLegalPagesClient, resolveExplicitConsentPage } from "@/lib/legal-pages";
import type { SitePage } from "@/lib/api/types";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { DocumentUploader } from "@/components/site/telehealth/document-uploader";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7.5 (ENGELLEYİCİ) + `.claude/design-notes-
 * telehealth.md` §12.3 — opsiyonel "Tıbbi Belgeler ve Ön Bilgiler" adımı. Metin
 * `.claude/compliance-notes-telehealth.md` "TUR 2" bölümünden AYNEN ALINMIŞTIR
 * (frontend-agent kendi rıza metnini YAZMAZ, §5.2 `ContactForm` emsali).
 *
 * Bu adım OPSİYONELDİR (§9.7.5 madde 1, bağlayıcı) — "Bu adımı atla" HİÇBİR KOŞULDA rezervasyonu/
 * ödemeyi engellemez, `onDone()` doğrudan çağrılır ve hiçbir istek gönderilmez.
 */

const HEALTH_DATA_CONSENT_VERSION = "v1";

interface BookingIntakeStepProps {
  bookingId: string;
  /** Misafir hasta magic-link'i — oturum-tabanlı erişimde (booking'in kendi sahibi) verilmez. */
  accessToken?: string;
  onDone: () => void;
  /**
   * Paket A2 — sağlık verisi açık rıza metni sayfası. Sihirbaz sunucuda çözüp geçirir; verilmezse
   * (ör. hasta randevu detayından sonradan ekliyorsa) yayınlanmış sayfalar istemcide okunur.
   * Sayfa yoksa metin link OLMADAN gösterilir.
   */
  explicitConsentPage?: Pick<SitePage, "title" | "slug"> | null;
}

export function BookingIntakeStep({ bookingId, accessToken, onDone, explicitConsentPage }: BookingIntakeStepProps) {
  const { t, lang } = usePortalStrings();
  const friendlyErrorMessage = useFriendlyError();
  const localize = useLocalizePath();
  const [fetchedConsentPage, setFetchedConsentPage] = useState<Pick<SitePage, "title" | "slug"> | null>(null);
  useEffect(() => {
    if (explicitConsentPage !== undefined) return;
    let cancelled = false;
    void fetchLegalPagesClient(lang).then((pages) => {
      if (!cancelled) setFetchedConsentPage(resolveExplicitConsentPage(pages));
    });
    return () => {
      cancelled = true;
    };
  }, [explicitConsentPage, lang]);
  const consentPage = explicitConsentPage ?? fetchedConsentPage;
  const [consentBodyBefore, consentBodyAfter = ""] = t.intake.consentBody.split("{notice}");
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [consentTouched, setConsentTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setConsentTouched(true);
    if (!consent) return;
    setSaving(true);
    setError(null);
    try {
      await telehealthApi.upsertBookingIntake(
        bookingId,
        { note: note.trim().length > 0 ? note.trim() : null, healthDataConsent: true, consentVersion: HEALTH_DATA_CONSENT_VERSION },
        accessToken
      );
      setSaved(true);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <div className="space-y-4">
        <Alert variant="success">
          <span>{t.intake.saved}</span>
        </Alert>
        <DocumentUploader bookingId={bookingId} accessToken={accessToken} />
        <Button type="button" onClick={onDone} className="w-full rounded-[var(--site-radius)]">
          {t.intake.continue}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-[var(--site-radius)] border border-border bg-surface p-4">
      <p className="text-xs text-foreground/60">{t.intake.optionalHint}</p>

      <div className="space-y-1.5">
        <label htmlFor="intake-note" className="block text-sm font-medium text-foreground">
          {t.intake.noteLabel} <span className="font-normal text-foreground/50">{t.intake.optional}</span>
        </label>
        <Textarea
          id="intake-note"
          rows={4}
          maxLength={2000}
          disabled={!consent}
          placeholder={t.intake.notePlaceholder}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {/*
        `.claude/compliance-notes-telehealth.md` "TUR 2" — Sağlık verisi rızası. Metin AYNEN
        alınmıştır, DEĞİŞTİRİLMEMİŞTİR. Randevu KVKK onay kutusundan TAMAMEN BAĞIMSIZ, ikinci
        bir onay kutusu; varsayılan İŞARETSİZ. İşaretlenmeden not/belge kabul edilmez (frontend:
        alanlar devre dışı; backend: 422 HEALTH_CONSENT_REQUIRED).
      */}
      <div className="rounded-[var(--site-radius)] border border-border bg-muted/50 p-3">
        <p className="text-sm font-semibold text-foreground">{t.intake.consentTitle}</p>
        <p className="mt-1.5 text-xs leading-5 text-foreground/70">
          {t.intake.consentIntro}
        </p>
        <p className="mt-2 text-xs leading-5 text-foreground/70">
          {consentBodyBefore}
          {consentPage ? (
            <Link href={localize(`/${consentPage.slug}`)} target="_blank" className="text-primary underline-offset-4 hover:underline">
              {t.intake.explicitConsentNotice}
            </Link>
          ) : (
            t.intake.explicitConsentNotice
          )}
          {consentBodyAfter}
        </p>
        <p className="mt-2 text-xs leading-5 text-foreground/70">
          {t.intake.consentWithdrawal}
        </p>

        <label htmlFor="health-data-consent" className="mt-3 flex items-start gap-2.5 text-sm text-foreground/80">
          <Checkbox
            id="health-data-consent"
            className="mt-0.5"
            aria-invalid={consentTouched && !consent ? true : undefined}
            checked={consent}
            onCheckedChange={(checked) => setConsent(checked === true)}
          />
          <span>{t.intake.consentCheckbox}</span>
        </label>
        {consentTouched && !consent && (
          <p role="alert" className="mt-1 pl-6 text-xs text-danger">
            {t.intake.consentRequired}
          </p>
        )}
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" onClick={onDone} className="rounded-[var(--site-radius)] sm:flex-1">
          {t.intake.skip}
        </Button>
        <Button type="button" onClick={() => void handleSave()} loading={saving} className="rounded-[var(--site-radius)] sm:flex-1">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {t.intake.saveAndContinue}
        </Button>
      </div>
    </div>
  );
}
