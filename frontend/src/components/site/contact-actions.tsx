"use client";

import Link from "next/link";
import { Mail, MessageCircle } from "lucide-react";
import { openLiveChat } from "@/lib/live-chat-open";
import { cn } from "@/lib/utils";

interface ContactActionsProps {
  /** Canlı destek açıksa (`SiteSettings.liveChatEnabled`) sohbet düğmesi gösterilir. */
  chatEnabled: boolean;
  /** Dil önekli iletişim sayfası (`/contact`, `/en/contact`). */
  contactHref: string;
  chatLabel: string;
  contactLabel: string;
  /** `onPrimary` — koyu/renkli zemin üzerinde (destek bandı). */
  tone?: "default" | "onPrimary";
  className?: string;
}

/**
 * Paket V — "Bizimle konuşun" eylemleri: canlı destek (açıksa) ve iletişim sayfası. X paketiyle
 * WhatsApp da buraya eklenecek. Dokunma alanı en az 44 px.
 */
export function ContactActions({ chatEnabled, contactHref, chatLabel, contactLabel, tone = "default", className }: ContactActionsProps) {
  const solid =
    tone === "onPrimary"
      ? "bg-white text-[var(--site-primary)] hover:bg-white/90"
      : "bg-[var(--site-primary)] text-white hover:opacity-90";
  const outline =
    tone === "onPrimary"
      ? "border border-white/70 text-white hover:bg-white/10"
      : "border border-[var(--site-primary)] text-[var(--site-primary)] hover:bg-[var(--site-primary)]/5";
  const base =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--site-radius)] px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {chatEnabled && (
        <button type="button" onClick={openLiveChat} className={cn(base, solid)}>
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          {chatLabel}
        </button>
      )}
      <Link href={contactHref} className={cn(base, chatEnabled ? outline : solid)}>
        <Mail className="h-4 w-4" aria-hidden="true" />
        {contactLabel}
      </Link>
    </div>
  );
}
