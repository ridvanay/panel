import type { Page } from "@playwright/test";
import "./loopback-dns";
import { API_BASE_URL } from "./api";

/**
 * Paket AL (İş 2) — yerel ortamda medya adresleri GÖRELİ ("/uploads/…") döner; frontend :3100 bu dosyaları servis etmez ve
 * next/image optimize edicisi göreli adres için 400 verir (canlıda adresler mutlaktır). Sağlıklı görselin gerçekten
 * yüklenmesini bekleyen testler için bu adres, backend'den okunan gerçek dosyayla yanıtlanır (kırık görsel senaryoları
 * kendi 404 route'larını ayrıca kurar).
 */
export async function serveLocalMedia(page: Page, mediaUrl: string): Promise<void> {
  const origin = new URL(API_BASE_URL).origin;
  await page.route(
    (url) => url.href === mediaUrl || url.searchParams.get("url") === mediaUrl,
    async (route) => {
      const res = await fetch(`${origin}${mediaUrl}`);
      await route.fulfill({
        status: res.status,
        contentType: res.headers.get("content-type") ?? "image/png",
        body: Buffer.from(await res.arrayBuffer()),
      });
    }
  );
}
