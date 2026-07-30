import type { TextBlock } from "@/lib/page-builder/types";

export function TextBlockView({ block }: { block: TextBlock }) {
  return <div className="prose mx-auto max-w-3xl px-4 py-8 sm:px-6" dangerouslySetInnerHTML={{ __html: block.data.html }} />;
}
