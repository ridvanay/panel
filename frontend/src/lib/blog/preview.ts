import * as blogApi from "@/lib/api/blog";
import * as localesApi from "@/lib/api/locales";
import { SITE_URL } from "@/lib/env";
import { withLocalePrefix } from "@/lib/i18n/site-path";

/** Önizleme sayfası yolu (dil öneksiz): `/blog/preview/<id>?t=<belirteç>`. */
export function previewPath(postId: string, token: string): string {
  return `/blog/preview/${encodeURIComponent(postId)}?t=${encodeURIComponent(token)}`;
}

/** Dil önekli göreli yol (varsayılan dil önek almaz). */
export function localizedPreviewPath(postId: string, token: string, lang: string, defaultLocale: string): string {
  return withLocalePrefix(previewPath(postId, token), lang, defaultLocale);
}

/** Paylaşılabilir MUTLAK adres — site kök URL'si `NEXT_PUBLIC_SITE_URL` (`SITE_URL`). */
export function absolutePreviewUrl(postId: string, token: string, defaultLocale: string): string {
  return `${SITE_URL.replace(/\/+$/, "")}${localizedPreviewPath(postId, token, defaultLocale, defaultLocale)}`;
}

/**
 * Yeni sekmede önizleme açar. Tarayıcı açılır pencere engelleyicisi kullanıcı hareketinden SONRA (await) açılan
 * pencereyi keser; bu yüzden sekme önce eşzamanlı açılır, adres belirteç alınınca atanır. Hata olursa sekme
 * kapatılır ve hata çağırana iletilir. Açılan sekmenin `opener` bağı koparılır.
 */
export async function openPreviewTab(resolveUrl: () => Promise<string>): Promise<void> {
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  try {
    const url = await resolveUrl();
    if (tab) tab.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
  } catch (err) {
    tab?.close();
    throw err;
  }
}

/** "5 Kas 2026 14:30" benzeri son geçerlilik metni (Türkçe admin yüzeyi). */
export function formatPreviewExpiry(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Admin/editör "Önizle": 30 dk'lık oturum belirteci alır, varsayılan dil yoluyla yeni sekmede açar.
 * `defaultLocale` bilinmiyorsa admin dil listesinden okunur (okunamazsa "tr").
 */
export async function openAdminBlogPreview(postId: string, defaultLocale?: string): Promise<void> {
  await openPreviewTab(async () => {
    const [session, def] = await Promise.all([blogApi.createPreviewSession(postId), defaultLocale ? Promise.resolve(defaultLocale) : resolveDefaultLocaleCode()]);
    return localizedPreviewPath(postId, session.token, def, def);
  });
}

export async function resolveDefaultLocaleCode(): Promise<string> {
  try {
    const list = await localesApi.listAdminLocales();
    return list.find((l) => l.isDefault)?.code ?? "tr";
  } catch {
    return "tr";
  }
}
