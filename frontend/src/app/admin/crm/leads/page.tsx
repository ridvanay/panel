"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Plus, RefreshCw } from "lucide-react";
import * as crmApi from "@/lib/api/crm";
import {
  CRM_LEAD_CHANNEL_OPTIONS,
  CRM_LEAD_STATUS_OPTIONS,
  leadChannelLabel,
  type CrmLeadChannel,
  type CrmLeadListQuery,
  type CrmLeadStatus,
} from "@/lib/api/crm";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateLeadDialog } from "@/components/admin/crm/create-lead-dialog";
import { AdsTools } from "@/components/admin/crm/ads-tools";
import { LeadStatusBadge, SlaBadge, formatDateTime } from "@/components/admin/crm/crm-ui";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

/**
 * Paket N2 — Talepler: durum (sayılarıyla) ve kanal filtreleri, arama (ad/e-posta/telefon/Ref kodu),
 * aday/gerçek ayrımı, tarih aralığı, toplu durum değiştirme, CSV dışa aktarma (audit'li), "bugün
 * aranacaklar", elle talep ekleme ve kaynaklardan şimdi senkronize etme.
 */
export default function CrmLeadsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [statuses, setStatuses] = useState<CrmLeadStatus[]>([]);
  const [channel, setChannel] = useState<CrmLeadChannel | "">("");
  const [candidate, setCandidate] = useState<"all" | "true" | "false">("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<CrmLeadStatus>("CALLED");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const query: CrmLeadListQuery = {
    status: statuses.join(",") || undefined,
    channel: channel || undefined,
    candidate,
    q: search || undefined,
    from: from || undefined,
    to: to || undefined,
    page,
    pageSize: 25,
  };
  const leads = useQuery({ queryKey: ["crm-leads", query], queryFn: () => crmApi.listCrmLeads(query), placeholderData: (previous) => previous });
  // Görünmeyen kayıtlara toplu işlem uygulanmasın: filtre/sayfa değişince seçim sıfırlanır.
  const queryKey = JSON.stringify(query);
  const [selectionKey, setSelectionKey] = useState(queryKey);
  if (selectionKey !== queryKey) {
    setSelectionKey(queryKey);
    setSelected(new Set());
  }
  const today = useQuery({ queryKey: ["crm-leads-today"], queryFn: crmApi.listTodayCrmLeads });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
    void queryClient.invalidateQueries({ queryKey: ["crm-leads-today"] });
  };

  function toggleStatus(s: CrmLeadStatus) {
    setPage(1);
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function runBulk() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const result = await crmApi.bulkUpdateCrmLeadStatus([...selected], bulkStatus);
      toast.success(`${result.updated} talebin durumu güncellendi.`);
      setSelected(new Set());
      refresh();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    try {
      const result = await crmApi.syncCrmLeads();
      toast.success(result.created > 0 ? `${result.created} yeni talep alındı.` : "Yeni talep yok.");
      refresh();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    try {
      await crmApi.downloadCrmFile(
        "/admin/crm/leads/export",
        { status: query.status, channel: query.channel, candidate, q: query.q, from: query.from, to: query.to },
        `crm-talepler-${new Date().toISOString().slice(0, 10)}.csv`
      );
      toast.success("CSV indirildi (işlem denetim kaydına yazıldı).");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    }
  }

  const items = leads.data?.items ?? [];
  const total = leads.data?.meta.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / 25));
  const allSelected = items.length > 0 && items.every((l) => selected.has(l.id));

  return (
    <div className="space-y-6">
      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="admin-h2">Bugün aranacaklar</h2>
          <span className="text-sm text-foreground/60">{today.data?.length ?? 0} talep</span>
        </div>
        {today.isError ? (
          <Alert variant="error">{friendlyErrorMessage(today.error)}</Alert>
        ) : today.data && today.data.length > 0 ? (
          <ul className="divide-y divide-border">
            {today.data.slice(0, 8).map((lead) => (
              <li key={lead.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <Link href={`/admin/crm/leads/${lead.id}`} className="font-medium text-primary hover:underline" dir="auto">
                  {lead.name || `#${lead.seq} ${leadChannelLabel(lead.channel)}`}
                </Link>
                <span className="flex items-center gap-2 text-foreground/70">
                  <LeadStatusBadge status={lead.status} />
                  {formatDateTime(lead.nextActionAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-foreground/60">Bugün için planlanmış arama yok.</p>
        )}
      </Card>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Yeni talep
          </Button>
          <Button type="button" variant="outline" onClick={() => void sync()} disabled={busy}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Kaynaklardan al
          </Button>
          <Button type="button" variant="outline" onClick={() => void exportCsv()}>
            <Download className="h-4 w-4" aria-hidden="true" /> CSV / Excel
          </Button>
          <AdsTools onImported={refresh} />
        </div>

        <div role="group" aria-label="Durum filtresi" className="flex flex-wrap gap-1.5">
          {CRM_LEAD_STATUS_OPTIONS.map((o) => {
            const active = statuses.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={active}
                onClick={() => toggleStatus(o.value)}
                className={`rounded-full border px-3 py-1 text-xs ${active ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-foreground/70 hover:bg-muted"}`}
              >
                {o.label} <span className="tabular-nums">({leads.data?.meta.statusCounts[o.value] ?? 0})</span>
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
          <Input aria-label="Ara: ad, e-posta, telefon, Ref kodu" placeholder="Ad, e-posta, telefon ya da Ref kodu" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
          <Select aria-label="Kanal" value={channel} onChange={(e) => (setPage(1), setChannel(e.target.value as CrmLeadChannel | ""))} className="w-auto">
            <option value="">Tüm kanallar</option>
            {CRM_LEAD_CHANNEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Talep türü" value={candidate} onChange={(e) => (setPage(1), setCandidate(e.target.value as typeof candidate))} className="w-auto">
            <option value="all">Hepsi</option>
            <option value="false">Gerçek talepler</option>
            <option value="true">Aday (tıklama)</option>
          </Select>
          <Input type="date" aria-label="Başlangıç tarihi" value={from} onChange={(e) => (setPage(1), setFrom(e.target.value))} className="w-auto" />
          <Input type="date" aria-label="Bitiş tarihi" value={to} onChange={(e) => (setPage(1), setTo(e.target.value))} className="w-auto" />
          <Button type="submit" variant="outline">
            Ara
          </Button>
        </form>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-2 text-sm">
            <span>{selected.size} talep seçildi →</span>
            <Select aria-label="Toplu durum" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as CrmLeadStatus)} className="w-auto">
              {CRM_LEAD_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Button type="button" size="sm" onClick={() => void runBulk()} disabled={busy}>
              Durumu uygula
            </Button>
          </div>
        )}

        {leads.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : leads.isError ? (
          <Alert variant="error">{friendlyErrorMessage(leads.error)}</Alert>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Talepler</caption>
              <thead>
                <tr className="border-b border-border text-xs text-foreground/60">
                  <th scope="col" className="w-8 px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label="Sayfadakilerin hepsini seç"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((l) => l.id)))}
                    />
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">Talep</th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">Kanal / Kaynak</th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">Durum</th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">Atanan</th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">İlk yanıt</th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">Sonraki aksiyon</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-2 py-8 text-center text-foreground/50">
                      Talep yok.
                    </td>
                  </tr>
                ) : (
                  items.map((lead) => (
                    <tr key={lead.id} className="cursor-pointer border-b border-border/60 hover:bg-muted/40" onClick={() => router.push(`/admin/crm/leads/${lead.id}`)}>
                      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`#${lead.seq} seç`}
                          checked={selected.has(lead.id)}
                          onChange={() =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(lead.id)) next.delete(lead.id);
                              else next.add(lead.id);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Link href={`/admin/crm/leads/${lead.id}`} className="font-medium text-foreground hover:underline" dir="auto" onClick={(e) => e.stopPropagation()}>
                          {lead.name || (lead.candidate ? "Aday talep" : "İsimsiz")}
                        </Link>
                        <p className="text-xs text-foreground/60" dir="ltr">
                          #{lead.seq} · {formatDateTime(lead.createdAt)}
                          {lead.refCode ? ` · Ref ${lead.refCode}` : ""}
                        </p>
                        {(lead.phone || lead.email) && (
                          <p className="text-xs text-foreground/60" dir="ltr">
                            {[lead.phone, lead.email].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {leadChannelLabel(lead.channel)}
                        {lead.candidate && <span className="ms-1 text-xs text-warning">(aday)</span>}
                        <p className="text-xs text-foreground/60" dir="auto">
                          {[lead.source, lead.medium, lead.campaign].filter(Boolean).join(" / ") || "—"}
                        </p>
                      </td>
                      <td className="px-2 py-2">
                        <LeadStatusBadge status={lead.status} />
                      </td>
                      <td className="px-2 py-2" dir="auto">
                        {lead.assignedToName ?? "—"}
                      </td>
                      <td className="px-2 py-2">
                        <SlaBadge sla={lead.sla} />
                      </td>
                      <td className="px-2 py-2">{formatDateTime(lead.nextActionAt)}</td>
                    </tr>
                  ))
                )}
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

      <CreateLeadDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          refresh();
          router.push(`/admin/crm/leads/${id}`);
        }}
      />
    </div>
  );
}
