import { Skeleton } from "@/components/ui/skeleton";

/** Next.js `loading.tsx` — PDP verisi sunucuda çekilirken (bkz. `fetchProductBySlugServer`) gösterilir. */
export default function ProductDetailLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <Skeleton className="mb-4 h-4 w-64" />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-10">
        <Skeleton className="aspect-square w-full rounded-lg" />
        <div className="space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-9 w-1/2" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </div>
    </div>
  );
}
