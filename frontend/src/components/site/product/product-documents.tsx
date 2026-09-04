import { Download, FileText } from "lucide-react";
import type { ProductDocument } from "@/lib/api/types";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/format-bytes";
import { cn } from "@/lib/utils";

/**
 * PDF döküman kartları — `.claude/design-notes-ecommerce-storefront.md` §8 BİREBİR. Backend
 * `/uploads/*` altında görsel-olmayan türler için zaten `Content-Disposition: attachment`
 * döndürüyor ([DTI-genişleme] §2.2 madde 3) — frontend ek bir şey YAPMAZ, native `<a download>`
 * davranışı yeterlidir.
 *
 * `showHeading` — varsayılan `true` (admin/eski kullanım). PDP artık bunu `product-tabs.tsx`
 * içindeki "Teknik Dökümanlar" SEKMESİNDE render ediyor; sekme başlığı zaten aynı bilgiyi
 * taşıdığı için orada `false` verilir (çift başlık YAZILMAZ — `.claude/design-notes-products-catalog.md` §4.4).
 */
export function ProductDocuments({ documents, showHeading = true }: { documents: ProductDocument[]; showHeading?: boolean }) {
  if (documents.length === 0) return null;

  return (
    <div className={showHeading ? "mt-8" : undefined}>
      {showHeading && <h3 className="text-base font-semibold text-foreground">Teknik Dökümanlar</h3>}
      <div className={showHeading ? "mt-3 space-y-2" : "space-y-2"}>
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center gap-3 rounded-[var(--site-radius)] border border-border p-4 transition-colors duration-150 hover:border-primary/40"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--site-radius)] bg-accent/10 text-accent">
              <FileText className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{doc.title || doc.media.filename}</p>
              <p className="text-xs text-foreground/60">{formatBytes(doc.media.sizeBytes)}</p>
            </div>
            <a
              href={doc.media.url}
              download
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`"${doc.title || doc.media.filename}" dosyasını indir`}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "shrink-0 rounded-[var(--site-radius)]")}
            >
              <Download className="h-4 w-4" />
              İndir
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
