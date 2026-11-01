"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircle, PhoneCall, X } from "lucide-react";
import { FLOATING_BOTTOM, isConsultationRoute } from "@/components/site/live-chat-widget";
import { openLiveChat } from "@/lib/live-chat-open";
import { buildWhatsappHref } from "@/lib/whatsapp-link";
import { useContactCtaStrings } from "@/lib/i18n/use-contact-cta-strings";
import { cn } from "@/lib/utils";
import { useContactChannels } from "./contact-channels-context";
import { WhatsappIcon } from "./contact-cta";

interface MobileContactButtonProps {
  /** WhatsApp mesajına ve sohbet bağlamına giren ad (site adı; kişisel veri değil). */
  topic: string;
  /** Canlı destek balonuyla aynı köşe (`SiteSettings.liveChatPosition`). */
  position?: "BOTTOM_RIGHT" | "BOTTOM_LEFT";
  /** Harici sohbet sağlayıcısı (Crisp/Tawk) kendi balonunu çizdiğinde düğme onun üstüne çıkar. */
  stackAboveExternalChat?: boolean;
}

/**
 * Paket X — yalnızca mobilde (lg altı), sağ altta TEK "Contact" düğmesi: WhatsApp + canlı destek + "Sizi arayalım".
 * Yalnızca WhatsApp AÇIKKEN çizilir; kapalıyken hiçbir şey render edilmez ve mevcut canlı destek balonu aynen kalır
 * (WhatsApp açıkken kendi balonu mobilde gizlenir, `live-chat-widget.tsx`). Alt çubuklarla `FLOATING_BOTTOM`
 * (`--site-bottom-inset`) üzerinden çakışmaz; sohbet penceresi açıkken ve `/consultation/**` rotasında gizlenir.
 */
export function MobileContactButton({ topic, position = "BOTTOM_RIGHT", stackAboveExternalChat = false }: MobileContactButtonProps) {
  const t = useContactCtaStrings();
  const pathname = usePathname();
  const { whatsapp, chatEnabled, contactHref } = useContactChannels();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const noteId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const side = position === "BOTTOM_LEFT" ? "left" : "right";

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!whatsapp || isConsultationRoute(pathname)) return null;

  const itemClass =
    "flex min-h-11 w-full items-center gap-3 rounded-[var(--site-radius)] px-3 text-sm font-medium text-foreground hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--site-primary)]";

  return (
    <div
      ref={rootRef}
      data-testid="mobile-contact-button"
      className={cn(
        "fixed z-50 flex flex-col gap-2 transition-[bottom] duration-300 lg:hidden [html[data-live-chat-open]_&]:hidden",
        side === "left" ? "items-start" : "items-end"
      )}
      style={{ bottom: stackAboveExternalChat ? `calc(${FLOATING_BOTTOM} + 4.25rem)` : FLOATING_BOTTOM, [side]: "1.5rem" }}
    >
      {open && (
        <div id={menuId} role="group" aria-label={t.contactMenuAria} className="w-60 rounded-[var(--site-radius)] border border-border bg-surface p-1.5 shadow-lg" data-testid="mobile-contact-menu">
          <a
            href={buildWhatsappHref(whatsapp, topic)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t.whatsappAria}
            aria-describedby={noteId}
            className={itemClass}
            onClick={() => setOpen(false)}
            data-testid="mobile-contact-whatsapp"
          >
            <WhatsappIcon className="h-5 w-5 text-[#25D366]" />
            {t.whatsapp}
          </a>
          <p id={noteId} className="px-3 pb-1.5 text-xs text-foreground/70" data-testid="mobile-contact-whatsapp-note">
            {t.whatsappNote}
          </p>
          {chatEnabled && (
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                setOpen(false);
                openLiveChat(topic);
              }}
              data-testid="mobile-contact-chat"
            >
              <MessageCircle className="h-5 w-5" aria-hidden="true" />
              {t.liveChat}
            </button>
          )}
          <Link href={contactHref} className={itemClass} onClick={() => setOpen(false)} data-testid="mobile-contact-callback">
            <PhoneCall className="h-5 w-5" aria-hidden="true" />
            {t.callback}
          </Link>
        </div>
      )}
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={open ? t.close : t.contactMenuAria}
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-14 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-lg transition-transform duration-300 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        data-testid="mobile-contact-trigger"
      >
        {open ? <X className="h-5 w-5" aria-hidden="true" /> : <MessageCircle className="h-5 w-5" aria-hidden="true" />}
        <span>{t.contactMenu}</span>
      </button>
    </div>
  );
}
