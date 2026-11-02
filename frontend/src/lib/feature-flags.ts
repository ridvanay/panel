/**
 * AI Is 3 hizli surum - ozellik bayraklari (backend `lib/feature-flags.ts` ile ayni adlar).
 *
 * `EXTERNAL_MEETINGS_ENABLED`: genel harici toplanti ozelligi (AG Is 3: admin "Toplantilar", doktor
 * portali toplantilari, kullanici ekranindaki meeting-host anahtari). Kapaliyken ilgili menu ogeleri
 * gizlenir ve sayfalar `notFound()` doner. Misafir katilim sayfalari (`/meet/join`) ve hizmet masasi
 * odalari bu bayraktan ETKILENMEZ.
 */
export const EXTERNAL_MEETINGS_ENABLED = false;
