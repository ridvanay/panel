"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Check, EyeOff, Eraser, Languages, MessageSquareQuote, Plus, Reply, Star, Trash2, X } from "lucide-react";
import * as api from "@/lib/api/testimonials";
import type { AdminTestimonial, TestimonialSource, TestimonialStatus } from "@/lib/api/testimonials";
import { canFeatureOnHome } from "@/lib/testimonial-admin";
import { listAdminDoctors } from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { PageHeading } from "@/components/admin/page-heading";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ManualTestimonialDialog, RedactDialog, ReplyDialog, TranslationDialog, type DoctorOption } from "@/components/admin/testimonials/testimonial-dialogs";
import { cn } from "@/lib/utils";

const STATUS_TABS: { value: TestimonialStatus; label: string }[] = [
  { value: "pending", label: "Bekleyen" },
  { value: "approved", label: "Onaylı" },
  { value: "rejected", label: "Reddedilen" },
  { value: "hidden", label: "Gizli" },
];

const SOURCE_BADGES: Record<TestimonialSource, { label: string; tone: "success" | "primary" | "neutral" }> = {
  verified_booking: { label: "Doğrulanmış hasta", tone: "success" },
  manual_with_consent: { label: "Manuel (onaylı)", tone: "primary" },
  imported: { label: "İçe aktarılan", tone: "neutral" },
};

