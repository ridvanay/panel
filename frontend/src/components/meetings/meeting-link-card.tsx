"use client";

import { useRef, useState } from "react";
import { Check, Copy, Mail, TriangleAlert } from "lucide-react";
import { sendMeetingInviteEmail } from "@/lib/api/meetings";
import { useMeetingStrings } from "@/lib/i18n/use-meeting-strings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatMeetingWhen } from "@/components/site/meeting/meeting-time";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Paket AG İş 3 — misafir bağlantısı kartı. YALNIZCA oluşturma / yeniden üretme anında gösterilir: düz belirteç sunucuda
 * saklanmaz, bağlantı bu an bellekte olduğu için "E-postayla gönder" de yalnızca burada vardır (S5). Sonradan paylaşım için
 * "Yeni misafir bağlantısı" gerekir ve bu eski bağlantıyı geçersiz kılar (çağıran ekran bunu onay metniyle açıkça söyler).
 */
export function MeetingLinkCard({
  meeting,
  link,
  heading,
  onDone,
}: {
  meeting: { id: string; title: string; startsAt: string };
  link: string;
  heading: "created" | "regenerated";
  onDone: () => void;
}) {
  const { t, fmt: format, lang } = useMeetingStrings();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [emailState, setEmailState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied("ok");
    } catch {
      inputRef.current?.select();
      setCopied("failed");
    }
  }

  async function sendEmail() {
    if (!EMAIL_PATTERN.test(email.trim())) {
      setEmailError(t.emailInvalid);
      return;
    }
    setEmailError(undefined);
    setEmailState("sending");
    try {
      await sendMeetingInviteEmail(meeting.id, { link, to: email.trim() });
      setEmailState("sent");
    } catch {
      // Gönderim hatası (ör. 429) kısa, çevrilmiş mesajla bildirilir; bağlantıyı kendisi paylaşabilir.
      setEmailState("failed");
    }
  }

  return (
    <div className="space-y-4" data-testid="meeting-link-card">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">
          {heading === "created" ? t.linkCardTitleCreated : t.linkCardTitleRegenerated}
        </h2>
        <p className="text-sm text-foreground/70">
          <bdi>{format(t.linkMeetingLine, { title: meeting.title, when: formatMeetingWhen(meeting.startsAt, lang) })}</bdi>
        </p>
      </div>

      <Field id="meeting-guest-link" label={t.linkLabel}>
        {(inputProps) => (
          <div className="flex gap-2">
            <Input {...inputProps} ref={inputRef} readOnly dir="ltr" value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            <Button type="button" variant="outline" onClick={() => void copy()} data-testid="meeting-copy-link">
              {copied === "ok" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {t.copyLink}
            </Button>
          </div>
        )}
      </Field>
      {copied !== "idle" && (
        <p role="status" className={copied === "ok" ? "text-xs text-success" : "text-xs text-danger"} data-testid="meeting-copy-status">
          {copied === "ok" ? t.linkCopied : t.linkCopyFailed}
        </p>
      )}

      <Alert variant="warning">
        <span className="flex items-start gap-2" data-testid="meeting-link-once-warning">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t.linkOnceWarning}
        </span>
      </Alert>

      <div className="space-y-2 border-t border-border pt-4">
        <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Mail className="h-4 w-4" aria-hidden="true" />
          {t.emailSectionTitle}
        </h3>
        <Field id="meeting-invite-email" label={t.emailLabel} error={emailError}>
          {(inputProps) => (
            <div className="flex gap-2">
              <Input
                {...inputProps}
                type="email"
                dir="ltr"
                autoComplete="off"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailState !== "idle") setEmailState("idle");
                }}
              />
              <Button type="button" variant="outline" loading={emailState === "sending"} onClick={() => void sendEmail()} data-testid="meeting-send-invite">
                {t.emailSend}
              </Button>
            </div>
          )}
        </Field>
        {emailState === "sent" && (
          <p role="status" className="text-xs text-success" data-testid="meeting-invite-sent">
            {t.emailSent}
          </p>
        )}
        {emailState === "failed" && (
          <p role="alert" className="text-xs text-danger" data-testid="meeting-invite-failed">
            {t.emailFailed}
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={onDone} data-testid="meeting-link-done">
          {t.linkDone}
        </Button>
      </div>
    </div>
  );
}
