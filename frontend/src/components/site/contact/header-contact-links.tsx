"use client";

import { useId } from "react";
import { MessageCircle } from "lucide-react";
import { openLiveChat } from "@/lib/live-chat-open";
import { buildWhatsappHref } from "@/lib/whatsapp-link";
import { useContactCtaStrings } from "@/lib/i18n/use-contact-cta-strings";
import { useContactChannels } from "./contact-channels-context";
import { WhatsappIcon } from "./contact-cta";

const LINK_CLASS =
  "inline-flex shrink-0 items-center gap-1 rounded font-medium text-[var(--site-header-link)] hover:text-[var(--site-header-link-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--site-primary)]";

/**
 * Paket X — üst şeritteki (destek dili metninin yanı) kompakt iletişim bağlantıları: WhatsApp (yalnızca yönetici
 * açıp numara girdiyse) ve "Talk to us" (canlı destek açıksa). Canlı destek kapalıyken "Talk to us" ayrıca çizilmez:
 * aynı şeritteki mevcut "Contact support" bağlantısı zaten iletişim sayfasına gider.
 */
export function HeaderContactLinks({ topic }: { topic: string }) {
  const t = useContactCtaStrings();
  const noteId = useId();
  const { whatsapp, chatEnabled } = useContactChannels();
  if (!whatsapp && !chatEnabled) return null;
  return (
    <>
      {whatsapp && (
        <a
          href={buildWhatsappHref(whatsapp, topic)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t.whatsappAria}
          title={t.whatsappNote}
          aria-describedby={noteId}
          className={LINK_CLASS}
          data-testid="site-header-whatsapp"
        >
          <WhatsappIcon className="h-3.5 w-3.5" />
          {t.whatsapp}
        </a>
      )}
      {whatsapp && (
        <span id={noteId} className="sr-only">
          {t.whatsappNote}
        </span>
      )}
      {chatEnabled && (
        <button type="button" onClick={() => openLiveChat()} className={LINK_CLASS} data-testid="site-header-talk-to-us">
          <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
          {t.talkToUs}
        </button>
      )}
    </>
  );
}
