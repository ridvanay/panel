import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * `/about` CTA'ları — `buttonVariants` üzerine hap şekli + en az 44px (burada 48px) dokunma alanı.
 * `LinkButton`/`Link` ile birlikte `className` olarak kullanılır (gerçek `<a>` render edilir).
 */
const pill = "h-12 rounded-full px-6 text-base font-semibold";

export const aboutButtonClass = {
  primary: cn(buttonVariants({ variant: "default" }), pill),
  outlinePrimary: cn(
    buttonVariants({ variant: "outline" }),
    pill,
    "border-primary bg-transparent text-primary hover:bg-primary hover:text-primary-foreground"
  ),
  /** Primary zeminli kapanış bandı üzerinde — dolu, `--site-button-text` zemin + primary metin. */
  onPrimarySolid: cn(buttonVariants({ variant: "default" }), pill, "bg-primary-foreground text-primary hover:bg-primary-foreground/90"),
  /** Primary zeminli kapanış bandı üzerinde — şeffaf, açık renk kenarlık. */
  onPrimaryOutline: cn(
    buttonVariants({ variant: "outline" }),
    pill,
    "border-primary-foreground bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
  ),
};

/** Tüm bölümlerin ortak içerik genişliği — `max-w-7xl` (1280px) − `lg:px-10` = ~1200px içerik. */
export const aboutContainerClass = "mx-auto max-w-7xl px-4 sm:px-6 lg:px-10";
