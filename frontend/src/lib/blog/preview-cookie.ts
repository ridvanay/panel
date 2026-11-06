/**
 * Paket AP — taslak blog önizlemesi sunucuda render edilir (SSR), ama belirteç bağlantıda `#t=` parçasında gelir
 * ve parça sunucuya gitmez. Sayfadaki istemci bileşeni belirteci okur, adresten siler ve `POST
 * /preview-token` gövdesiyle gönderir; bu uç belirteci YALNIZCA o önizleme yoluna kapsanan `HttpOnly`,
 * `SameSite=Strict` bir oturum çerezine yazar. Sayfa belirteci çerezden okuyup backend'e `X-Access-Token`
 * başlığıyla iletir. Belirteç böylece URL'de, Nginx log'unda ve `Referer`'da yer almaz.
 */
const POST_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
/** Dil önekli ya da öneksiz önizleme yolu: `/blog/preview/<id>`, `/en/blog/preview/<id>`, `/sr-latn/...`. */
const PREVIEW_PATH_PATTERN = /^(?:\/[a-z]{2}(?:-[a-z]{4})?)?\/blog\/preview\/([A-Za-z0-9_-]{1,100})$/;
export const PREVIEW_TOKEN_MAX_LENGTH = 400;

export function isValidPreviewPostId(postId: string): boolean {
  return POST_ID_PATTERN.test(postId);
}

export function previewCookieName(postId: string): string {
  return `blog_preview_${postId}`;
}

/** Çerez yolu olarak kabul edilen önizleme yolu mu, ve hangi yazıya ait? */
export function previewPathPostId(path: string): string | null {
  return PREVIEW_PATH_PATTERN.exec(path)?.[1] ?? null;
}
