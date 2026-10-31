"use client";

import { useEffect, useState } from "react";
import { Link2Off } from "lucide-react";
import * as reviewsApi from "@/lib/api/reviews";
import { ApiClientError } from "@/lib/api/error";
import { useReviewStrings } from "@/lib/i18n/use-review-strings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ReviewForm } from "@/components/site/reviews/review-form";

type InviteState = { kind: "loading" } | { kind: "ready"; doctorName: string } | { kind: "invalid" } | { kind: "error" };

/** Paket Y — `/[lang]/review/[token]`: davet bilgisini çeker (yükleme/404/hata durumları) ve formu gösterir. */
export function ReviewInviteView({ token, optOut = false }: { token: string; optOut?: boolean }) {
  if (optOut) return <ReviewOptOut token={token} />;
  return <ReviewInviteForm token={token} />;
}

/** `?optout=1` — "Bir daha yorum isteği almak istemiyorum" onay ekranı (token geçersiz olsa da sunucu 204 döner). */
function ReviewOptOut({ token }: { token: string }) {
  const { t } = useReviewStrings();
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");

  async function confirm() {
    setStatus("submitting");
    try {
      await reviewsApi.optOutReviewInvite(token);
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  if (status === "done") return <Alert variant="success">{t.optOutDone}</Alert>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-foreground">{t.optOutTitle}</h1>
      <p className="text-sm text-foreground/70">{t.optOutBody}</p>
      {status === "error" && <Alert variant="error">{t.errGeneric}</Alert>}
      <Button type="button" loading={status === "submitting"} disabled={status === "submitting"} onClick={() => void confirm()}>
        {t.optOutConfirm}
      </Button>
    </div>
  );
}

function ReviewInviteForm({ token }: { token: string }) {
  const { t } = useReviewStrings();
  const [state, setState] = useState<InviteState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    reviewsApi
      .getReviewInvite(token)
      .then((info) => !cancelled && setState({ kind: "ready", doctorName: info.doctorName }))
      .catch((err) => {
        if (cancelled) return;
        setState(err instanceof ApiClientError && err.status === 404 ? { kind: "invalid" } : { kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.kind === "loading") {
    return (
      <div role="status" aria-label={t.inviteLoading} className="space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (state.kind === "invalid") return <InvalidInvite />;
  if (state.kind === "error") return <Alert variant="error">{t.errGeneric}</Alert>;

  return <ReviewForm doctorName={state.doctorName} submit={(input) => reviewsApi.submitReviewInvite(token, input)} onInvalid={() => setState({ kind: "invalid" })} />;
}

function InvalidInvite() {
  const { t } = useReviewStrings();
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-[var(--site-radius)] border border-border bg-muted/30 p-10 text-center">
      <Link2Off className="h-8 w-8 text-foreground/40" aria-hidden="true" />
      <h1 className="text-lg font-semibold text-foreground">{t.inviteNotFoundTitle}</h1>
      <p className="text-sm text-foreground/60">{t.inviteNotFoundBody}</p>
    </div>
  );
}
