import { Skeleton } from "@/components/ui/skeleton";

/**
 * Next.js `loading.tsx` — `/products` sunucu bileşeni veriyi çekerken (bkz.
 * `fetchProductCatalogServer`) otomatik olarak bu iskelet gösterilir. Katalog iskeletiyle AYNI
 * ızgara (`lg:grid-cols-3`) — layout shift'i en aza indirir.
 */
export default function ProductsLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="lg:flex lg:items-start lg:gap-8">
        <aside className="hidden lg:block lg:w-64 lg:shrink-0 space-y-4">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-32 w-full" />
        </aside>
        <div className="mt-6 min-w-0 flex-1 lg:mt-0">
          <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-8 w-44" />
          </div>
          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }).map((_, index) => (
              <div key={index} className="overflow-hidden rounded-lg border border-border">
                <Skeleton className="aspect-square w-full rounded-none" />
                <div className="space-y-2 p-4">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-5 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
