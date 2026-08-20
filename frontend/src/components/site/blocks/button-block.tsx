import { cn } from "@/lib/utils";
import { LinkButton } from "@/components/ui/link-button";
import { resolveIcon } from "@/lib/page-builder/icon-options";
import type { BlockChrome, ButtonBlock } from "@/lib/page-builder/types";

const STYLE_VARIANT: Record<ButtonBlock["data"]["style"], "default" | "outline" | "ghost"> = {
  solid: "default",
  outline: "outline",
  ghost: "ghost",
};

const SIZE_VARIANT: Record<ButtonBlock["data"]["size"], "sm" | "default" | "lg"> = {
  sm: "sm",
  md: "default",
  lg: "lg",
};

const ALIGN_CLASS: Record<ButtonBlock["data"]["align"], string> = {
  left: "justify-start",
  center: "justify-center",
  right: "justify-end",
};

/** `react-hooks/static-components` kuralı, render İÇİNDE seçilen bir bileşen değişkenini JSX
 *  etiketi olarak kullanmayı (`const Icon = ...; <Icon/>`) yanlış-pozitif olarak "her render'da
 *  yeni bileşen" sanıyor (aslında `resolveIcon` SABİT `ICON_OPTIONS`tan mevcut bir referans
 *  döndürür). küçük harfli bir yardımcı FONKSİYON (bileşen DEĞİL, kural bileşen adlandırma
 *  kuralına — PascalCase — bakıyor) içine alıp doğrudan bir JSX İFADESİ döndürerek kaçınılır. */
function buttonIcon(name: string | undefined, className: string) {
  const Icon = resolveIcon(name);
  return <Icon className={className} aria-hidden />;
}

export function ButtonBlockView({ block, chrome }: { block: ButtonBlock; chrome: BlockChrome }) {
  return (
    <section className={cn("flex", ALIGN_CLASS[block.data.align], chrome === "page" && "px-4 py-6 sm:px-6")}>
      <LinkButton href={block.data.href} variant={STYLE_VARIANT[block.data.style]} size={SIZE_VARIANT[block.data.size]}>
        {block.data.icon && buttonIcon(block.data.icon, "h-4 w-4")}
        {block.data.label}
      </LinkButton>
    </section>
  );
}
