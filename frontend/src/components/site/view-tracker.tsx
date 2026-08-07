"use client";

import { useEffect, useRef } from "react";
import { API_BASE_URL } from "@/lib/env";

interface ViewTrackerProps {
  kind: "page" | "blog" | "product";
  slug: string;
}

const VIEW_PATH_PREFIX: Record<ViewTrackerProps["kind"], string> = {
  page: "/pages",
  blog: "/blog",
  product: "/products",
};

/**
 * Sayfa render olur olmaz (yalnızca tarayıcıda, ilk mount'ta) görüntülenme sayacını artırır.
 * Bilerek client-side: sunucu bileşeninde tetiklenseydi Next.js link prefetch'i de
 * bir "görüntüleme" olarak sayardı.
 */
export function ViewTracker({ kind, slug }: ViewTrackerProps) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const path = `${VIEW_PATH_PREFIX[kind]}/${slug}/view`;
    fetch(`${API_BASE_URL}${path}`, { method: "POST" }).catch(() => {});
  }, [kind, slug]);

  return null;
}
