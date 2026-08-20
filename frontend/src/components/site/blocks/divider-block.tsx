import type { BlockChrome, DividerBlock } from "@/lib/page-builder/types";

/**
 * Dinamik sayısal değer (`height`) → inline `style`, Tailwind arbitrary değer DEĞİL
 * (`container-block.tsx`deki AYNI kural — bkz. o dosyanın başlığı).
 */
export function DividerBlockView({ block, chrome }: { block: DividerBlock; chrome: BlockChrome }) {
  if (block.data.variant === "space") {
    return <div style={{ height: block.data.height }} aria-hidden />;
  }

  return (
    <div className={chrome === "page" ? "px-4 sm:px-6" : undefined} style={{ paddingBlock: block.data.height / 2 }}>
      <hr className="border-border" style={{ borderTopStyle: block.data.style }} />
    </div>
  );
}
