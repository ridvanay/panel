import { cn } from "@/lib/utils";
import { LinkButton } from "@/components/ui/link-button";
import type { BlockChrome, CtaBlock, CtaStyle, TextAlign } from "@/lib/page-builder/types";

/** Faz "Pazarlama & Sosyal Kanıt" — 4 hazır ton, `ui-designer` kararınca ham CSS/renk DEĞİL
 *  sabit bir sınıf tablosu (bkz. `types.ts::CtaStyle` yorumu). */
const ITEMS_ALIGN_CLASS: Record<TextAlign, string> = {
  left: "items-start text-left",
  center: "items-center text-center",
  right: "items-end text-right",
};

const WRAPPER_STYLE_CLASS: Record<CtaStyle, string> = {
  plain: "",
  soft: "rounded-lg bg-surface-muted p-8 sm:p-12",
  solid: "rounded-lg bg-primary p-8 sm:p-12",
  outline: "rounded-lg border border-border p-8 sm:p-12",
};

const HEADING_TEXT_CLASS: Record<CtaStyle, string> = {
  plain: "text-foreground",
  soft: "text-foreground",
  solid: "text-primary-foreground",
  outline: "text-foreground",
};

const DESCRIPTION_TEXT_CLASS: Record<CtaStyle, string> = {
  plain: "text-foreground/70",
  soft: "text-foreground/70",
  solid: "text-primary-foreground/80",
  outline: "text-foreground/70",
};

/** `solid` zeminde birincil butonun kendisi `bg-primary` OLAMAZ (kontrast kaybolur) — tersine
 *  çevrilmiş bir görünüm kullanılır. Diğer tonlarda normal `default` (dolu) buton. */
const PRIMARY_BUTTON_VARIANT: Record<CtaStyle, "default" | "secondary"> = {
  plain: "default",
  soft: "default",
  solid: "secondary",
  outline: "default",
};

const SECONDARY_BUTTON_VARIANT: Record<CtaStyle, "outline" | "ghost"> = {
  plain: "ghost",
  soft: "ghost",
  solid: "outline",
  outline: "ghost",
};

export function CtaBlockView({ block, chrome }: { block: CtaBlock; chrome: BlockChrome }) {
  const align = block.data.align ?? "center";
  const style = block.data.style ?? "plain";
  const hasSecondaryButton = Boolean(block.data.secondaryButtonLabel && block.data.secondaryButtonHref);

  return (
    <section className={cn(chrome === "page" && "px-4 py-16 sm:px-6")}>
      <div
        className={cn(
          "flex flex-col gap-2",
          // `plain` (eski/varsayılan davranış) TAM GENİŞLİK kalır — yeni `max-w`/kutu stilleri
          // yalnızca YENİ opsiyonel bir `style` seçildiğinde devreye girer, geriye dönük
          // uyumluluğu bozmaz (bkz. dosya başlığındaki mimar notu).
          style !== "plain" && "mx-auto max-w-2xl",
          ITEMS_ALIGN_CLASS[align],
          WRAPPER_STYLE_CLASS[style]
        )}
      >
        <h2 className={cn("text-2xl font-semibold", HEADING_TEXT_CLASS[style])}>{block.data.heading}</h2>
        {block.data.description && (
          <p className={cn("text-base", DESCRIPTION_TEXT_CLASS[style])}>{block.data.description}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <LinkButton href={block.data.buttonHref} variant={PRIMARY_BUTTON_VARIANT[style]}>
            {block.data.buttonLabel}
          </LinkButton>
          {hasSecondaryButton && (
            <LinkButton href={block.data.secondaryButtonHref!} variant={SECONDARY_BUTTON_VARIANT[style]}>
              {block.data.secondaryButtonLabel}
            </LinkButton>
          )}
        </div>
      </div>
    </section>
  );
}
