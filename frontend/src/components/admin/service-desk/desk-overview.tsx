"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, AlertTriangle, Headset, Lock } from "lucide-react";
import { toast } from "sonner";
import { PageHeading } from "@/components/admin/page-heading";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/context/auth-context";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { getServiceDesk, updateServiceDesk, type ServiceDeskOverview } from "@/lib/api/service-desk-admin";
import { DeskClosuresCard } from "./desk-closures-card";
import { DeskHoursCard } from "./desk-hours-card";
import { ServiceDeskNav } from "./service-desk-nav";

const DURATION_OPTIONS = [15, 20, 30, 45, 60];
const NOTICE_HOURS_OPTIONS = [1, 2, 3, 4, 6, 12, 24, 48];

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Genel anahtarı açmadan önce eksik koşulları listeler (en az 1 aktif koordinatör + en az 1 çalışma saati). */
export function missingBookingPrerequisites(overview: Pick<ServiceDeskOverview, "stats" | "hours">): string[] {
  const missing: string[] = [];
  if (overview.stats.activeCoordinators < 1) missing.push("en az bir aktif koordinatör");
  if (overview.hours.length < 1) missing.push("en az bir çalışma saati aralığı");
  return missing;
}

/** `/admin/service-desk` — genel anahtar, masa ayarları, çalışma saatleri ve tatil günleri. ADMIN + MANAGER; anahtarı yalnızca ADMIN değiştirir. */
export function ServiceDeskOverviewPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [overview, setOverview] = useState<ServiceDeskOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await getServiceDesk();
      setOverview(data);
      setVersion((v) => v + 1);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ilk yükleme
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeading icon={Headset} title="Hizmet Masası" description="Online görüşme rezervasyonu: genel anahtar, masa ayarları, çalışma saatleri ve tatil günleri." />
      <ServiceDeskNav />
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
      {!overview && !loadError && (
        <div className="space-y-4" role="status" aria-busy="true" data-testid="desk-loading">
          <span className="sr-only">Yükleniyor</span>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      )}
      {overview && (
        <>
          <BookingSwitchCard overview={overview} isAdmin={isAdmin} onChanged={() => void load()} />
          <DeskSettingsCard key={`settings-${version}`} overview={overview} onSaved={() => void load()} />
          <DeskHoursCard key={`hours-${version}`} hours={overview.hours} timeZone={overview.desk.timeZone} canEdit onSaved={() => void load()} />
          <DeskClosuresCard closures={overview.closures} canEdit onChanged={() => void load()} />
        </>
      )}
    </div>
  );
}

