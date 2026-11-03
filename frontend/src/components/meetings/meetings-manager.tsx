"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, CalendarX2, Link2, Pencil, ShieldAlert, Users, Video, XCircle, AlertCircle } from "lucide-react";
import {
  adminCancelMeeting,
  cancelMeeting,
  listAdminMeetings,
  listMeetings,
  regenerateGuestLink,
  type Meeting,
  type MeetingPhase,
} from "@/lib/api/meetings";
import { useAuthOptional } from "@/context/auth-context";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { SITE_ORIGIN } from "@/lib/doctor-host";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";
import { fmt, useMeetingErrorMessage, useMeetingStrings } from "@/lib/i18n/use-meeting-strings";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeading } from "@/components/admin/page-heading";
import { formatMeetingIstanbul, formatMeetingWhen, isInJoinWindow } from "@/components/site/meeting/meeting-time";
import { MeetingFormDialog } from "./meeting-form-dialog";
import { MeetingLinkCard } from "./meeting-link-card";
import { defaultGuestLocale } from "./guest-locales";

type Tab = "upcoming" | "past";
type View = "mine" | "all";

const PHASE_TONE: Record<MeetingPhase, "primary" | "success" | "neutral" | "danger"> = {
  upcoming: "primary",
  open: "success",
  ended: "neutral",
  cancelled: "danger",
};

interface LinkState {
  meeting: Pick<Meeting, "id" | "title" | "startsAt">;
  link: string;
  heading: "created" | "regenerated";
  locale: string;
}

/**
 * Paket AG İş 3 — "Toplantılar" yönetimi. `/admin/meetings` (panel) ve `/{lang}/doctor/meetings` (doktor portalı) AYNI
 * bileşeni kullanır (S1). ADMIN ayrıca "Tüm toplantılar" görünümüyle gözetim yapar: iptal edebilir, başkasının toplantısına
 * katılamaz (S4; katıl düğmesi yoktur). Kayıt/silme/başkasının toplantısını açma yetkisi sunucudadır; bu ekran yalnızca arayüzdür.
 */
