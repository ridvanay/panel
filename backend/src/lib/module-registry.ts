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
}

export const MODULE_REGISTRY: ModuleDefinition[] = [];

export function getModuleDefinition(key: string): ModuleDefinition | undefined {
  return MODULE_REGISTRY.find((module) => module.key === key);
}