function BookingSwitchCard({ overview, isAdmin, onChanged }: { overview: ServiceDeskOverview; isAdmin: boolean; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string[] | null>(null);
  const enabled = overview.serviceBookingEnabled;

  async function toggle(next: boolean) {
    setError(null);
    setWarning(null);
    if (next) {
      const missing = missingBookingPrerequisites(overview);
      if (missing.length > 0) {
        setWarning(missing);
        return;
      }
    }
    setSaving(true);
    try {
      await updateServiceDesk({ serviceBookingEnabled: next });
      toast.success(next ? "Online görüşme rezervasyonu açıldı." : "Online görüşme rezervasyonu kapatıldı.");
      onChanged();
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-3" data-testid="desk-booking-switch-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <label htmlFor="service-booking-enabled" className="admin-h2 block">
            Online consultation booking
          </label>
          <p className="mt-1 admin-text-secondary">
            Açıkken sitedeki tüm &quot;Book a consultation&quot; düğmeleri takvimli rezervasyona gider; kapalıyken talep formuna (Request a call back) gider.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={enabled ? "success" : "neutral"}>{enabled ? "Açık" : "Kapalı"}</Badge>
          <Switch id="service-booking-enabled" aria-label="Online consultation booking" checked={enabled} disabled={!isAdmin || saving} onCheckedChange={(v) => void toggle(v)} />
        </div>
      </div>
      {!isAdmin && <p className="text-xs text-foreground/60">Bu anahtarı yalnızca yönetici (ADMIN) değiştirebilir.</p>}
      <p className="text-xs text-foreground/60" data-testid="desk-stats">
        Aktif koordinatör: <strong>{overview.stats.activeCoordinators}</strong> - Önümüzdeki 7 günde uygun saat: <strong>{overview.stats.next7DaysSlots}</strong>
      </p>
      {warning && (
        <Alert variant="warning">
          <span className="flex items-start gap-2" data-testid="desk-enable-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Rezervasyon açılamadı: önce {warning.join(" ve ")} tanımlayın.{" "}
              <Link href="/admin/service-desk/coordinators" className="underline">
                Koordinatörler
              </Link>
            </span>
          </span>
        </Alert>
      )}
      {error && <Alert variant="error">{error}</Alert>}
    </Card>
  );
}

function DeskSettingsCard({ overview, onSaved }: { overview: ServiceDeskOverview; onSaved: () => void }) {
  const { desk } = overview;
  const [durationMin, setDurationMin] = useState(desk.durationMin);
  const [noticeHours, setNoticeHours] = useState(Math.round(desk.minNoticeMin / 60));
  const [horizonDays, setHorizonDays] = useState(String(desk.horizonDays));
  const [timeZone, setTimeZone] = useState(desk.timeZone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const durationOptions = DURATION_OPTIONS.includes(durationMin) ? DURATION_OPTIONS : [...DURATION_OPTIONS, durationMin].sort((a, b) => a - b);
  const noticeOptions = NOTICE_HOURS_OPTIONS.includes(noticeHours) ? NOTICE_HOURS_OPTIONS : [...NOTICE_HOURS_OPTIONS, noticeHours].sort((a, b) => a - b);

  async function save() {
    const horizon = Number(horizonDays);
    if (!Number.isInteger(horizon) || horizon < 1 || horizon > 90) {
      setError("Ufuk 1 ile 90 gün arasında olmalı.");
      return;
    }
    if (!isValidTimeZone(timeZone.trim())) {
      setError("Geçerli bir saat dilimi girin (örn. Europe/Istanbul).");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await updateServiceDesk({ durationMin, minNoticeMin: noticeHours * 60, horizonDays: horizon, timeZone: timeZone.trim() });
      toast.success("Masa ayarları kaydedildi.");
      onSaved();
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4" data-testid="desk-settings-card">
      <h2 className="admin-h2">Masa ayarları</h2>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="desk-duration" label="Görüşme süresi">
          {(p) => (
            <Select {...p} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))}>
              {durationOptions.map((m) => (
                <option key={m} value={m}>
                  {m} dakika
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="desk-notice" label="En erken rezervasyon" hint="Hasta, görüşmeden en az bu kadar önce saat seçebilir.">
          {(p) => (
            <Select {...p} value={noticeHours} onChange={(e) => setNoticeHours(Number(e.target.value))}>
              {noticeOptions.map((h) => (
                <option key={h} value={h}>
                  {h} saat sonra
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="desk-horizon" label="En fazla kaç gün ileri" hint="Varsayılan 30 gün.">
          {(p) => <Input {...p} type="number" min={1} max={90} value={horizonDays} onChange={(e) => setHorizonDays(e.target.value)} />}
        </Field>
        <Field id="desk-timezone" label="Saat dilimi" hint="Çalışma saatleri bu dilimin duvar saatidir.">
          {(p) => <Input {...p} value={timeZone} onChange={(e) => setTimeZone(e.target.value)} />}
        </Field>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
        <label htmlFor="desk-paid" className="flex items-center gap-2 text-sm text-foreground/70">
          <Lock className="h-4 w-4" aria-hidden="true" />
          Ücretli görüşme
        </label>
        <span className="flex items-center gap-2">
          <Badge tone="neutral">Yakında</Badge>
          <Switch id="desk-paid" checked={false} disabled />
        </span>
      </div>
      <Button type="button" loading={saving} onClick={() => void save()}>
        Ayarları kaydet
      </Button>
    </Card>
  );
}
