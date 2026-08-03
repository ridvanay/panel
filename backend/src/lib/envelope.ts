/**
 * `meta` serbest/keyfi bir şekle sahiptir (ör. §10.7 `meta.counts`) — bu yüzden
 * generic `M` olarak alınır ve OLDUĞU GİBİ (daraltılmadan) döndürülür. Aksi halde
 * (meta parametresi `Record<string, unknown>` gibi geniş bir tipe sabitlenseydi)
 * çağıran taraftaki `reply.send(...)`, Zod response şemasının beklediği daha dar
 * `meta` şekliyle (ör. `{ counts: ContentCounts }`) UYUŞMAZDI.
 */
export function ok<T>(data: T): { data: T };
export function ok<T, M extends Record<string, unknown>>(data: T, meta: M): { data: T; meta: M };
export function ok<T, M extends Record<string, unknown>>(data: T, meta?: M) {
  return meta ? { data, meta } : { data };
}
