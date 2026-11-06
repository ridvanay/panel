import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SITE_URL } from "@/lib/env";
import { PREVIEW_TOKEN_MAX_LENGTH, isValidPreviewPostId, previewCookieName, previewPathPostId } from "@/lib/blog/preview-cookie";

/**
 * Paket AP — önizleme belirtecini (POST gövdesi) yalnızca o önizleme yoluna kapsanan `HttpOnly`,
 * `SameSite=Strict` oturum çerezine yazar (bkz. `lib/blog/preview-cookie.ts`). Belirteç burada doğrulanmaz:
 * sayfa backend'e iletir, backend geçersizse 404 döner. Belirteç yanıtta ve log'da yer almaz.
 *
 * Yol `/api` DIŞINDA: canlıda Nginx `location /api/` bloğu bütün `/api/*` isteklerini backend'e gönderir, frontend'in
 * `/api/*` rotalarına dışarıdan erişilemez. Dil öneki almaz; `proxy.ts` matcher'ı bu yolu hariç tutar.
 */
export async function POST(request: NextRequest) {
  // Yalnızca aynı origin'den (sayfanın kendi istemci bileşeni); başka siteler kurbana çerez yazdıramaz.
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { postId?: unknown; token?: unknown; path?: unknown } | null;
  const postId = typeof body?.postId === "string" ? body.postId : "";
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const path = typeof body?.path === "string" ? body.path : "";
  if (!isValidPreviewPostId(postId) || !token || token.length > PREVIEW_TOKEN_MAX_LENGTH || previewPathPostId(path) !== postId) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(/:$/, "");
  const response = new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  response.cookies.set(previewCookieName(postId), token, {
    path,
    httpOnly: true,
    sameSite: "strict",
    secure: proto === "https",
  });
  return response;
}

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const originHost = new URL(origin).host;
    return originHost === request.headers.get("host") || originHost === new URL(SITE_URL).host;
  } catch {
    return false;
  }
}