function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["tr"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export default function AdminTestimonialsPage() {
  const [status, setStatus] = useState<TestimonialStatus>("pending");
  const [doctorId, setDoctorId] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<api.AdminTestimonialPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [redactFor, setRedactFor] = useState<AdminTestimonial | null>(null);
  const [translateFor, setTranslateFor] = useState<AdminTestimonial | null>(null);
  const [replyFor, setReplyFor] = useState<AdminTestimonial | null>(null);
  const [removeFor, setRemoveFor] = useState<AdminTestimonial | null>(null);
  const [removing, setRemoving] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setData(await api.listAdminTestimonials({ status, doctorId: doctorId || undefined, page }));
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [status, doctorId, page]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const res = await listAdminDoctors({ limit: 100 });
        setDoctors(res.items.map((d) => ({ id: d.id, label: `${d.title} ${d.displayName ?? d.fullName}`.trim() })));
      } catch {
        // Hekim filtresi opsiyonel bir kolaylık — yüklenemezse liste yine çalışır.
      }
    })();
  }, []);

  function replaceItem(updated: AdminTestimonial) {
    // Durum değişince kayıt başka sekmeye geçer; listeyi sayımlarla birlikte yeniden çek.
    setData((prev) => (prev ? { ...prev, items: prev.items.map((i) => (i.id === updated.id ? updated : i)) } : prev));
  }

  async function changeStatus(t: AdminTestimonial, next: "approved" | "rejected" | "hidden") {
    setBusyId(t.id);
    try {
      await api.setTestimonialStatus(t.id, next);
      toast.success(next === "approved" ? "Yorum onaylandı." : next === "rejected" ? "Yorum reddedildi." : "Yorum gizlendi.");
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleFeatured(t: AdminTestimonial) {
    setBusyId(t.id);
    try {
      replaceItem(await api.updateTestimonial(t.id, { featuredOnHome: !t.featuredOnHome }));
      toast.success(t.featuredOnHome ? "Anasayfadan kaldırıldı." : "Anasayfada öne çıkarıldı.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmRemove() {
    if (!removeFor) return;
    setRemoving(true);
    try {
      await api.removeTestimonial(removeFor.id);
      toast.success("Yorum anonimleştirildi.");
      setRemoveFor(null);
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setRemoving(false);
    }
  }

  function changeTab(next: TestimonialStatus) {
    setStatus(next);
    setPage(1);
  }

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeading
        icon={MessageSquareQuote}
        title="Hasta yorumları"
        description="Yorumlar onaylanmadan sitede görünmez. Yorum metni düzenlenemez; yalnızca kişisel/sağlık bilgisi maskelenebilir."
        actions={
          <Button type="button" onClick={() => setManualOpen(true)}>
            <Plus className="h-4 w-4" />
            Manuel yorum ekle
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Yorum durumu" className="flex flex-wrap gap-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={status === tab.value}
              onClick={() => changeTab(tab.value)}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium", status === tab.value ? "bg-primary text-primary-foreground" : "bg-surface-muted text-foreground/70")}
            >
              {tab.label} ({data?.counts[tab.value] ?? 0})
            </button>
          ))}
        </div>
        <Select aria-label="Hekime göre filtrele" className="w-56" value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setPage(1); }}>
          <option value="">Tüm hekimler</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </Select>
      </div>

      {loadError && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {loadError}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      {loading && !data && (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      )}

      {data && !loadError && data.items.length === 0 && <EmptyState icon={MessageSquareQuote} title="Bu durumda yorum yok" description="Başka bir sekmeye ya da hekim filtresine bakın." />}

      {data && data.items.length > 0 && (
        <ul className="space-y-4" aria-busy={loading}>
          {data.items.map((t) => {
            const source = SOURCE_BADGES[t.source];
            const busy = busyId === t.id;
            const anonymized = Boolean(t.anonymizedAt);
            return (
              <li key={t.id}>
                <Card className="space-y-3" data-testid={`testimonial-${t.id}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-0.5 text-warning" aria-label={`Puan ${t.rating} / 5`}>
                      {Array.from({ length: 5 }, (_, i) => (
                        <Star key={i} className={cn("h-4 w-4", i < t.rating ? "fill-current" : "opacity-30")} aria-hidden="true" />
                      ))}
                    </span>
                    <Badge tone={source.tone}>{source.label}</Badge>
                    <Badge>{t.language.toUpperCase()}</Badge>
                    {t.featuredOnHome && <Badge tone="primary">Anasayfada</Badge>}
                    {anonymized && <Badge tone="danger">Anonimleştirildi</Badge>}
                    {t.redactionCount > 0 && <Badge tone="warning">{t.redactionCount} maskeleme</Badge>}
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{t.title}</h3>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/80">{t.body}</p>
                  </div>

                  <p className="text-xs text-foreground/60">
                    {t.authorDisplay}
                    {countryName(t.country) ? ` · ${countryName(t.country)}` : ""}
                    {" · "}
                    {t.doctorName ?? "Kurum yorumu"}
                    {" · "}
                    {new Date(t.createdAt).toLocaleDateString("tr-TR")}
                  </p>

                  {t.consentEvidenceNote && (
                    <p className="rounded-lg bg-surface-muted p-2 text-xs text-foreground/70">
                      <span className="font-medium">Onay kanıtı:</span> {t.consentEvidenceNote}
                    </p>
                  )}
                  {t.doctorReply && (
                    <p className="rounded-lg border border-border p-2 text-xs text-foreground/70">
                      <span className="font-medium">Hekim yanıtı:</span> {t.doctorReply}
                    </p>
                  )}
                  {t.translations && Object.keys(t.translations).length > 0 && (
                    <p className="text-xs text-foreground/60">Yönetici çevirisi: {Object.keys(t.translations).map((c) => c.toUpperCase()).join(", ")}</p>
                  )}

                  <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                    <Button type="button" size="sm" variant="success" disabled={busy || anonymized || t.status === "approved"} onClick={() => void changeStatus(t, "approved")}>
                      <Check className="h-4 w-4" />
                      Onayla
                    </Button>
                    <Button type="button" size="sm" variant="destructive" disabled={busy || t.status === "rejected"} onClick={() => void changeStatus(t, "rejected")}>
                      <X className="h-4 w-4" />
                      Reddet
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={busy || t.status === "hidden"} onClick={() => void changeStatus(t, "hidden")}>
                      <EyeOff className="h-4 w-4" />
                      Gizle
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={busy || anonymized} onClick={() => setRedactFor(t)}>
                      <Eraser className="h-4 w-4" />
                      Maskele
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={t.featuredOnHome ? "default" : "outline"}
                      aria-pressed={t.featuredOnHome}
                      disabled={busy || (!canFeatureOnHome(t) && !t.featuredOnHome)}
                      title={canFeatureOnHome(t) ? undefined : "Yalnızca onaylı yorumlar anasayfada öne çıkarılabilir."}
                      onClick={() => void toggleFeatured(t)}
                    >
                      <Star className="h-4 w-4" />
                      Anasayfada öne çıkar
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={busy || anonymized} onClick={() => setTranslateFor(t)}>
                      <Languages className="h-4 w-4" />
                      Çeviri
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={busy || anonymized} onClick={() => setReplyFor(t)}>
                      <Reply className="h-4 w-4" />
                      Hekim yanıtı
                    </Button>
                    <Button type="button" size="sm" variant="destructive" disabled={busy || anonymized} onClick={() => setRemoveFor(t)}>
                      <Trash2 className="h-4 w-4" />
                      Kaldır (hasta isteği — anonimleştir)
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {data && pageCount > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Önceki
          </Button>
          <span className="text-sm text-foreground/70">
            {page} / {pageCount}
          </span>
          <Button type="button" variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
            Sonraki
          </Button>
        </div>
      )}

      <RedactDialog
        key={`redact-${redactFor?.id ?? "none"}`}
        testimonial={redactFor}
        onClose={() => setRedactFor(null)}
        onDone={(updated) => {
          replaceItem(updated);
          setRedactFor(updated);
        }}
      />
      <TranslationDialog
        key={`tr-${translateFor?.id ?? "none"}`}
        testimonial={translateFor}
        onClose={() => setTranslateFor(null)}
        onDone={(updated) => {
          replaceItem(updated);
          setTranslateFor(null);
        }}
      />
      <ReplyDialog
        key={`reply-${replyFor?.id ?? "none"}`}
        testimonial={replyFor}
        onClose={() => setReplyFor(null)}
        onDone={(updated) => {
          replaceItem(updated);
          setReplyFor(null);
        }}
      />
      {manualOpen && (
        <ManualTestimonialDialog
          open
          doctors={doctors}
          onClose={() => setManualOpen(false)}
          onDone={() => {
            setManualOpen(false);
            if (status === "pending" && page === 1) void load();
            else changeTab("pending");
          }}
        />
      )}
      <ConfirmDialog
        open={removeFor !== null}
        onOpenChange={(open) => !open && setRemoveFor(null)}
        title="Yorum anonimleştirilsin mi?"
        description="Hasta isteğiyle yorumun metni ve kimlik izleri kalıcı olarak silinir; sitede görünmez. Bu işlem geri alınamaz."
        confirmText="Anonimleştir"
        tone="danger"
        loading={removing}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  );
}
