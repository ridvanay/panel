"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Info, MessageCircle } from "lucide-react";
import * as packagesApi from "@/lib/api/admin-packages";
import type { ContactChannelsSettings } from "@/lib/api/admin-packages";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { SUPPORT_LANGUAGE_CHOICES } from "@/components/admin/telehealth/language-support-settings";
import { cn } from "@/lib/utils";

export const E164_RE = /^\+[1-9]\d{6,14}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MESSAGE_MAX = 300;

export interface ContactChannelsForm {
  whatsappEnabled: boolean;
  whatsappNumber: string;
  coordinatorEmail: string;
  whatsappMessages: Record<string, string>;
}

export function toContactForm(s: ContactChannelsSettings): ContactChannelsForm {
  return {
    whatsappEnabled: s.whatsappEnabled,
    whatsappNumber: s.whatsappNumber ?? "",
    coordinatorEmail: s.coordinatorEmail ?? "",
    whatsappMessages: { ...(s.whatsappMessages ?? {}) },
  };
}

/** Açıkken numara zorunlu; numara E.164 (+905551234567); mesajda yalnızca `{package}` yer tutucusu. */
export function validateContactChannels(form: ContactChannelsForm): Record<string, string> {
  const errors: Record<string, string> = {};
  const number = form.whatsappNumber.trim();
  if (form.whatsappEnabled && !number) errors.whatsappNumber = "WhatsApp açıkken numara zorunludur.";
  else if (number && !E164_RE.test(number)) errors.whatsappNumber = "Numara uluslararası biçimde olmalıdır: + ile başlayıp 7–15 rakam (ör. +905551234567).";
  const email = form.coordinatorEmail.trim();
  if (email && !EMAIL_RE.test(email)) errors.coordinatorEmail = "Geçerli bir e-posta adresi girin.";
  for (const [code, msg] of Object.entries(form.whatsappMessages)) {
    const stray = (msg.match(/\{[^}]*\}/g) ?? []).find((p) => p !== "{package}");
    if (stray) errors.whatsappMessages = `${code.toUpperCase()} mesajında yalnızca {package} yer tutucusu kullanılabilir (${stray} geçersiz).`;
    else if (msg.length > MESSAGE_MAX) errors.whatsappMessages = `${code.toUpperCase()} mesajı en fazla ${MESSAGE_MAX} karakter olabilir.`;
  }
  return errors;
}

export function buildContactChannelsBody(form: ContactChannelsForm): ContactChannelsSettings {
  const whatsappMessages: Record<string, string> = {};
  for (const [code, msg] of Object.entries(form.whatsappMessages)) if (msg.trim()) whatsappMessages[code] = msg.trim();
  return {
    whatsappEnabled: form.whatsappEnabled,
    whatsappNumber: form.whatsappNumber.trim() || null,
    coordinatorEmail: form.coordinatorEmail.trim() || null,
    whatsappMessages,
  };
}

/**
 * Paket X — iletişim kanalları. DOĞRULUK KURALI: WhatsApp varsayılan kapalıdır; numara girilip açılmadan
 * sitede hiçbir WhatsApp düğmesi çizilmez. Kaydetme yalnızca ADMIN (MANAGER salt okunur).
 */
