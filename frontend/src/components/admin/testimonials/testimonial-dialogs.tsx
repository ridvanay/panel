"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, AlertTriangle } from "lucide-react";
import * as api from "@/lib/api/testimonials";
import type { AdminTestimonial } from "@/lib/api/testimonials";
import { SHOWCASE_LOCALES } from "@/lib/api/doctor-showcase";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const CONSENT_NOTE_MIN = 10;
export const MANUAL_NO_BADGE_NOTE = "Manuel yorumlara “Doğrulanmış hasta” rozeti verilmez.";
export const NO_FABRICATION_WARNING = "Uydurma yorum girmeyin. Yalnızca gerçek bir hastadan, yayın izni alınmış yorumlar eklenebilir; izin kanıtını aşağıya yazın.";

function DialogError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="error">
      <span className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {message}
      </span>
    </Alert>
  );
}

/**
 * Maskeleme (karartma). Metin DÜZENLENEMEZ: yorum yalnızca okunur gösterilir; yöneticinin seçtiği ya da yazdığı ifade
 * sunucuda `█` ile değiştirilir. Geri alınamaz, audit'e yalnızca alan ve uzunluk yazılır.
 */
export function RedactDialog({ testimonial, onClose, onDone }: { testimonial: AdminTestimonial | null; onClose: () => void; onDone: (t: AdminTestimonial) => void }) {
  const [field, setField] = useState<"title" | "body">("body");
  const [snippet, setSnippet] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLParagraphElement>(null);

  function captureSelection() {
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    const text = sel?.toString() ?? "";
    if (text.trim() && textRef.current && sel?.anchorNode && textRef.current.contains(sel.anchorNode)) setSnippet(text.trim());
  }

  async function submit() {
    if (!testimonial) return;
    const value = snippet.trim();
    if (value.length < 2) {
      setError("Maskelenecek ifade en az 2 karakter olmalı.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api.redactTestimonial(testimonial.id, field, value);
      toast.success("İfade maskelendi.");
      setSnippet("");
      onDone(updated);
    } catch (err) {
      const fe = fieldErrorsFrom(err);
      setError(fe.snippet ?? friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const shown = testimonial ? (field === "title" ? testimonial.title : testimonial.body) : "";

  return (
    <Dialog open={testimonial !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Kişisel / sağlık bilgisini maskele</DialogTitle>
          <DialogDescription>Yorum metni değiştirilemez. Yalnızca seçtiğiniz ifade “█” ile karartılır; bu işlem geri alınamaz ve kayda geçer.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field id="redact-field" label="Alan">
            {(inputProps) => (
              <Select {...inputProps} value={field} onChange={(e) => setField(e.target.value as "title" | "body")}>
                <option value="body">Metin</option>
                <option value="title">Başlık</option>
              </Select>
            )}
          </Field>
          <div>
            <p className="mb-1 text-xs font-medium text-foreground/60">Metinden karartılacak ifadeyi fare ile seçin</p>
            <p ref={textRef} onMouseUp={captureSelection} onKeyUp={captureSelection} className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-muted p-2 text-sm" data-testid="redact-source-text">
              {shown}
            </p>
          </div>
          <Field id="redact-snippet" label="Maskelenecek ifade" hint="Seçim buraya otomatik yazılır; elle de yazabilirsiniz (metinde aynen geçmeli).">
            {(inputProps) => <Input {...inputProps} value={snippet} maxLength={300} onChange={(e) => setSnippet(e.target.value)} />}
          </Field>
          <DialogError message={error} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="button" variant="destructive" loading={saving} onClick={() => void submit()}>
            Maskele
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Yönetici çevirisi: yorumun orijinal metni değişmez; seçilen dil için çeviri eklenir/güncellenir. */
export function TranslationDialog({ testimonial, onClose, onDone }: { testimonial: AdminTestimonial | null; onClose: () => void; onDone: (t: AdminTestimonial) => void }) {
  const [locale, setLocale] = useState<string>("en");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(code: string) {
    setLocale(code);
    const existing = testimonial?.translations?.[code];
    setTitle(existing?.title ?? "");
    setBody(existing?.body ?? "");
  }

  async function submit() {
    if (!testimonial) return;
    if (!body.trim()) {
      setError("Çeviri metni boş olamaz.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const translations: Record<string, { title: string; body: string }> = {};
      for (const [code, t] of Object.entries(testimonial.translations ?? {})) translations[code] = { title: t.title ?? "", body: t.body };
      translations[locale] = { title: title.trim(), body: body.trim() };
      const updated = await api.updateTestimonial(testimonial.id, { translations });
      toast.success("Çeviri kaydedildi.");
      onDone(updated);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const languages = SHOWCASE_LOCALES.filter((c) => c !== testimonial?.language);

  return (
    <Dialog open={testimonial !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg" key={testimonial?.id ?? "none"}>
        <DialogHeader>
          <DialogTitle>Yönetici çevirisi</DialogTitle>
          <DialogDescription>Orijinal metin değişmez; sitede “Çeviriyi göster” anahtarıyla sunulur. Anlamı değiştirmeden çevirin.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field id="translation-locale" label="Çeviri dili">
            {(inputProps) => (
              <Select {...inputProps} value={locale} onChange={(e) => pick(e.target.value)}>
                {languages.map((c) => (
                  <option key={c} value={c}>
                    {c.toUpperCase()}
                    {testimonial?.translations?.[c] ? " •" : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="translation-title" label="Çeviri başlığı">
            {(inputProps) => <Input {...inputProps} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} dir={locale === "ar" ? "rtl" : undefined} />}
          </Field>
          <Field id="translation-body" label="Çeviri metni" required>
            {(inputProps) => <Textarea {...inputProps} rows={5} value={body} maxLength={3000} onChange={(e) => setBody(e.target.value)} dir={locale === "ar" ? "rtl" : undefined} />}
          </Field>
          <DialogError message={error} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="button" loading={saving} onClick={() => void submit()}>
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Hekim yanıtı (herkese açık görünür). */
export function ReplyDialog({ testimonial, onClose, onDone }: { testimonial: AdminTestimonial | null; onClose: () => void; onDone: (t: AdminTestimonial) => void }) {
  const [reply, setReply] = useState(testimonial?.doctorReply ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!testimonial) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateTestimonial(testimonial.id, { doctorReply: reply.trim() || null });
      toast.success("Hekim yanıtı kaydedildi.");
      onDone(updated);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={testimonial !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg" key={testimonial?.id ?? "none"}>
        <DialogHeader>
          <DialogTitle>Hekim yanıtı</DialogTitle>
          <DialogDescription>Yorumun altında herkese açık gösterilir. Hasta bilgisi içermemeli. Boş bırakıp kaydederseniz yanıt kaldırılır.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field id="doctor-reply" label="Yanıt">
            {(inputProps) => <Textarea {...inputProps} rows={5} maxLength={1500} value={reply} onChange={(e) => setReply(e.target.value)} />}
          </Field>
          <DialogError message={error} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="button" loading={saving} onClick={() => void submit()}>
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface DoctorOption {
  id: string;
  label: string;
}

/** Manuel yorum: onay kanıtı notu ZORUNLU (en az 10 karakter); "Doğrulanmış hasta" rozeti verilmez. */
export function ManualTestimonialDialog({ open, doctors, onClose, onDone }: { open: boolean; doctors: DoctorOption[]; onClose: () => void; onDone: (t: AdminTestimonial) => void }) {
  const [doctorId, setDoctorId] = useState("");
  const [authorDisplay, setAuthorDisplay] = useState("");
  const [country, setCountry] = useState("");
  const [language, setLanguage] = useState("en");
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [source, setSource] = useState<"manual_with_consent" | "imported">("manual_with_consent");
  const [evidence, setEvidence] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit() {
    const next: Record<string, string> = {};
    if (evidence.trim().length < CONSENT_NOTE_MIN) next.consentEvidenceNote = `Onay kanıtı notu zorunlu (en az ${CONSENT_NOTE_MIN} karakter).`;
    if (!authorDisplay.trim()) next.authorDisplay = "Görünen ad gerekli (ör. M. K.).";
    if (title.trim().length < 3) next.title = "Başlık en az 3 karakter olmalı.";
    if (body.trim().length < 30) next.body = "Metin en az 30 karakter olmalı.";
    if (country.trim() && !/^[A-Za-z]{2}$/.test(country.trim())) next.country = "İki harfli ülke kodu girin (ör. DE).";
    setErrors(next);
    setError(null);
    if (Object.keys(next).length > 0) return;
    setSaving(true);
    try {
      const created = await api.createManualTestimonial({
        doctorId: doctorId || null,
        authorDisplay: authorDisplay.trim(),
        country: country.trim() ? country.trim().toUpperCase() : null,
        language,
        rating,
        title: title.trim(),
        body: body.trim(),
        source,
        consentEvidenceNote: evidence.trim(),
      });
      toast.success("Yorum eklendi; onay bekliyor.");
      onDone(created);
    } catch (err) {
      setError(friendlyErrorMessage(err));
      setErrors(fieldErrorsFrom(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manuel yorum ekle</DialogTitle>
          <DialogDescription>{MANUAL_NO_BADGE_NOTE}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Alert variant="warning">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {NO_FABRICATION_WARNING}
            </span>
          </Alert>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="manual-doctor" label="Hekim (opsiyonel)" hint="Boşsa kurum yorumu olur.">
              {(inputProps) => (
                <Select {...inputProps} value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                  <option value="">Kurum yorumu</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="manual-source" label="Kaynak" required>
              {(inputProps) => (
                <Select {...inputProps} value={source} onChange={(e) => setSource(e.target.value as "manual_with_consent" | "imported")}>
                  <option value="manual_with_consent">Manuel (hasta onaylı)</option>
                  <option value="imported">İçe aktarılan (başka platform)</option>
                </Select>
              )}
            </Field>
            <Field id="manual-author" label="Görünen ad" required error={errors.authorDisplay} hint="Ör. M. K.">
              {(inputProps) => <Input {...inputProps} maxLength={80} value={authorDisplay} onChange={(e) => setAuthorDisplay(e.target.value)} />}
            </Field>
            <Field id="manual-country" label="Ülke (ISO-2)" error={errors.country}>
              {(inputProps) => <Input {...inputProps} maxLength={2} className="w-24" value={country} onChange={(e) => setCountry(e.target.value)} />}
            </Field>
            <Field id="manual-language" label="Yorum dili" required>
              {(inputProps) => (
                <Select {...inputProps} value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {SHOWCASE_LOCALES.map((c) => (
                    <option key={c} value={c}>
                      {c.toUpperCase()}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="manual-rating" label="Puan" required>
              {(inputProps) => (
                <Select {...inputProps} value={rating} onChange={(e) => setRating(Number(e.target.value))}>
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field id="manual-title" label="Başlık" required error={errors.title}>
            {(inputProps) => <Input {...inputProps} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field id="manual-body" label="Yorum metni (hastanın kendi sözleri, olduğu gibi)" required error={errors.body}>
            {(inputProps) => <Textarea {...inputProps} rows={5} maxLength={1500} value={body} onChange={(e) => setBody(e.target.value)} />}
          </Field>
          <Field id="manual-evidence" label="Onay kanıtı notu" required error={errors.consentEvidenceNote} hint="Hastanın yayın iznini nasıl ve ne zaman verdiğini yazın (e-posta tarihi, form no vb.). Kişisel veri yazmayın.">
            {(inputProps) => <Textarea {...inputProps} rows={3} maxLength={1000} value={evidence} onChange={(e) => setEvidence(e.target.value)} />}
          </Field>
          <DialogError message={error} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="button" loading={saving} onClick={() => void submit()}>
            Ekle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
