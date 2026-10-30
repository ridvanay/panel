"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Send } from "lucide-react";
import * as emailTemplatesApi from "@/lib/api/email-templates";
import type { SystemEmailAudience, SystemEmailListItem, SystemEmailSample } from "@/lib/api/email-templates";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { EmailPreviewPane } from "./preview-pane";

const AUDIENCE_LABEL: Record<SystemEmailAudience, string> = {
  patient: "Hasta",
  user: "Kullanıcı",
  staff: "Personel / doktor",
};

const LOCALE_LABEL: Record<string, string> = {
  tr: "Türkçe",
  en: "English",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  ar: "العربية",
  ru: "Русский",
  ro: "Română",
  "sr-latn": "Srpski",
};

function languagesLabel(value: string): string {
  if (value === "9") return "9 dil";
  if (value === "şablon") return "Şablon dili";
  return value.toUpperCase();
}

/**
 * Paket AC — sistemin gönderdiği her e-posta, örnek veriyle ve seçilen dilde, gerçekte gidecek
 * kurumsal kabukla önizlenir. "Kendime test gönder" yalnızca oturumdaki admin'in adresine gönderir.
 */
export function SystemEmailPreviews() {
  const [items, setItems] = useState<SystemEmailListItem[] | null>(null);
  const [locales, setLocales] = useState<string[]>(["tr"]);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [locale, setLocale] = useState("tr");
  const [sample, setSample] = useState<SystemEmailSample | null>(null);
  const [loading, setLoading] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    emailTemplatesApi
      .listSystemEmails()
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setLocales(data.locales);
        setSelectedId(data.items[0]?.id ?? null);
      })
      .catch((err) => {
        if (!cancelled) setListError(friendlyErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setSampleError(null);
      try {
        const data = await emailTemplatesApi.getSystemEmailSample(selectedId, locale);
        if (!cancelled) setSample(data);
      } catch (err) {
        if (!cancelled) setSampleError(friendlyErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, locale]);

  async function handleSendSelf() {
    if (!selectedId) return;
    setSending(true);
    try {
      const result = await emailTemplatesApi.sendSystemEmailToSelf(selectedId, locale);
      toast.success(`Test e-postası ${result.sentTo} adresine gönderildi.`);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  if (listError) {
    return (
      <Alert variant="error">
        <span className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {listError}
        </span>
      </Alert>
    );
  }

  if (!items) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  const selected = items.find((item) => item.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <nav aria-label="Sistem e-postaları" className="w-full shrink-0 lg:w-80">
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-current={item.id === selectedId ? "true" : undefined}
                onClick={() => setSelectedId(item.id)}
                className={cn(
                  "flex w-full flex-col items-start gap-1 px-4 py-2.5 text-left text-sm transition-colors hover:bg-primary/8",
                  item.id === selectedId ? "bg-primary/10 font-semibold text-primary" : "text-foreground"
                )}
              >
                <span>{item.label}</span>
                <span className="flex flex-wrap gap-1">
                  <Badge tone="neutral" size="sm">
                    {AUDIENCE_LABEL[item.audience]}
                  </Badge>
                  <Badge tone="neutral" size="sm">
                    {item.source === "template" ? "Şablon" : "Kod"} · {languagesLabel(item.languages)}
                  </Badge>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field id="system-email-locale" label="Alıcının dili">
            {(inputProps) => (
              <Select {...inputProps} value={locale} onChange={(e) => setLocale(e.target.value)}>
                {locales.map((code) => (
                  <option key={code} value={code}>
                    {LOCALE_LABEL[code] ?? code}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button type="button" variant="outline" size="sm" aria-pressed={showText} onClick={() => setShowText((v) => !v)}>
            {showText ? "HTML görünümü" : "Düz metin (text/plain)"}
          </Button>
          <Button type="button" size="sm" loading={sending} disabled={!selectedId || loading} onClick={handleSendSelf}>
            <Send className="h-4 w-4" />
            Kendime test gönder
          </Button>
        </div>

        {selected?.languages === "şablon" && (
          <p className="text-xs text-foreground/60">
            Bu e-postanın metni admin şablonundan gelir (tek dil); seçilen dil yalnızca alt bilgiyi (footer) ve yazı yönünü değiştirir.
          </p>
        )}
        {sample && !sample.available && (
          <Alert variant="warning">Bu amaç için aktif şablon yok — gerçekte bu e-posta gönderilmez ya da yedek metne düşer.</Alert>
        )}
        {sampleError && <Alert variant="error">{sampleError}</Alert>}

        {showText ? (
          <pre className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-card p-4 text-xs whitespace-pre-wrap shadow-sm">{sample?.text ?? ""}</pre>
        ) : (
          <EmailPreviewPane subject={sample?.subject ?? ""} html={sample?.html ?? null} loading={loading} />
        )}
      </div>
    </div>
  );
}