export function ContactChannelsSettingsCard({ canEdit }: { canEdit: boolean }) {
  const [saved, setSaved] = useState<ContactChannelsSettings | null>(null);
  const [form, setForm] = useState<ContactChannelsForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<string>(SUPPORT_LANGUAGE_CHOICES[0]);

  async function load() {
    setLoadError(null);
    try {
      const s = await packagesApi.getContactChannelsSettings();
      setSaved(s);
      setForm(toContactForm(s));
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, []);

  if (loadError) {
    return (
      <Card data-testid="contact-channels-settings">
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {loadError}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      </Card>
    );
  }
  if (!form || !saved) {
    return (
      <Card data-testid="contact-channels-settings">
        <div className="flex justify-center py-6">
          <Spinner className="h-5 w-5 text-primary" />
        </div>
      </Card>
    );
  }

  const dirty = JSON.stringify(toContactForm(saved)) !== JSON.stringify(form);

  function patch(p: Partial<ContactChannelsForm>) {
    setForm((f) => (f ? { ...f, ...p } : f));
  }

  async function save() {
    if (!form) return;
    const found = validateContactChannels(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await packagesApi.updateContactChannelsSettings(buildContactChannelsBody(form));
      setSaved(updated);
      setForm(toContactForm(updated));
      toast.success("İletişim kanalları kaydedildi.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-5" data-testid="contact-channels-settings">
      <div className="flex items-start gap-3">
        <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <h2 className="admin-h2">İletişim kanalları</h2>
          <p className="mt-0.5 admin-text-secondary">
            Numara girilip açılmadan sitede WhatsApp düğmesi görünmez. Koordinatör e-postası paket taleplerinde bilgilendirme almak içindir.
          </p>
        </div>
      </div>

      {!canEdit && (
        <Alert variant="info">
          <span className="flex items-center gap-2">
            <Info className="h-4 w-4 shrink-0" />
            Bu ayarları yalnızca Yönetici (ADMIN) değiştirebilir.
          </span>
        </Alert>
      )}
      {saveError && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {saveError}
          </span>
        </Alert>
      )}

      <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
        <span className="text-sm">
          <span className="font-medium text-foreground">WhatsApp düğmesini göster</span>
          <span className="block text-xs text-foreground/60">Varsayılan kapalı. Açmak için geçerli bir numara girmelisiniz.</span>
        </span>
        <Switch
          checked={form.whatsappEnabled}
          disabled={!canEdit}
          onCheckedChange={(v: boolean) => patch({ whatsappEnabled: v })}
          aria-label="WhatsApp düğmesini göster"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="cc-whatsapp-number" label="WhatsApp numarası" required={form.whatsappEnabled} error={errors.whatsappNumber} hint="+ ile başlayan uluslararası biçim (E.164), ör. +905551234567.">
          {(p) => (
            <Input
              {...p}
              type="tel"
              dir="ltr"
              inputMode="tel"
              placeholder="+905551234567"
              disabled={!canEdit}
              value={form.whatsappNumber}
              onChange={(e) => patch({ whatsappNumber: e.target.value })}
            />
          )}
        </Field>
        <Field id="cc-coordinator-email" label="Koordinatör e-postası" error={errors.coordinatorEmail}>
          {(p) => (
            <Input
              {...p}
              type="email"
              dir="ltr"
              placeholder="koordinator@ornek.com"
              disabled={!canEdit}
              value={form.coordinatorEmail}
              onChange={(e) => patch({ coordinatorEmail: e.target.value })}
            />
          )}
        </Field>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Hazır WhatsApp mesajı (dil başına, opsiyonel)</p>
        <div role="tablist" aria-label="Hazır mesaj dili" className="flex flex-wrap gap-1">
          {SUPPORT_LANGUAGE_CHOICES.map((code) => (
            <button
              key={code}
              type="button"
              role="tab"
              aria-selected={tab === code}
              onClick={() => setTab(code)}
              className={cn("rounded-md px-2.5 py-1 text-xs font-medium", tab === code ? "bg-primary text-primary-foreground" : "bg-surface-muted text-foreground/70")}
            >
              {code.toUpperCase()}
              {form.whatsappMessages[code]?.trim() ? " •" : ""}
            </button>
          ))}
        </div>
        <Textarea
          role="tabpanel"
          aria-label={`Hazır mesaj (${tab.toUpperCase()})`}
          rows={3}
          maxLength={MESSAGE_MAX}
          disabled={!canEdit}
          placeholder="Hello, I'm interested in {package}."
          value={form.whatsappMessages[tab] ?? ""}
          onChange={(e) => patch({ whatsappMessages: { ...form.whatsappMessages, [tab]: e.target.value } })}
        />
        <p className="text-xs text-foreground/60">
          {"{package}"} yer tutucusu ilgilenilen paketin adıyla değişir. Boş bırakılan dilde varsayılan mesaj kullanılır.
        </p>
        {errors.whatsappMessages && (
          <p role="alert" className="text-xs text-danger">
            {errors.whatsappMessages}
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="button" loading={saving} disabled={!canEdit || !dirty} onClick={() => void save()}>
          Kaydet
        </Button>
      </div>
    </Card>
  );
}
