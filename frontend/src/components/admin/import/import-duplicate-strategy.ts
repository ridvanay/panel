import type { ImportDuplicateStrategy, ImportJobType } from "@/lib/api/types";

/**
 * Tür başına izin verilen çakışma stratejileri — openapi.yaml `ImportDuplicateStrategy`
 * açıklamasıyla BİREBİR: `USERS` yalnızca `skip` kabul eder (rol yükseltme vektörünü
 * kapatmak için, `PATCH /admin/users/{userId}/role` tek yoldur); `MEDIA` `createNew`
 * kabul ETMEZ (dosya adı eşleştirmesinde "yeni kayıt" kavramı yok).
 */
export function allowedDuplicateStrategies(type: ImportJobType): ImportDuplicateStrategy[] {
  if (type === "USERS") return ["skip"];
  if (type === "MEDIA") return ["skip", "overwrite"];
  return ["skip", "overwrite", "createNew"];
}
