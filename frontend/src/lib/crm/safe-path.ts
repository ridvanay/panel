/** Yalnızca site-içi pathname iframe'de açılır (ziyaretçi verisinden gelen `//evil.com` vb. açılmaz). */
export function isSafePreviewPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") && !/[\s<>"']/.test(path);
}
