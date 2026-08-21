import { Quote, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BlockChrome, TestimonialBlock } from "@/lib/page-builder/types";

function gridColsClass(count: number): string {
  if (count === 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1 sm:grid-cols-2";
  return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
}

/** Fotoğraf yoksa (`avatarUrl` opsiyonel) ad-soyaddan baş harf rozeti — yeni bir ağ isteği açmaz. */
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function TestimonialBlockView({ block, chrome }: { block: TestimonialBlock; chrome: BlockChrome }) {
  const items = block.data.items;

  return (
    <section className={cn(chrome === "page" && "px-4 py-12 sm:px-6")}>
      <div className={cn("mx-auto grid max-w-6xl gap-6", gridColsClass(items.length))}>
        {items.map((item) => (
          <figure key={item.id} className="flex flex-col gap-4 rounded-lg border border-border p-6">
            <Quote className="h-6 w-6 text-primary/40" aria-hidden />
            {item.rating && (
              <div className="flex gap-0.5" role="img" aria-label={`5 üzerinden ${item.rating} yıldız`}>
                {Array.from({ length: 5 }, (_, i) => (
                  <Star
                    key={i}
                    className={cn("h-4 w-4", i < item.rating! ? "fill-warning text-warning" : "text-foreground/20")}
                    aria-hidden
                  />
                ))}
              </div>
            )}
            <blockquote className="flex-1 text-sm text-foreground/80">{item.quote}</blockquote>
            <figcaption className="flex items-center gap-3">
              {item.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- image-block.tsx ile AYNI gerekçe (remotePatterns tanımlı değil)
                <img src={item.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {initials(item.authorName)}
                </span>
              )}
              <div>
                <p className="text-sm font-semibold text-foreground">{item.authorName}</p>
                {item.authorRole && <p className="text-xs text-foreground/60">{item.authorRole}</p>}
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