function MeetingsManagerInner({ variant }: { variant: "admin" | "doctor" }) {
  const { t, lang } = useMeetingStrings();
  const errorMessage = useMeetingErrorMessage();
  const auth = useAuthOptional();
  const user = auth?.user ?? null;
  const localize = useLocalizePath();
  const now = useNow(30_000);

  const isAdmin = user?.role === "ADMIN";
  const [view, setView] = useState<View>("mine");
  const [tab, setTab] = useState<Tab>("upcoming");
  const [items, setItems] = useState<Meeting[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [linkState, setLinkState] = useState<LinkState | null>(null);
  const [pendingRegen, setPendingRegen] = useState<Meeting | null>(null);
  const [regenLoading, setRegenLoading] = useState(false);
  const [pendingCancel, setPendingCancel] = useState<Meeting | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  const fetchPage = useCallback((v: View, tb: Tab, c?: string) => (v === "all" ? listAdminMeetings(tb, c) : listMeetings(tb, c)), []);

  const load = useCallback(async () => {
    setItems(null);
    setError(null);
    try {
      const page = await fetchPage(view, tab);
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [fetchPage, view, tab, errorMessage]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- veri yükleme efekti (kaynak değişince yeniden çeker)
    void load();
  }, [load]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(view, tab, cursor);
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  function handleSaved(result: { meeting: Meeting; guestLink?: string; locale?: string }) {
    setFormOpen(false);
    setEditing(null);
    setNotice(t.savedToast);
    if (result.guestLink) {
      setLinkState({ meeting: result.meeting, link: result.guestLink, heading: "created", locale: result.locale ?? defaultGuestLocale(lang) });
    }
    void load();
  }

  async function confirmRegen() {
    if (!pendingRegen) return;
    setRegenLoading(true);
    setActionError(null);
    try {
      const locale = defaultGuestLocale(lang);
      const res = await regenerateGuestLink(pendingRegen.id, locale);
      setLinkState({ meeting: pendingRegen, link: res.guestLink, heading: "regenerated", locale });
      setPendingRegen(null);
      void load();
    } catch (err) {
      setActionError(errorMessage(err));
      setPendingRegen(null);
    } finally {
      setRegenLoading(false);
    }
  }

  async function confirmCancel() {
    if (!pendingCancel) return;
    setCancelLoading(true);
    setActionError(null);
    try {
      if (view === "all") await adminCancelMeeting(pendingCancel.id);
      else await cancelMeeting(pendingCancel.id);
      setNotice(t.cancelledToast);
      setPendingCancel(null);
      void load();
    } catch (err) {
      setActionError(errorMessage(err));
      setPendingCancel(null);
    } finally {
      setCancelLoading(false);
    }
  }

  function joinHref(id: string): string {
    const path = localize(`/meet/${encodeURIComponent(id)}`);
    // Doktor portalı doktor alt alan adında olabilir; oda ana sitede (`/consultation` ile aynı) → mutlak URL, tam sayfa geçiş.
    return variant === "doctor" ? `${SITE_ORIGIN}${path}` : path;
  }

  const showTwoFactorAdvice = user !== null && user.twoFactorEnabled === false;
  const newButton = (
    <Button type="button" onClick={() => { setEditing(null); setFormOpen(true); }} data-testid="meetings-new">
      <CalendarPlus aria-hidden="true" />
      {t.newMeeting}
    </Button>
  );

  const heading =
    variant === "admin" ? (
      <PageHeading icon={Video} title={t.pageTitle} description={t.pageDescription} actions={newButton} />
    ) : (
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-5">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 font-heading text-xl font-semibold text-foreground sm:text-2xl">
            <Video className="h-6 w-6 text-[var(--site-primary)]" aria-hidden="true" />
            {t.pageTitle}
          </h1>
          <p className="max-w-2xl text-sm text-foreground/70">{t.pageDescription}</p>
        </div>
        {newButton}
      </div>
    );

  return (
    <div className="space-y-5" data-testid="meetings-manager">
      {heading}

      {showTwoFactorAdvice && (
        <Alert variant="info">
          <span className="flex items-start gap-2" data-testid="meetings-2fa-advice">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t.twoFactorAdvice}
          </span>
        </Alert>
      )}
      {notice && (
        <Alert variant="success">
          <span data-testid="meetings-notice">{notice}</span>
        </Alert>
      )}
      {actionError && <Alert variant="error">{actionError}</Alert>}
      {view === "all" && (
        <Alert variant="info">
          <span data-testid="meetings-admin-note">{t.adminOverviewNote}</span>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label={t.tabsLabel} className="inline-flex rounded-lg border border-border p-0.5">
          {(["upcoming", "past"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`meetings-tab-${key}`}
              aria-selected={tab === key}
              aria-controls="meetings-panel"
              onClick={() => setTab(key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                tab === key ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:text-foreground"
              )}
            >
              {key === "upcoming" ? t.tabUpcoming : t.tabPast}
            </button>
          ))}
        </div>
        {variant === "admin" && isAdmin && (
          <div role="group" aria-label={t.viewLabel} className="inline-flex rounded-lg border border-border p-0.5">
            {(["mine", "all"] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                onClick={() => setView(key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  view === key ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:text-foreground"
                )}
              >
                {key === "mine" ? t.viewMine : t.viewAll}
              </button>
            ))}
          </div>
        )}
      </div>

      <div id="meetings-panel" role="tabpanel" aria-labelledby={`meetings-tab-${tab}`}>
        {error ? (
          <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-border p-8 text-center" data-testid="meetings-error">
            <AlertCircle className="h-6 w-6 text-danger" aria-hidden="true" />
            <p className="text-sm text-foreground">{error}</p>
            <Button type="button" variant="outline" onClick={() => void load()}>
              {t.retry}
            </Button>
          </div>
        ) : items === null ? (
          <div className="space-y-3" role="status" aria-busy="true" data-testid="meetings-skeleton">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={CalendarX2}
            title={tab === "upcoming" ? t.emptyUpcomingTitle : t.emptyPastTitle}
            description={tab === "upcoming" ? t.emptyUpcomingBody : t.emptyPastBody}
          />
        ) : (
          <ul className="space-y-3" data-testid="meetings-list">
            {items.map((m) => {
              const inWindow = m.status === "SCHEDULED" && isInJoinWindow(m.startsAt, m.endsAt, now);
              const active = m.status === "SCHEDULED" && m.phase !== "ended" && m.phase !== "cancelled";
              // Hizmete bağlı (AI İş 3) toplantı: düzenle/iptal/bağlantı Hizmet Masası'ndadır; burada yalnızca ev sahibine "Katıl".
              const serviceNumber = m.serviceConsultation?.consultationNumber ?? null;
              const linked = Boolean(m.serviceConsultation);
              const cancellable = active && !linked;
              const editable = cancellable && view === "mine";
              const istanbul = formatMeetingIstanbul(m.startsAt, lang);
              const hostName = m.hostName ?? m.host?.name ?? null;
              return (
                <li key={m.id} className="rounded-xl border border-border bg-surface p-4" data-testid="meeting-row" data-phase={m.phase}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <h2 className="truncate text-base font-semibold text-foreground">
                        <bdi>{m.title}</bdi>
                      </h2>
                      <p className="text-sm text-foreground/70">
                        <time dateTime={m.startsAt}>{formatMeetingWhen(m.startsAt, lang)}</time>
                        {istanbul && <span className="text-foreground/50"> · {istanbul} (Istanbul)</span>}
                        <span> · {fmt(t.durationMinutes, { minutes: m.durationMin })}</span>
                      </p>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/60">
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" aria-hidden="true" />
                          {fmt(t.capacityLine, { count: m.maxParticipants })}
                        </span>
                        {linked && (
                          <span data-testid="meeting-service-badge">
                            <Badge tone="primary">{fmt(t.serviceConsultationBadge, { number: serviceNumber ?? "" })}</Badge>
                          </span>
                        )}
                        {view === "all" && hostName && (
                          <span>
                            <bdi>{fmt(t.hostedByLine, { name: hostName })}</bdi>
                          </span>
                        )}
                      </p>
                      {view === "mine" && m.note && <p className="text-xs text-foreground/60"><bdi>{m.note}</bdi></p>}
                    </div>
                    <Badge tone={PHASE_TONE[m.phase]}>
                      {m.phase === "upcoming" ? t.phaseUpcoming : m.phase === "open" ? t.phaseOpen : m.phase === "ended" ? t.phaseEnded : t.phaseCancelled}
                    </Badge>
                  </div>

                  {linked && active && (
                    <p className="mt-2 text-xs text-foreground/60" data-testid="meeting-service-note">
                      {t.serviceManagedNote}
                    </p>
                  )}
                  {active && (
                    <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={fmt(t.actionsFor, { title: m.title })}>
                      {view === "mine" &&
                        (inWindow ? (
                          <a href={joinHref(m.id)} className={buttonVariants({ size: "sm" })} data-testid="meeting-join">
                            <Video aria-hidden="true" />
                            {t.actionJoin}
                          </a>
                        ) : (
                          <Button type="button" size="sm" disabled title={fmt(t.joinAvailableAt, { time: formatMeetingWhen(new Date(new Date(m.startsAt).getTime() - 15 * 60_000).toISOString(), lang) })} data-testid="meeting-join-disabled">
                            <Video aria-hidden="true" />
                            {t.actionJoin}
                          </Button>
                        ))}
                      {view === "mine" && !linked && (
                        <Button type="button" size="sm" variant="outline" aria-label={`${t.actionNewLink}: ${m.title}`} onClick={() => setPendingRegen(m)} data-testid="meeting-new-link">
                          <Link2 aria-hidden="true" />
                          {t.actionNewLink}
                        </Button>
                      )}
                      {editable && (
                        <Button type="button" size="sm" variant="outline" aria-label={`${t.actionEdit}: ${m.title}`} onClick={() => { setEditing(m); setFormOpen(true); }} data-testid="meeting-edit">
                          <Pencil aria-hidden="true" />
                          {t.actionEdit}
                        </Button>
                      )}
                      {cancellable && (
                        <Button type="button" size="sm" variant="destructive" aria-label={`${t.actionCancel}: ${m.title}`} onClick={() => setPendingCancel(m)} data-testid="meeting-cancel">
                          <XCircle aria-hidden="true" />
                          {t.actionCancel}
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {cursor && items && items.length > 0 && (
          <div className="mt-4 flex justify-center">
            <Button type="button" variant="outline" loading={loadingMore} onClick={() => void loadMore()}>
              {t.loadMore}
            </Button>
          </div>
        )}
      </div>

      <MeetingFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        meeting={editing}
        onSaved={handleSaved}
      />

      <Dialog open={linkState !== null} onOpenChange={(open) => { if (!open) setLinkState(null); }}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto sm:max-w-lg">
          <DialogHeader className="sr-only">
            <DialogTitle>{linkState?.heading === "regenerated" ? t.linkCardTitleRegenerated : t.linkCardTitleCreated}</DialogTitle>
            <DialogDescription>{t.linkOnceWarning}</DialogDescription>
          </DialogHeader>
          {linkState && <MeetingLinkCard meeting={linkState.meeting} link={linkState.link} heading={linkState.heading} locale={linkState.locale} onDone={() => setLinkState(null)} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingRegen !== null}
        onOpenChange={(open) => { if (!open) setPendingRegen(null); }}
        title={t.regenTitle}
        description={t.regenBody}
        confirmText={t.regenConfirm}
        cancelText={t.dialogCancel}
        tone="warning"
        loading={regenLoading}
        onConfirm={() => void confirmRegen()}
      />
      <ConfirmDialog
        open={pendingCancel !== null}
        onOpenChange={(open) => { if (!open) setPendingCancel(null); }}
        title={t.cancelTitle}
        description={t.cancelBody}
        confirmText={t.cancelConfirm}
        cancelText={t.cancelKeep}
        tone="danger"
        loading={cancelLoading}
        onConfirm={() => void confirmCancel()}
      />
    </div>
  );
}

/** Yetkisi olmayan kullanıcıya (ör. menüsü gizli ama adresi bilen) sunucu 403 vermeden önce anlaşılır bir mesaj gösterir. */
export function MeetingsManager({ variant }: { variant: "admin" | "doctor" }) {
  const { t } = useMeetingStrings();
  const auth = useAuthOptional();
  const user = auth?.user ?? null;
  const allowed = user === null || user.role === "ADMIN" || user.canHostMeetings === true;
  if (!allowed) {
    return (
      <Alert variant="warning">
        <span data-testid="meetings-forbidden">{t.errForbidden}</span>
      </Alert>
    );
  }
  return <MeetingsManagerInner variant={variant} />;
}
