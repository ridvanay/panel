/**
 * §10.9 Eklenti/Modül Yönetimi — kod içi statik modül TANIM registry'si. Gerçek aktif/pasif
 * DURUM `SiteModule` tablosunda tutulur (bkz. prisma/schema.prisma::SiteModule), bu dosya
 * yalnızca "hangi modüller sistemde VAR" bilgisinin tek doğru kaynağıdır — `lib/permissions-matrix.ts`
 * ile AYNI paternde salt-okunur statik bir liste.
 *
 * Faz 1'de somut bir modül YOK — yalnızca mekanizma kuruluyor. Products/Portfolio gibi gerçek
 * modüller SONRAKI fazlarda buraya eklenecek (bu dosyayı SAHİPLENEN ajan tarafından).
 */
export interface ModuleDefinition {
  key: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  /** Frontend sidebar filtresi için referans — backend bu alanı okumaz/kullanmaz, sadece taşır. */
  adminPath?: string;
  /**
   * §Faz 4 Site Şablonu — bu modülün hangi `SiteSettings.siteTemplate` değer(ler)i için ÖNERİLDİĞİ
   * (bkz. prisma/schema.prisma::SiteTemplate). Backend bu alanı okumaz/uygulamaz, yalnızca taşır —
   * frontend kurulum sihirbazında öneri göstermek için kullanır. SHOWCASE için özel bir modül
   * önerisi YOK, bu yüzden tanımsız bırakılır.
   */
  recommendedFor?: ("SHOWCASE" | "COMMERCE" | "PORTFOLIO")[];
}

export const MODULE_REGISTRY: ModuleDefinition[] = [
  {
    key: "products",
    label: "Ürünler",
    description: "Ürün kataloğu, sepet ve satın alma akışı.",
    defaultEnabled: true,
    adminPath: "/admin/products",
    recommendedFor: ["COMMERCE"],
  },
  {
    key: "portfolio",
    label: "Portföy",
    description: "Proje/iş portföyü.",
    defaultEnabled: true,
    adminPath: "/admin/portfolio",
    recommendedFor: ["PORTFOLIO"],
  },
];

export function getModuleDefinition(key: string): ModuleDefinition | undefined {
  return MODULE_REGISTRY.find((module) => module.key === key);
}
