import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ListPaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

/**
 * Blog/Kullanıcılar/Sayfalar tablolarının altında tekrar eden sayfalama göstergesi.
 * Yalnızca çağıran taraf `totalPages > 10` olduğunda render etmelidir.
 */
export function ListPagination({ page, totalPages, onPageChange }: ListPaginationProps) {
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-sm text-foreground/60">
        Sayfa {page} / {totalPages}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Önceki sayfa"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Sonraki sayfa"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
