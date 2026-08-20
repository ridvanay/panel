"use client";

import { useState } from "react";
import { AtSign, Briefcase, Check, Link2, Mail, MessageCircle, ThumbsUp } from "lucide-react";
import type { SocialShareNetwork } from "@/lib/api/types";

interface SocialShareButtonsProps {
  url: string;
  title: string;
  networks: SocialShareNetwork[];
}

const BUTTON_CLASS_NAME =
  "inline-flex size-9 items-center justify-center rounded-full border border-border text-foreground/70 transition-all duration-300 hover:bg-[var(--site-button)] hover:text-[var(--site-button-text)]";

function buildHref(network: SocialShareNetwork, url: string, title: string): string {
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);
  switch (network) {
    case "TWITTER":
      return `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`;
    case "FACEBOOK":
      return `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
    case "LINKEDIN":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;
    case "WHATSAPP":
      return `https://wa.me/?text=${encodedTitle}%20${encodedUrl}`;
    case "EMAIL":
      return `mailto:?subject=${encodedTitle}&body=${encodedUrl}`;
    case "COPY_LINK":
      return "";
  }
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button type="button" onClick={handleCopy} aria-label="Linki kopyala" className={BUTTON_CLASS_NAME}>
      {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}

const NETWORK_ICON: Record<Exclude<SocialShareNetwork, "COPY_LINK">, typeof AtSign> = {
  TWITTER: AtSign,
  FACEBOOK: ThumbsUp,
  LINKEDIN: Briefcase,
  WHATSAPP: MessageCircle,
  EMAIL: Mail,
};

const NETWORK_LABEL: Record<SocialShareNetwork, string> = {
  TWITTER: "Twitter'da paylaş",
  FACEBOOK: "Facebook'ta paylaş",
  LINKEDIN: "LinkedIn'de paylaş",
  WHATSAPP: "WhatsApp'ta paylaş",
  EMAIL: "E-posta ile paylaş",
  COPY_LINK: "Linki kopyala",
};

export function SocialShareButtons({ url, title, networks }: SocialShareButtonsProps) {
  if (networks.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Bu içeriği paylaş">
      {networks.map((network) => {
        if (network === "COPY_LINK") return <CopyLinkButton key={network} url={url} />;

        const Icon = NETWORK_ICON[network];
        const isEmail = network === "EMAIL";

        return (
          <a
            key={network}
            href={buildHref(network, url, title)}
            target={isEmail ? undefined : "_blank"}
            rel={isEmail ? undefined : "noopener noreferrer"}
            aria-label={NETWORK_LABEL[network]}
            className={BUTTON_CLASS_NAME}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </a>
        );
      })}
    </div>
  );
}
