import { apiFetch } from "./client";
import type { CreateTaxRateRequest, TaxRate, UpdateTaxRateRequest } from "./types";

/** `GET /admin/tax-rates` — ADMIN+MANAGER. `sortOrder ASC, name ASC` sıralı döner. */
export function listTaxRates(): Promise<TaxRate[]> {
  return apiFetch<TaxRate[]>("/admin/tax-rates");
}

/** `POST /admin/tax-rates` — yalnızca ADMIN. `name` benzersiz olmalı (409). */
export function createTaxRate(input: CreateTaxRateRequest): Promise<TaxRate> {
  return apiFetch<TaxRate>("/admin/tax-rates", { method: "POST", body: input });
}

/** `PATCH /admin/tax-rates/:taxRateId` — yalnızca ADMIN. */
export function updateTaxRate(taxRateId: string, input: UpdateTaxRateRequest): Promise<TaxRate> {
  return apiFetch<TaxRate>(`/admin/tax-rates/${taxRateId}`, { method: "PATCH", body: input });
}

/**
 * `DELETE /admin/tax-rates/:taxRateId?reassignToId=` — yalnızca ADMIN. Varsayılan oran silinemez
 * (409 `TAX_RATE_IS_DEFAULT`); kullanımda olan bir oran `reassignToId` verilmeden silinemez (409
 * `TAX_RATE_IN_USE`) — çağıran, `err.details.reason[0]` alanını kontrol ederek bu iki durumu
 * ayırt edebilir (bkz. `ApiClientError.details`).
 */
export function deleteTaxRate(taxRateId: string, reassignToId?: string): Promise<void> {
  return apiFetch<void>(`/admin/tax-rates/${taxRateId}`, {
    method: "DELETE",
    query: reassignToId ? { reassignToId } : undefined,
  });
}
