"use client";

import { useMemo, useState } from "react";

/**
 * Blog/Kullanıcılar/Sayfalar tablolarında tekrar eden arama + sayfalama mantığı.
 * Client-side: `items` zaten API'den tam liste olarak çekilmiş olmalı (cursor tabanlı
 * ek fetch yapmaz), bu hook yalnızca bellekteki listeyi filtreler ve dilimler.
 *
 * Sayfalama kontrolleri yalnızca `totalPages > 10` olduğunda anlamlıdır — bunu
 * göstermek/gizlemek çağıran bileşenin sorumluluğundadır (`totalPages` buradan okunur).
 */
export function useFilteredList<T>(items: T[] | null, matches: (item: T, query: string) => boolean) {
  const [search, setSearchRaw] = useState("");
  const [page, setPageRaw] = useState(1);
  const [pageSize, setPageSizeRaw] = useState(10);

  const filtered = useMemo(() => {
    if (!items) return [];
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => matches(item, query));
  }, [items, search, matches]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);

  const pageItems = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize]
  );

  function setSearch(value: string) {
    setSearchRaw(value);
    setPageRaw(1);
  }

  function setPageSize(value: number) {
    setPageSizeRaw(value);
    setPageRaw(1);
  }

  return {
    search,
    setSearch,
    page: currentPage,
    setPage: setPageRaw,
    pageSize,
    setPageSize,
    totalPages,
    filteredCount: filtered.length,
    items: pageItems,
  };
}
