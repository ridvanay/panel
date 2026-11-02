"use client";

import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { openLiveChat } from "@/lib/live-chat-open";
import { useContactCtaStrings } from "@/lib/i18n/use-contact-cta-strings";
import { useContactChannels } from "./contact-channels-context";

const LINK_CLASS =
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded font-medium text-[var(--site-header-link)] hover:text-[var(--site-header-link-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--site-primary)]";

/**
 * Paket AJ (AJ-8) — üst şeritteki tek iletişim öğesi "Talk to us": canlı destek açıksa sohbeti açar, kapalıysa
 * iletişim sayfasına gider. (Önceki "Contact support" ve "WhatsApp" öğeleri şeritten kalktı; WhatsApp koordinatör
 * bandında, mega menüde ve talep sayfasında durur.)
 */
export function HeaderContactLinks({ fallbackHref }: { fallbackHref: string }) {
  const t = useContactCtaStrings();
  const { chatEnabled } = useContactChannels();
  if (chatEnabled) {
    return (
      <button type="button" onClick={() => openLiveChat()} className={LINK_CLASS} data-testid="site-header-talk-to-us">
        <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
        {t.talkToUs}
      </button>
    );
  }
  return (
    <Link href={fallbackHref} className={LINK_CLASS} data-testid="site-header-talk-to-us">
      <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
      {t.talkToUs}
    </Link>
  );
}
