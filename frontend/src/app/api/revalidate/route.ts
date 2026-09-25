import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { timingSafeEqual } from "node:crypto";
import { CACHE_TAG_PATTERN } from "@/lib/cache-tags";
import { allowRevalidateRequest } from "@/lib/revalidate-rate-limit";
import { getRevalidateSecret } from "@/lib/revalidate-secret";

/** Bir istekte kabul edilen en fazla etiket (backend tek kayıtta birkaç etiket gönderir). */
const MAX_TAGS = 20;

/**
 * On-demand revalidation webhook — backend bir sayfa kaydı başarılı olduğunda bu uca POST atar
 * (`env.FRONTEND_URL` + `/api/revalidate`, backend varsayılanı `http://localhost:3000`). Amaç:
 * `next: { revalidate: 60 }` (bkz. `lib/api/server-pages.ts`) yüzünden oluşan ~30sn'lik ISR
 * gecikmesini ortadan kaldırıp kayıt anında ilgili path'leri STALE işaretlemek (bkz.
 * `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` — Route
 * Handler'lardaki `revalidatePath` "bir sonraki ziyarette" tazeler, senkron/anında DEĞİL).
 *
 * **Kimlik doğrulama:** paylaşılan bir sır (`x-revalidate-secret` header) — backend↔frontend
 * arası servis-servis çağrısı, kullanıcı oturumu YOK. Eksik/yanlışsa 401.
 *
 * **Path formatı:** backend `[lang]/(site)/page.tsx` (ana sayfa, örn. `/tr`) ve
 * `[lang]/(site)/[slug]/page.tsx` (örn. `/tr/hakkimizda`) route dosya yapısına karşılık gelen
 * LİTERAL path'ler gönderir. `proxy.ts` varsayılan dilin URL'ini tarayıcıya PREFIX'SİZ gösterse
 * de (`/hakkimizda`) bu bir `NextResponse.rewrite()`'tır (bkz. proxy.ts §4.3) — `revalidatePath`
 * docs'una göre ("Using revalidatePath with rewrites") rewrite kullanılan durumlarda DESTINATION
 * path'i (route dosya konumu, örn. `/tr/hakkimizda`) vermek gerekir, tarayıcıda görünen kaynak
 * path (`/hakkimizda`) DEĞİL. Bu yüzden gelen path'ler dönüştürülmeden OLDUĞU GİBİ
 * `revalidatePath`'e geçirilir.
 *
 * **`type` alanı (opsiyonel, varsayılan `"page"`):** backend `lib/revalidate.ts`'teki
 * `triggerPublicPageRevalidation` (tekil sayfa kaydı) `type` GÖNDERMEZ/`"page"` gönderir — bu,
 * `revalidatePath(path)` (Next varsayılanı: sadece o path'in kendi segment'i) ile AYNI davranışı
 * korur, GERİYE DÖNÜK UYUMLULUK bozulmaz. `triggerGlobalRevalidation` (appearance/navigation gibi
 * TÜM sitenin layout'unu — header/footer/renkler — etkileyen değişiklikler) `{ paths: ["/"], type:
 * "layout" }` gönderir; bu durumda `revalidatePath(path, "layout")` çağrılır — dokümana göre
 * ("Revalidating all data") bu, o path'in ÜSTÜNDEKİ (layout dahil) TÜM segment'lerin cache'ini
 * temizler (bkz. `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/
 * revalidatePath.md`, "Revalidating all data" bölümü — `revalidatePath('/', 'layout')` ile TÜM
 * cache temizlenir). `type` "page"/"layout" DIŞINDA bir değerse 400 döner.
 *
 * **`tags` alanı (opsiyonel):** backend admin kayıtlarından sonra etkilenen verinin etiketlerini
 * gönderir (`lib/cache-tags.ts`, ör. `settings`, `blog`, `slider:<id>`) — yalnızca o veriyi kullanan
 * sayfalar yenilenir, tüm site DEĞİL. `revalidateTag(tag, { expire: 0 })`: webhook'tan gelen
 * yenilemede eski içerik sunulmaz, bir sonraki ziyaret taze veriyle render edilir (bkz.
 * `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidateTag.md`). `paths`
 * ve `tags`'ten en az biri dolu olmalı.
 */
export async function POST(request: NextRequest) {
  // Sır tanımsız/boş/yer tutucu → her istek 401 (fail-closed; açılış uyarısı: instrumentation.ts).
  const secret = getRevalidateSecret();
  const provided = request.headers.get("x-revalidate-secret");

  if (!secret || !provided || !secretsMatch(secret, provided)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!allowRevalidateRequest(Date.now())) {
    return NextResponse.json({ error: "Çok fazla yenileme isteği" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON gövdesi" }, { status: 400 });
  }

  const { paths = [], tags = [], type } = (body as { paths?: unknown; tags?: unknown; type?: unknown } | null) ?? {};
  if (!Array.isArray(paths) || !paths.every((p): p is string => typeof p === "string" && p.startsWith("/"))) {
    return NextResponse.json({ error: "`paths` alanı '/' ile başlayan string'lerden oluşan bir dizi olmalı" }, { status: 400 });
  }
  if (!Array.isArray(tags) || tags.length > MAX_TAGS || !tags.every((t): t is string => typeof t === "string" && CACHE_TAG_PATTERN.test(t))) {
    return NextResponse.json({ error: `\`tags\` alanı en fazla ${MAX_TAGS} geçerli etiket (a-z, 0-9, ':', '-') içeren bir dizi olmalı` }, { status: 400 });
  }
  if (paths.length === 0 && tags.length === 0) {
    return NextResponse.json({ error: "`paths` veya `tags` alanından en az biri dolu olmalı" }, { status: 400 });
  }
  if (type !== undefined && type !== "page" && type !== "layout") {
    return NextResponse.json({ error: "`type` alanı belirtilirse 'page' veya 'layout' olmalı" }, { status: 400 });
  }

  const isLayout = type === "layout";
  for (const path of paths) {
    if (isLayout) {
      revalidatePath(path, "layout");
    } else {
      revalidatePath(path);
    }
  }
  for (const tag of tags) {
    revalidateTag(tag, { expire: 0 });
  }

  return NextResponse.json({ revalidated: true, paths, tags }, { status: 200 });
}

/**
 * Zamanlama saldırılarına karşı sabit-zamanlı karşılaştırma — `crypto.timingSafeEqual` farklı
 * uzunluktaki buffer'larda throw eder, bu yüzden önce uzunluk eşitlenir (uzunluk uyuşmazlığı da
 * zaten "eşit değil" anlamına gelir, erken dönüş güvenlik sızıntısı yaratmaz — sır uzunluğu gizli
 * bilgi değildir).
 */
function secretsMatch(expected: string, provided: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
