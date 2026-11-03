"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { PageHeading } from "@/components/admin/page-heading";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import {
  cancelAdminConsultation,
  getAdminConsultation,
  listAdminConsultations,
  resendAdminConsultationLinks,
  type AdminConsultationsPage,
  type AdminServiceConsultation,
  type ServiceConsultationStatus,
} from "@/lib/api/service-desk-admin";
import { DESK_TIME_ZONE, STATUS_LABELS, STATUS_TONES, formatDateTimeIn, languageName } from "./service-desk-format";
import { ServiceDeskNav } from "./service-desk-nav";

const STATUS_FILTERS: ServiceConsultationStatus[] = ["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"];

/** `/admin/service-desk/consultations` — liste (tarih/durum süzgeci), detay ve iptal. Hasta adı yalnızca baş harfli gelir. */
export function ConsultationsManager() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<ServiceConsultationStatus | "">("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AdminConsultationsPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [resendTarget, setResendTarget] = useState<AdminServiceConsultation | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AdminServiceConsultation | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setResult(null);
    try {
      setResult(await listAdminConsultations({ from, to, status, page }));
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, [from, to, status, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- süzgeç/sayfa değişince yeniden yükle
    void load();
  }, [load]);

  function changeFilter(apply: () => void) {
    apply();
    setPage(1);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeading icon={CalendarClock} title="Hizmet görüşmeleri" description="Hastaların rezerve ettiği online görüşmeler. Hasta adı yalnızca baş harfleriyle gösterilir; iletişim bilgilerini yalnızca atanan koordinatör görür." />
      <ServiceDeskNav />
      <Card className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field id="consultations-from" label="Başlangıç tarihi">
            {(p) => <Input {...p} type="date" className="w-auto" value={from} onChange={(e) => changeFilter(() => setFrom(e.target.value))} />}
          </Field>
          <Field id="consultations-to" label="Bitiş tarihi">
            {(p) => <Input {...p} type="date" className="w-auto" value={to} onChange={(e) => changeFilter(() => setTo(e.target.value))} />}
          </Field>
          <Field id="consultations-status" label="Durum">
            {(p) => (
              <Select {...p} className="w-44" value={status} onChange={(e) => changeFilter(() => setStatus(e.target.value as ServiceConsultationStatus | ""))}>
                <option value="">Tümü</option>
                {STATUS_FILTERS.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {loadError && (
          <Alert variant="error">
            <span className="flex flex-wrap items-center gap-3">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{loadError}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
                Yeniden dene
              </Button>
            </span>
          </Alert>
        )}
        {!result && !loadError && (
          <div className="space-y-2" role="status" aria-busy="true" data-testid="consultations-loading">
            <span className="sr-only">Yükleniyor</span>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        {result && result.items.length === 0 && (
          <EmptyState icon={CalendarClock} title="Görüşme bulunamadı" description="Süzgeçleri değiştirmeyi deneyin." />
        )}
        {result && result.items.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Numara</TableHead>
                  <TableHead>Saat (İstanbul)</TableHead>
                  <TableHead>Hizmet</TableHead>
                  <TableHead>Hasta</TableHead>
                  <TableHead>Koordinatör</TableHead>
                  <TableHead>Dil</TableHead>
                  <TableHead>Tercüman</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>
                    <span className="sr-only">İşlemler</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((c) => (
                  <TableRow key={c.id} data-testid={`consultation-row-${c.id}`}>
                    <TableCell className="font-mono text-xs">{c.consultationNumber}</TableCell>
                    <TableCell>{formatDateTimeIn(c.startsAt, DESK_TIME_ZONE)}</TableCell>
                    <TableCell>{c.serviceName}</TableCell>
                    <TableCell>{c.patientName}</TableCell>
                    <TableCell>{c.coordinatorName ?? "-"}</TableCell>
                    <TableCell>{languageName(c.contactLanguage)}</TableCell>
                    <TableCell>{c.needsInterpreter ? languageName(c.interpreterLanguage) : "Yok"}</TableCell>
                    <TableCell>
                      <Badge tone={STATUS_TONES[c.status]}>{STATUS_LABELS[c.status]}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Button type="button" size="sm" variant="ghost" aria-label={`${c.consultationNumber} detayı`} onClick={() => setDetailId(c.id)}>
                        Detay
                      </Button>
                      {c.status === "SCHEDULED" && (
                        <Button type="button" size="sm" variant="ghost" aria-label={`${c.consultationNumber} iptal et`} onClick={() => setCancelTarget(c)}>
                          İptal
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {result && (page > 1 || result.hasNext) && (
          <div className="flex items-center justify-between">
            <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Önceki
            </Button>
            <span className="text-sm text-foreground/60">Sayfa {page}</span>
            <Button type="button" size="sm" variant="outline" disabled={!result.hasNext} onClick={() => setPage((p) => p + 1)}>
              Sonraki
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        )}
      </Card>
      <ConsultationDetailDialog
        id={detailId}
        onClose={() => setDetailId(null)}
        onCancel={(c) => {
          setDetailId(null);
          setCancelTarget(c);
        }}
        onResend={(c) => setResendTarget(c)}
      />
      <ResendLinksDialog target={resendTarget} onClose={() => setResendTarget(null)} />
      <CancelConsultationDialog
        target={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onCancelled={() => {
          setCancelTarget(null);
          void load();
        }}
      />
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <dt className="text-foreground/60">{label}</dt>
      <dd className="col-span-2 text-foreground">{children}</dd>
    </div>
  );
}

/** Planlı ve henüz bitmemiş görüşmede bağlantılar yeniden gönderilebilir. */
function canResendLinks(c: AdminServiceConsultation): boolean {
  return c.status === "SCHEDULED" && new Date(c.endsAt).getTime() > Date.now();
}

function resendErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.status === 409) return "Görüşme iptal edilmiş ya da bitmiş; bağlantılar yeniden gönderilemez.";
    if (err.status === 422) return "Hasta için kayıtlı e-posta adresi yok; bağlantılar gönderilemedi.";
    if (err.status === 429) return "Çok fazla deneme yapıldı. Lütfen biraz bekleyip tekrar deneyin.";
  }
  return friendlyErrorMessage(err);
}

function ResendLinksDialog({ target, onClose }: { target: AdminServiceConsultation | null; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- yeni hedefte hatayı sıfırla
    setError(null);
  }, [target]);

  async function confirm() {
    if (!target) return;
    setLoading(true);
    setError(null);
    try {
      const res = await resendAdminConsultationLinks(target.id);
      if (res?.sent) toast.success("Bağlantılar hastaya e-postayla gönderildi.");
      else toast.error("E-posta gönderilemedi, eski bağlantılar geçerli kaldı.");
      onClose();
    } catch (err) {
      setError(resendErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bağlantılar yeniden gönderilsin mi?</DialogTitle>
          <DialogDescription>Hastaya yeni katılım ve yönetim bağlantısı e-postayla gider; eski bağlantılar geçersiz olur.</DialogDescription>
        </DialogHeader>
        {error && <Alert variant="error">{error}</Alert>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="button" loading={loading} onClick={() => void confirm()}>
            Bağlantıları yeniden gönder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConsultationDetailDialog({
  id,
  onClose,
  onCancel,
  onResend,
}: {
  id: string | null;
  onClose: () => void;
  onCancel: (c: AdminServiceConsultation) => void;
  onResend: (c: AdminServiceConsultation) => void;
}) {
  const [detail, setDetail] = useState<AdminServiceConsultation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- diyalog açılınca detayı yükle
    setDetail(null);
    setError(null);
    getAdminConsultation(id)
      .then((d) => alive && setDetail(d))
      .catch((err) => alive && setError(friendlyErrorMessage(err)));
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Görüşme detayı</DialogTitle>
          <DialogDescription>Kişisel veri içermez; hasta adı baş harflidir.</DialogDescription>
        </DialogHeader>
        {error && <Alert variant="error">{error}</Alert>}
        {!detail && !error && (
          <div className="space-y-2" role="status" aria-busy="true">
            <span className="sr-only">Yükleniyor</span>
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        )}
        {detail && (
          <dl className="space-y-2" data-testid="consultation-detail">
            <DetailRow label="Numara">{detail.consultationNumber}</DetailRow>
            <DetailRow label="Hizmet">{detail.serviceName}</DetailRow>
            <DetailRow label="Saat (İstanbul)">{formatDateTimeIn(detail.startsAt, DESK_TIME_ZONE)}</DetailRow>
            {detail.patientTimeZone && <DetailRow label="Hastanın saati">{formatDateTimeIn(detail.startsAt, detail.patientTimeZone)}</DetailRow>}
            <DetailRow label="Hasta">{detail.patientName}</DetailRow>
            <DetailRow label="Koordinatör">{detail.coordinatorName ?? "-"}</DetailRow>
            <DetailRow label="Dil">{languageName(detail.contactLanguage)}</DetailRow>
            <DetailRow label="Tercüman">{detail.needsInterpreter ? languageName(detail.interpreterLanguage) : "Yok"}</DetailRow>
            <DetailRow label="Durum">
              <Badge tone={STATUS_TONES[detail.status]}>{STATUS_LABELS[detail.status]}</Badge>
            </DetailRow>
            {detail.cancelledAt && <DetailRow label="İptal">{formatDateTimeIn(detail.cancelledAt, DESK_TIME_ZONE)}</DetailRow>}
          </dl>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Kapat
          </Button>
          {detail && canResendLinks(detail) && (
            <Button type="button" variant="outline" onClick={() => onResend(detail)}>
              Bağlantıları yeniden gönder
            </Button>
          )}
          {detail?.status === "SCHEDULED" && (
            <Button type="button" variant="destructive" onClick={() => onCancel(detail)}>
              Görüşmeyi iptal et
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelConsultationDialog({ target, onClose, onCancelled }: { target: AdminServiceConsultation | null; onClose: () => void; onCancelled: () => void }) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- yeni hedefte formu sıfırla
    setReason("");
    setError(null);
  }, [target]);

  async function confirm() {
    if (!target) return;
    setLoading(true);
    setError(null);
    try {
      await cancelAdminConsultation(target.id, reason.trim() || undefined);
      toast.success("Görüşme iptal edildi.");
      onCancelled();
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Görüşme iptal edilsin mi?</DialogTitle>
          <DialogDescription>
            {target ? `${target.consultationNumber} numaralı görüşme iptal edilir, hastaya iptal e-postası gider ve oda kapanır. Bu işlem geri alınamaz.` : ""}
          </DialogDescription>
        </DialogHeader>
        {error && <Alert variant="error">{error}</Alert>}
        <Field id="cancel-reason" label="Gerekçe (iç not, isteğe bağlı)" hint="Sağlık bilgisi yazmayın.">
          {(p) => <Textarea {...p} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="button" variant="destructive" loading={loading} onClick={() => void confirm()}>
            Görüşmeyi iptal et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
