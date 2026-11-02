import { Card } from "@/components/ui/card";
import type { CrmConsultationRequest } from "@/lib/api/crm";
import { formatDateTime } from "@/components/admin/crm/crm-ui";

/** Paket AH — CRM lead detayında talep formu ayrıntısı (salt okunur; admin paneli Türkçe kalır). */
export function ConsultationRequestCard({ request }: { request: CrmConsultationRequest }) {
  const rows: [string, string][] = [
    ["Talep no", request.number],
    ["Hizmet / paket", request.serviceName ?? "-"],
    ["Tercih edilen tarih", request.preferredFrom || request.preferredTo ? `${request.preferredFrom ?? "…"} → ${request.preferredTo ?? "…"}` : "-"],
    ["Ülke", request.country ?? "-"],
    ["İletişim dili", request.contactLanguage ?? "-"],
    ["Tercüman", request.needsInterpreter ? "Evet" : "Hayır"],
    ["Site dili", request.locale ?? "-"],
    ["İletişim rızası", request.contactConsentAt ? formatDateTime(request.contactConsentAt) : "-"],
    ["Sağlık verisi açık rızası", request.healthDataConsentAt ? formatDateTime(request.healthDataConsentAt) : "Yok"],
  ];
  return (
    <Card className="p-4" data-testid="consultation-request-card">
      <h2 className="text-base font-semibold text-foreground">Danışma talebi</h2>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-foreground/60">{label}</dt>
            <dd className="text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      {request.message && (
        <div className="mt-3">
          <p className="text-xs text-foreground/60">Mesaj</p>
          <p className="whitespace-pre-wrap text-sm text-foreground">{request.message}</p>
        </div>
      )}
    </Card>
  );
}
