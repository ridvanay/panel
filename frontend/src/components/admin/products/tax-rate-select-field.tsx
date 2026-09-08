import Link from "next/link";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import type { ProductTaxRate, TaxRate } from "@/lib/api/types";

interface TaxRateSelectFieldProps {
  id?: string;
  value: string;
  onChange: (taxRateId: string) => void;
  taxRates: TaxRate[];
  /** Mağaza varsayılan KDV sınıfı (`SiteSettings.defaultTaxRateId` çözümlenmiş hâli) — `null` = tanımsız. */
  defaultTaxRate: ProductTaxRate | null;
  disabled?: boolean;
}

/**
 * Ürün fiyatına uygulanacak KDV sınıfını seçtiren ortak alan — ürün düzenleme ve oluşturma
 * formlarında BİREBİR aynı (`.claude` görev notu §2). `value === ""` = ürünün KENDİ oranı
 * YOK, mağaza varsayılanı kullanılır (`taxRateId: null` olarak gönderilir).
 */
export function TaxRateSelectField({ id = "taxRateId", value, onChange, taxRates, defaultTaxRate, disabled }: TaxRateSelectFieldProps) {
  const defaultLabel = defaultTaxRate
    ? `Mağaza Varsayılanı (${defaultTaxRate.name} — %${defaultTaxRate.ratePercent})`
    : "Mağaza Varsayılanı (tanımlanmamış — KDV hesaplanmaz)";

  return (
    <div>
      <Field id={id} label="Vergi Sınıfı" hint="Ürüne özel farklı bir oran gerekiyorsa değiştirin.">
        {(inputProps) => (
          <Select {...inputProps} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">{defaultLabel}</option>
            {taxRates.map((rate) => (
              <option key={rate.id} value={rate.id}>
                %{rate.ratePercent} — {rate.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="mt-1.5 border-t border-border pt-1.5">
        <Link href="/admin/settings?tab=tax" className="text-xs text-primary hover:underline">
          Vergi Sınıflarını Yönet →
        </Link>
      </div>
    </div>
  );
}
