"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Languages, ShieldAlert } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TwoFactorSetupPanel } from "@/components/site/security/two-factor-setup-panel";
import { useAuthOptional } from "@/context/auth-context";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { useFriendlyError, usePortalStrings } from "@/lib/i18n/use-portal-strings";
import { acceptInterpreterConfidentiality, getInterpreterMe, listInterpreterAssignments } from "@/lib/api/interpreter";
import { ApiClientError } from "@/lib/api/error";
import type { InterpreterAssignment, InterpreterMe } from "@/lib/api/types";

/**
 * Paket AA — tercüman paneli (`/[lang]/interpreter`). Erişim ROLE değil tercüman profiline bağlıdır
 * (Paket AA-ek): ADMIN, hasta ya da doktor da profili varsa paneli kullanır; rolüne ait veri burada
 * gösterilmez. Sırayla: 2FA kurulumu (yalnızca admin ayarı açıksa, satır içi), gizlilik
 * taahhüdü onayı (güncel sürüm), sonra atanmış yaklaşan/geçmiş görüşmeler. Tercüman hasta belgelerini,
 * intake cevaplarını, doktor notlarını, reçeteleri ve kayıtları görmez; hastanın yalnızca baş harfi.
 */
export function InterpreterPanel() {
  const { t, lang, intlLocale } = usePortalStrings();
  const friendlyError = useFriendlyError();
  const localize = useLocalizePath();
  const auth = useAuthOptional();
  const [me, setMe] = useState<InterpreterMe | null>(null);
  const [items, setItems] = useState<InterpreterAssignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [noAccess, setNoAccess] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const profile = await getInterpreterMe();
      setMe(profile);
      const twoFactorOk = !profile.twoFactorRequired || profile.twoFactorEnabled;
      setItems(twoFactorOk && profile.confidentiality.accepted ? await listInterpreterAssignments() : []);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 403) setNoAccess(true);
      else setError(friendlyError(err));
    }
  }, [friendlyError]);

  const status = auth?.status;
  useEffect(() => {
    if (status !== "authenticated") return;
    (async () => {
      await load();
    })();
  }, [status, load]);

  const formatter = useMemo(() => new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short" }), [intlLocale]);
  const istanbulFormatter = useMemo(() => new Intl.DateTimeFormat(intlLocale, { timeStyle: "short", timeZone: "Europe/Istanbul" }), [intlLocale]);

  if (status === "loading" || status === undefined) return <PanelSkeleton />;
  if (status !== "authenticated") return <LoginRedirect next={localize("/interpreter")} />;
  if (noAccess) {
    return (
      <Shell title={t.interpreter.panelTitle}>
        <Alert variant="warning">
          <span data-testid="interpreter-no-access">{t.interpreter.noAccess}</span>
        </Alert>
      </Shell>
    );
  }
  if (error) {
    return (
      <Shell title={t.interpreter.panelTitle}>
        <Alert variant="error">{error}</Alert>
      </Shell>
    );
  }
  if (!me) return <PanelSkeleton />;

  if (me.twoFactorRequired && !me.twoFactorEnabled) {
    return (
      <Shell title={t.interpreter.panelTitle}>
        <div className="mx-auto flex max-w-lg flex-col items-center gap-4 rounded-[var(--site-radius)] border border-warning/30 bg-warning/5 p-8 text-center">
          <ShieldAlert className="h-8 w-8 text-warning" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">{t.interpreter.twoFactorTitle}</p>
          <p className="text-xs text-foreground/60">{t.interpreter.twoFactorDescription}</p>
          <TwoFactorSetupPanel onCompleted={() => void load()} />
        </div>
      </Shell>
    );
  }

  if (!me.confidentiality.accepted) {
    const text = lang === "tr" ? me.confidentiality.textTr : me.confidentiality.textEn;
    return (
      <Shell title={t.interpreter.confidentialityTitle}>
        <p className="text-sm text-foreground/70">{t.interpreter.confidentialityIntro}</p>
        <div
          data-testid="confidentiality-text"
          lang={lang === "tr" ? "tr" : "en"}
          dir="ltr"
          className="max-h-96 overflow-y-auto whitespace-pre-line rounded-[var(--site-radius)] border border-border bg-surface p-4 text-sm leading-relaxed text-foreground"
        >
          {text}
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>{t.interpreter.confidentialityCheckbox}</span>
        </label>
        <Button
          type="button"
          disabled={!agreed}
          loading={accepting}
          onClick={async () => {
            setAccepting(true);
            try {
              await acceptInterpreterConfidentiality(me.confidentiality.version);
              await load();
            } catch (err) {
              setError(friendlyError(err));
            } finally {
              setAccepting(false);
            }
          }}
        >
          {t.interpreter.confidentialityAccept}
        </Button>
      </Shell>
    );
  }

  const upcoming = (items ?? []).filter((a) => !a.past);
  const past = (items ?? []).filter((a) => a.past);

  const renderRow = (a: InterpreterAssignment) => (
    <li key={a.id} data-testid="interpreter-assignment" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--site-radius)] border border-border bg-surface p-4">
      <div className="min-w-0 space-y-0.5 text-sm">
        <p className="font-medium text-foreground">
          {a.startsAt ? formatter.format(new Date(a.startsAt)) : "—"}
          {a.startsAt && (
            <span className="ms-2 text-xs font-normal text-foreground/60">
              ({t.interpreter.istanbulTime}: {istanbulFormatter.format(new Date(a.startsAt))})
            </span>
          )}
        </p>
        <p className="text-foreground/70">
          {t.interpreter.colLanguage}: <bdi>{a.languageName}</bdi> · {t.interpreter.colDoctor}: {a.doctorDisplayName} · {t.interpreter.colPatient}: {a.patientInitial}
        </p>
      </div>
      {a.status === "REMOVED" ? (
        <span className="text-xs text-foreground/60">{t.interpreter.statusRemoved}</span>
      ) : a.canJoin ? (
        <Link
          href={localize(`/interpreter/session/${a.id}`)}
          className="inline-flex min-h-11 items-center rounded-[var(--site-radius)] bg-[var(--site-primary)] px-4 text-sm font-semibold text-white hover:opacity-90"
        >
          {t.interpreter.join}
        </Link>
      ) : (
        <span className="text-xs text-foreground/60">{t.interpreter.notJoinable}</span>
      )}
    </li>
  );

  return (
    <Shell title={t.interpreter.panelTitle} subtitle={t.interpreter.panelSubtitle}>
      {!me.isActive && <Alert variant="warning">{t.interpreter.inactive}</Alert>}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">{t.interpreter.upcomingTitle}</h2>
        {upcoming.length === 0 ? <p className="text-sm text-foreground/60">{t.interpreter.empty}</p> : <ul className="space-y-2">{upcoming.map(renderRow)}</ul>}
      </section>
      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">{t.interpreter.pastTitle}</h2>
          <ul className="space-y-2 opacity-80">{past.map(renderRow)}</ul>
        </section>
      )}
    </Shell>
  );
}

function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-10 sm:px-6">
      <div>
        <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold text-foreground">
          <Languages className="h-6 w-6 text-[var(--site-primary)]" aria-hidden="true" />
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-foreground/60">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/** Oturum yoksa giriş ekranına (dönüş adresiyle). */
function LoginRedirect({ next }: { next: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/login?next=${encodeURIComponent(next)}`);
  }, [router, next]);
  return <PanelSkeleton />;
}

function PanelSkeleton() {
  return (
    <div className="mx-auto max-w-4xl space-y-3 px-4 py-10 sm:px-6">
      <Skeleton className="h-8 w-60" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}
