import { AtSign, Briefcase, Camera, Globe, Play, Terminal, ThumbsUp, type LucideIcon } from "lucide-react";
import type { SocialPlatform } from "@/lib/api/types";

/**
 * Bu lucide-react sürümünde marka ikonları (Twitter/GitHub/LinkedIn vb.) YOK — platform başına
 * anlamsal olarak yakın genel ikonlar kullanılıyor. Bu dosya `site-footer.tsx` (site geneli
 * "sosyal hesap linkleri") VE page-builder `team` bloğunun (`components/site/blocks/team-block.tsx`)
 * PAYLAŞTIĞI TEK kaynak — ikisi de AYNI eşlemeyi kullanır, sürüklenme (drift) riski YOK.
 */
export const SOCIAL_PLATFORM_ICONS: Record<SocialPlatform, LucideIcon> = {
  TWITTER: AtSign,
  GITHUB: Terminal,
  LINKEDIN: Briefcase,
  INSTAGRAM: Camera,
  FACEBOOK: ThumbsUp,
  YOUTUBE: Play,
  OTHER: Globe,
};

export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  TWITTER: "Twitter / X",
  GITHUB: "GitHub",
  LINKEDIN: "LinkedIn",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  YOUTUBE: "YouTube",
  OTHER: "Diğer",
};
