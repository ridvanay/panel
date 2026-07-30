import Link from "next/link";
import { AtSign, Briefcase, Camera, Globe, Play, Terminal, ThumbsUp, type LucideIcon } from "lucide-react";
import type { FooterColumnDto, SocialLinkDto, SocialPlatform } from "@/lib/api/types";

interface SiteFooterProps {
  siteName: string;
  socialLinks?: SocialLinkDto[];
  footerColumns?: FooterColumnDto[];
  copyrightText?: string | null;
}

/**
 * Bu lucide-react sürümünde marka ikonları (Twitter/GitHub/LinkedIn vb.) yok —
 * platform başına anlamsal olarak yakın genel ikonlar kullanılıyor.
 */
const SOCIAL_ICONS: Record<SocialPlatform, LucideIcon> = {
  TWITTER: AtSign,
  GITHUB: Terminal,
  LINKEDIN: Briefcase,
  INSTAGRAM: Camera,
  FACEBOOK: ThumbsUp,
  YOUTUBE: Play,
  OTHER: Globe,
};

const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  TWITTER: "Twitter / X",
  GITHUB: "GitHub",
  LINKEDIN: "LinkedIn",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  YOUTUBE: "YouTube",
  OTHER: "Diğer",
};

export function SiteFooter({ siteName, socialLinks, footerColumns, copyrightText }: SiteFooterProps) {
  const hasSocial = Boolean(socialLinks && socialLinks.length > 0);
  const hasColumns = Boolean(footerColumns && footerColumns.length > 0);
  const year = new Date().getFullYear();
  const copyrightLine =
    copyrightText && copyrightText.trim().length > 0 ? copyrightText : `© ${year} ${siteName}`;

  // Geriye dönük uyumluluk: sosyal link/footer sütunu yoksa mevcut tek-satır davranış korunur.
  if (!hasSocial && !hasColumns) {
    return (
      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-foreground/50 sm:px-6">{copyrightLine}</div>
      </footer>
    );
  }

  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-8 sm:flex-row sm:flex-wrap sm:justify-between">
          <div className="max-w-xs space-y-3">
            <p className="text-sm font-semibold text-foreground">{siteName}</p>
            {hasSocial && (
              <div className="flex flex-wrap items-center gap-2">
                {socialLinks!.map((link) => {
                  const Icon = SOCIAL_ICONS[link.platform] ?? Globe;
                  return (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={SOCIAL_LABELS[link.platform] ?? link.platform}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-foreground/60 transition-colors hover:border-primary hover:text-primary"
                    >
                      <Icon className="h-4 w-4" />
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {hasColumns && (
            <div className="flex flex-1 flex-wrap gap-8 sm:justify-end">
              {footerColumns!.map((column) => (
                <div key={column.id} className="min-w-[140px] space-y-2">
                  <p className="text-sm font-medium text-foreground">{column.title}</p>
                  <ul className="space-y-1.5">
                    {column.links.map((link) => (
                      <li key={link.id}>
                        <Link href={link.href} className="text-sm text-foreground/60 hover:text-foreground">
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-8 border-t border-border pt-6 text-sm text-foreground/50">{copyrightLine}</div>
      </div>
    </footer>
  );
}
