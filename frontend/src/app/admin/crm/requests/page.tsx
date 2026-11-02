"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Inbox, RefreshCw } from "lucide-react";
import * as crmApi from "@/lib/api/crm";
import { CRM_REQUEST_STATUS_OPTIONS, requestChannelLabel, type CrmRequestListQuery, type CrmRequestStatus } from "@/lib/api/crm";
import { listAdminSpecialties } from "@/lib/api/telehealth";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/components/admin/crm/crm-ui";
import { RequestStatusBadge } from "@/components/admin/crm/request-ui";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const PAGE_SIZE = 25;

/**
 * Paket AJ-4 - Danışma Talepleri (talep formundan gelenler): no, tarih, hizmet, ülke, dil, tercüman, tercih edilen
 * kanal, durum, atanan. Filtre: durum (sayılarıyla), hizmet, atanan, tarih. CSV: kişisel veri sütunlarını sunucu
 * yalnızca ADMIN'e ekler ve her dışa aktarmayı denetim kaydına yazar. Mesaj (sağlık verisi) listede YOKTUR.
 */
export default function CrmRequestsPage() {
  const [statuses, setStatuses] = useState<CrmRequestStatus[]>([]);
  const [specialtyId, setSpecialtyId] = useState("");
  const [assignedToId, setAssignedToId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const query: CrmRequestListQuery = {
    status: statuses.join(",") || undefined,
    specialtyId: specialtyId || undefined,
    assignedToId: assignedToId || undefined,
    q: search || undefined,
    from: from || undefined,
    to: to || undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const requests = useQuery({ queryKey: ["crm-requests", query], queryFn: () => crmApi.listCrmRequests(query), placeholderData: (previous) => previous });
  const assignees = useQuery({ queryKey: ["crm-request-assignees"], queryFn: crmApi.listCrmRequestAssignees });
  const specialties = useQuery({ queryKey: ["crm-request-specialties"], queryFn: listAdminSpecialties });

  function toggleStatus(s: CrmRequestStatus) {
    setPage(1);
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function exportCsv() {
    try {
      await crmApi.downloadCrmRequestsCsv(query, `talepler-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success("CSV indirildi (işlem denetim kaydına yazıldı).");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    }
  }

  const items = requests.data?.items ?? [];
  const total = requests.data?.meta.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = statuses.length > 0 || specialtyId || assignedToId || from || to || search;

  return (
    <div className="space-y-6" data-testid="crm-requests-page">
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="admin-h2">Danışma talepleri</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => void requests.refetch()} disabled={requests.isFetching}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Yenile
            </Button>
            <Button type="button" variant="outline" onClick={() => void exportCsv()} data-testid="requests-export">
              <Download className="h-4 w-4" aria-hidden="true" /> CSV
            </Button>
          </div>
        </div>

        <div role="group" aria-label="Durum filtresi" className="flex flex-wrap gap-1.5">
          {CRM_REQUEST_STATUS_OPTIONS.map((o) => {
            const active = statuses.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={active}
                onClick={() => toggleStatus(o.value)}
                className={`rounded-full border px-3 py-1 text-xs ${active ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-foreground/70 hover:bg-muted"}`}
              >
                {o.label} <span className="tabular-nums">({requests.data?.meta.statusCounts[o.value] ?? 0})</span>
              </button>
            );
          })}
        </div>

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(q.trim());
          }}
        >
          <Input aria-label="Ara: talep no, ad, e-posta, telefon" placeholder="Talep no (REQ-12), ad, e-posta" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
          <Select aria-label="Hizmet" value={specialtyId} onChange={(e) => (setPage(1), setSpecialtyId(e.target.value))} className="w-auto max-w-56">
            <option value="">Tüm hizmetler</option>
            {(specialties.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Atanan kişi" value={assignedToId} onChange={(e) => (setPage(1), setAssignedToId(e.target.value))} className="w-auto">
            <option value="">Herkes</option>
            {(assignees.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <Input type="date" aria-label="Başlangıç tarihi" value={from} onChange={(e) => (setPage(1), setFrom(e.target.value))} className="w-auto" />
          <Input type="date" aria-label="Bitiş tarihi" value={to} onChange={(e) => (setPage(1), setTo(e.target.value))} className="w-auto" />
          <Button type="submit" variant="outline">
            Ara
          </Button>
        </form>

        {requests.isPending ? (
          <Skeleton className="h-64 w-full" data-testid="requests-loading" />
        ) : requests.isError ? (
          <Alert variant="error">
            <span className="flex flex-wrap items-center gap-3">
              {friendlyErrorMessage(requests.error)}
              <Button type="button" size="sm" variant="outline" onClick={() => void requests.refetch()}>
                Tekrar dene
              </Button>
            </span>
          </Alert>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={hasFilters ? "Filtreye uyan talep yok." : "Henüz danışma talebi yok."}
            description={hasFilters ? "Filtreleri değiştirmeyi deneyin." : "Talep formundan gelen kayıtlar burada listelenir."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Danışma talepleri</caption>
              <thead>
                <tr className="border-b border-border text-xs text-foreground/60">
                  <th scope="col" className="px-2 py-2 text-start font-medium">No</th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">Tarih</th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">Hizmet</th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">Ülke</th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">Dil</th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">Tercüman</th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">Kanal</th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">Durum</th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">Atanan</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-b border-border/60 hover:bg-muted/40" data-testid="request-row">
                    <td className="px-2 py-2 whitespace-nowrap">
                      <Link href={`/admin/crm/requests/${r.id}`} className="font-medium text-primary hover:underline" dir="ltr">
                        {r.number}
                      </Link>
                      {r.fullName && (
                        <p className="text-xs text-foreground/60" dir="auto">
                          {r.fullName}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">{formatDateTime(r.createdAt)}</td>
                    <td className="px-2 py-2" dir="auto">
                      {r.serviceName ?? "-"}
                    </td>
                    <td className="px-2 py-2" dir="auto">
                      {r.country ?? "-"}
                    </td>
                    <td className="px-2 py-2">{r.contactLanguage ?? "-"}</td>
                    <td className="px-2 py-2">{r.needsInterpreter ? "Evet" : "Hayır"}</td>
                    <td className="px-2 py-2">{requestChannelLabel(r.preferredContactChannel)}</td>
                    <td className="px-2 py-2">
                      <RequestStatusBadge status={r.status} />
                    </td>
                    <td className="px-2 py-2" dir="auto">
                      {r.assignedToName ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between text-sm text-foreground/70">
          <span>
            Toplam {total} talep · Sayfa {page}/{pageCount}
          </span>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Önceki
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
              Sonraki
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
