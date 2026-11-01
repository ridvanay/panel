"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Link2, Mail, MessageCircle } from "lucide-react";
import { buildShareLinks } from "@/lib/blog/share";

const buttonClass =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm text-foreground/80 transition-colors duration-300 hover:border-[var(--site-primary)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]";

/**
 * Paket Z1 — paylaşım: bağlantıyı kopyala (panoya), WhatsApp (`wa.me`) ve e-posta (`mailto:`). Üçüncü taraf
 * script/SDK yoktur; WhatsApp ve e-posta düz bağlantıdır. Kopyalama sonucu `role="status"` ile duyurulur.
 */
export function BlogShareButtons({
  url,
  title,
  labels,
}: {
  url: string;
  title: string;
  labels: { heading: string; copy: string; copied: string; whatsapp: string; email: string };
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const links = buildShareLinks(url, title);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section aria-label={labels.heading} className="mt-10" data-testid="blog-share">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground/70">{labels.heading}</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        <li>
          <button type="button" onClick={copy} className={buttonClass} data-testid="blog-share-copy">
            {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
            {labels.copy}
          </button>
        </li>
        <li>
          <a href={links.whatsapp} target="_blank" rel="noopener noreferrer" className={buttonClass} data-testid="blog-share-whatsapp">
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            {labels.whatsapp}
          </a>
        </li>
        <li>
          <a href={links.email} className={buttonClass} data-testid="blog-share-email">
            <Mail className="h-4 w-4" aria-hidden="true" />
            {labels.email}
          </a>
        </li>
      </ul>
      <span role="status" className="sr-only">
        {copied ? labels.copied : ""}
      </span>
    </section>
  );
}
