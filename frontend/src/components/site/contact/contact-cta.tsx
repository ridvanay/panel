"use client";

import { useId } from "react";
import Link from "next/link";
import { MessageCircle, PhoneCall } from "lucide-react";
import { openLiveChat } from "@/lib/live-chat-open";
import { buildWhatsappHref } from "@/lib/whatsapp-link";
import { useContactCtaStrings } from "@/lib/i18n/use-contact-cta-strings";
import { cn } from "@/lib/utils";
import { useContactChannels } from "./contact-channels-context";

/** WhatsApp marka simgesi (lucide'da marka ikonu yok; tek path, dekoratif). */
export function WhatsappIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.86 9.86 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Zm5.8 14.03c-.25.69-1.45 1.32-2 1.4-.51.08-1.16.11-1.87-.12-.43-.14-.98-.32-1.69-.62-2.97-1.28-4.91-4.27-5.06-4.47-.15-.2-1.21-1.61-1.21-3.07 0-1.46.77-2.18 1.04-2.48.27-.3.59-.37.79-.37h.57c.18 0 .43-.07.67.51.25.6.84 2.06.92 2.21.07.15.12.32.02.52-.1.2-.15.32-.3.5-.15.17-.31.39-.45.52-.15.15-.3.31-.13.61.17.3.77 1.27 1.65 2.06 1.13 1.01 2.09 1.32 2.39 1.47.3.15.47.12.65-.07.17-.2.74-.87.94-1.17.2-.3.4-.25.67-.15.27.1 1.73.82 2.03.97.3.15.5.22.57.35.08.12.08.72-.17 1.41Z" />
    </svg>
  );
}

export interface ContactCtaProps {
  /** Hazır WhatsApp mesajına ve canlı destek bağlamına giren paket/sayfa adı (kişisel veri değil). */
  topic: string;
  /** "Sizi arayalım": verilirse düğme bu işleyiciyi çağırır (ör. paket planlama formunu açar); yoksa iletişim sayfasına gider. */
  onCallback?: () => void;
  /** `onPrimary` — koyu/renkli zemin üzerinde. */
  tone?: "default" | "onPrimary";
  /** `compact` — yalnızca simge + kısa etiket (üst şerit). */
  size?: "default" | "compact";
  className?: string;
  /** Paket AJ — çağrı düğmesinden sonra, aktarım uyarısından önce çizilen ek eylem (ör. Book a consultation). */
  trailing?: React.ReactNode;
}

/**
 * Paket X — ortak iletişim eylemleri: WhatsApp (yalnızca yönetici açıp numara girdiyse), canlı destek (açıksa,
 * bağlamla), "Sizi arayalım". Dokunma alanı en az 44 px (compact hariç). WhatsApp tıklaması CRM izleyicisi
 * tarafından (yalnızca analitik onayı varsa) "aday talep" olarak kaydedilir; mesajda kişisel/sağlık verisi yoktur.
 */
export function ContactCta({ topic, onCallback, tone = "default", size = "default", className, trailing }: ContactCtaProps) {
  const t = useContactCtaStrings();
  const noteId = useId();
  const { whatsapp, chatEnabled, contactHref } = useContactChannels();
  const solid = tone === "onPrimary" ? "bg-white text-[var(--site-primary)] hover:bg-white/90" : "bg-[var(--site-primary)] text-white hover:opacity-90";
  const outline =
    tone === "onPrimary"
      ? "border border-white/70 text-white hover:bg-white/10"
      : "border border-[var(--site-primary)] text-[var(--site-primary)] hover:bg-[var(--site-primary)]/5";
  const base = cn(
    "inline-flex items-center justify-center gap-2 rounded-[var(--site-radius)] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current",
    size === "compact" ? "min-h-8 px-2.5 text-xs" : "min-h-11 px-4 text-sm"
  );
  const icon = size === "compact" ? "h-3.5 w-3.5" : "h-4 w-4";
  // İlk görünen eylem dolu, diğerleri çerçeveli (render sırasında değişken atamadan).
  const first = whatsapp ? "whatsapp" : chatEnabled ? "chat" : "callback";
  const style = (key: "whatsapp" | "chat" | "callback") => (key === first ? solid : outline);

  return (
    <div className={cn("flex flex-wrap gap-2", className)} data-testid="contact-cta">
      {whatsapp && (
        <a href={buildWhatsappHref(whatsapp, topic)} target="_blank" rel="noopener noreferrer" aria-label={t.whatsappAria} title={t.whatsappNote} aria-describedby={noteId} className={cn(base, style("whatsapp"))} data-testid="contact-cta-whatsapp">
          <WhatsappIcon className={icon} />
          {t.whatsapp}
        </a>
      )}
      {chatEnabled && (
        <button type="button" onClick={() => openLiveChat(topic)} className={cn(base, style("chat"))} data-testid="contact-cta-chat">
          <MessageCircle className={icon} aria-hidden="true" />
          {t.liveChat}
        </button>
      )}
      {onCallback ? (
        <button type="button" onClick={onCallback} className={cn(base, style("callback"))} data-testid="contact-cta-callback">
          <PhoneCall className={icon} aria-hidden="true" />
          {t.callback}
        </button>
      ) : (
        <Link href={contactHref} className={cn(base, style("callback"))} data-testid="contact-cta-callback">
          <PhoneCall className={icon} aria-hidden="true" />
          {t.callback}
        </Link>
      )}
      {trailing}
      {/* Aktarım uyarısı: WhatsApp görünürken. Normal boyutta görünür küçük metin; compact'ta yalnızca title + aria-describedby. */}
      {whatsapp && (
        <p id={noteId} className={cn("basis-full text-xs", tone === "onPrimary" ? "text-white/85" : "text-foreground/70", size === "compact" && "sr-only")} data-testid="contact-cta-whatsapp-note">
          {t.whatsappNote}
        </p>
      )}
    </div>
  );
}
