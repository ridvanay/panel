import type { PrismaClient } from "@prisma/client";
import { ValidationError } from "../../../lib/errors";

/**
 * Paket L (2026-10-23) — CV kalemine ekli belge (sertifika PDF'i). `url` İSTEMCİDEN ALINMAZ:
 * `mediaId` verilmişse bağlantı medya kütüphanesindeki `Media.url`'den türetilir; böylece profil
 * sayfasındaki "Sertifikayı görüntüle" bağlantısı yalnızca sitenin kendi medya deposuna gider
 * (güvenlik incelemesi: dış siteye güvenilir görünümlü bağlantı konamaz). Yalnızca PDF/görsel.
 */
export async function resolveCvEntryMedia<T extends { mediaId?: string | null; url?: string | null }>(
  db: Pick<PrismaClient, "media">,
  entries: T[] | undefined
): Promise<T[] | undefined> {
  if (!entries) return entries;
  const ids = [...new Set(entries.map((e) => e.mediaId).filter((id): id is string => Boolean(id)))];
  const media = ids.length
    ? await db.media.findMany({ where: { id: { in: ids } }, select: { id: true, url: true, mimeType: true } })
    : [];
  const byId = new Map(media.map((m) => [m.id, m]));
  return entries.map((entry, index) => {
    if (!entry.mediaId) {
      const { url: _url, ...rest } = entry;
      return { ...rest, mediaId: null, url: null } as T;
    }
    const found = byId.get(entry.mediaId);
    if (!found || !(found.mimeType === "application/pdf" || found.mimeType.startsWith("image/"))) {
      throw new ValidationError("Geçersiz CV belgesi.", { [`cvEntries.${index}.mediaId`]: ["Medya bulunamadı ya da PDF/görsel değil."] });
    }
    return { ...entry, url: found.url } as T;
  });
}
