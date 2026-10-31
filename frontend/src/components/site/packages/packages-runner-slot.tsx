import { fetchPackagesServer } from "@/lib/api/server-packages";
import { PackagesRunnerLazy } from "./packages-runner-lazy";

/**
 * Paket X — site düzenine eklenecek SUNUCU bileşeni: aktif paketleri çeker; hiç yoksa (ya da telehealth modülü kapalıysa,
 * uç 404) HİÇBİR ŞEY çizmez. Öne çıkan paket yoksa masaüstü listesi tüm aktif paketleri gösterir. Panel kodu tembel yüklenir.
 * Kullanım: `<PackagesRunnerSlot lang={lang} />` (ContactChannelsProvider ve LocaleAlternatesProvider İÇİNDE).
 */
export async function PackagesRunnerSlot({ lang }: { lang: string }) {
  const { items, categories } = await fetchPackagesServer(lang);
  if (items.length === 0) return null;
  const featured = items.filter((p) => p.isFeatured);
  const cats = categories.length > 0 ? categories : Array.from(new Set(items.map((p) => p.category)));
  return <PackagesRunnerLazy featured={featured.length > 0 ? featured : items} items={items} categories={cats} />;
}
