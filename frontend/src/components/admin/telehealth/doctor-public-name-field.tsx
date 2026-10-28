"use client";

import type { UseFormRegisterReturn } from "react-hook-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { abbreviateDoctorName, doctorDisplayName } from "@/lib/doctor-display-name";

/**
 * Paket U (C2) — "Sitede görünen ad" (elle düzeltme). Boş bırakılırsa ad otomatik kısaltılır
 * (kurucu hariç); canlı önizleme sitede görünecek adı gösterir. Admin paneli Türkçe.
 */
export function DoctorPublicNameField({
  registration,
  title,
  fullName,
  publicName,
  isFounder,
  error,
}: {
  registration: UseFormRegisterReturn;
  title: string;
  fullName: string;
  publicName: string;
  isFounder: boolean;
  error?: string;
}) {
  const automatic = isFounder ? fullName.trim() : abbreviateDoctorName(fullName);
  const preview = `${title} ${doctorDisplayName({ fullName, isFounder, publicName })}`.trim();
  return (
    <Field
      id="publicName"
      label={`Sitede görünen ad (boş bırakılırsa otomatik: ${automatic || "—"})`}
      error={error}
      hint={
        isFounder
          ? "Kurucu doktor sitede tam adıyla gösterilir. Farklı bir gösterim istenirse buraya yazın."
          : "Ziyaretçiler doktoru bu adla görür (kartlar, profil, randevu, e-posta, arama sonuçları). Tam ad yalnızca yönetim panelinde ve doktorun kendi portalında görünür."
      }
    >
      {(inputProps) => (
        <div className="space-y-1.5">
          <Input {...inputProps} {...registration} placeholder={automatic} />
          <p className="text-xs text-muted-foreground" data-testid="doctor-public-name-preview">
            Önizleme: <span className="font-medium text-foreground">{preview || "—"}</span>
          </p>
        </div>
      )}
    </Field>
  );
}
