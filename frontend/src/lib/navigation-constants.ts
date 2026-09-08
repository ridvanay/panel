/**
 * Navigasyon derinlik/limit sabitleri — TEK normatif kaynak `docs/architecture/openapi.yaml`
 * (bkz. `NavigationItem`/`UpdateNavigationConfigRequest` şema açıklamaları) ve
 * ARCHITECTURE.md §10.10.1 / §10.10.3 / §10.10.3.1'dir.
 *
 * Bu değerler `backend/src/modules/navigation/navigation.constants.ts` içindeki AYNADIR
 * (proje bir npm workspace monorepo'su olmadığı için gerçek bir `shared/` paketi
 * orantısız — bkz. ARCHITECTURE.md §10.10.1 "Sabitin yeri"). qa-agent iki dosyanın değer
 * eşitliğini test eder. Derinliği değiştirmek istenirse SADECE bu iki dosya + kontrat
 * güncellenir, kod mantığı derinlikten bağımsızdır.
 */

/**
 * 0-tabanlı derinlik indeksi = bir öğenin ata sayısı (kök = 0). `NAVIGATION_MAX_DEPTH = 3`
 * → en derin öğe ata sayısı 3 → toplam 4 görünür seviye (Ana Menü → Kategori → Alt
 * Kategori → Ürün Grubu).
 */
export const NAVIGATION_MAX_DEPTH = 3;

/** `navigationItems` dizisinin toplam öğe sayısı üst sınırı (tüm seviyeler dahil). */
export const NAVIGATION_MAX_ITEMS = 100;
