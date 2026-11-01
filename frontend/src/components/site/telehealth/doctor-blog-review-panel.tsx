"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BadgeCheck, ClipboardCheck, MessageSquareWarning } from "lucide-react";
import { toast } from "sonner";
import * as blogApi from "@/lib/api/blog";
import type { DoctorBlogReviewItem } from "@/lib/api/types";
import { useBlogStrings } from "@/lib/i18n/use-blog-strings";
import { useFriendlyError, usePortalStrings } from "@/lib/i18n/use-portal-strings";
import { fillBlogString } from "@/lib/blog/format";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const REVIEW_NOTE_MAX = 2000;

/** Not doğrulaması (saf): 1..2000 karakter (kırpılmış). `null` = geçerli. */
export function validateReviewNote(note: string): "required" | "tooLong" | null {
  const trimmed = note.trim();
  if (trimmed.length === 0) return "required";
  if (trimmed.length > REVIEW_NOTE_MAX) return "tooLong";
  return null;
}

/**
 * Paket Z1 — doktor paneli "Medical review" kuyruğu (`/doctor/blog-review`). YALNIZCA bu liste: atanan yazılar,
 * önizleme, "Approve" ve "Request changes" (not zorunlu, 1..2000). Doktor portalının diğer ekranlarına dokunmaz.
 * Loading (skeleton), error (yeniden dene) ve empty durumları ayrı ayrı ele alınır.
 */
export function DoctorBlogReviewPanel() {
  const t = useBlogStrings();
  const { intlLocale } = usePortalStrings();
  const friendly = useFriendlyError();
  const [items, setItems] = useState<DoctorBlogReviewItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setItems(null);
    try {
      setItems(await blogApi.listDoctorBlogReviews());
    } catch (err) {
      setLoadError(friendly(err) || t.reviewLoadError);
    }
  }, [friendly, t.reviewLoadError]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const remove = (id: string) => setItems((prev) => (prev ? prev.filter((item) => item.id !== id) : prev));
  const formatDate = (iso: string) => new Date(iso).toLocaleDateString(intlLocale);

  return (
    <div className="space-y-4" data-testid="doctor-blog-review">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t.reviewTitle}</h1>
        <p className="mt-1 text-sm text-foreground/60">{t.reviewIntro}</p>
      </div>

      {loadError ? (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {loadError}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              {t.reviewRetry}
            </Button>
          </span>
        </Alert>
      ) : items === null ? (
        <div className="space-y-3" aria-hidden="true" data-testid="doctor-blog-review-skeleton">
          <Skeleton className="h-28 w-full rounded-[var(--site-radius)]" />
          <Skeleton className="h-28 w-full rounded-[var(--site-radius)]" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[var(--site-radius)] border border-dashed border-border p-10 text-center" data-testid="doctor-blog-review-empty">
          <ClipboardCheck className="h-8 w-8 text-foreground/40" aria-hidden="true" />
          <p className="text-sm text-foreground/70">{t.reviewEmpty}</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <ReviewCard key={item.id} item={item} t={t} formatDate={formatDate} friendly={friendly} onDone={remove} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewCard({
  item,
  t,
  formatDate,
  friendly,
  onDone,
}: {
  item: DoctorBlogReviewItem;
  t: ReturnType<typeof useBlogStrings>;
  formatDate: (iso: string) => string;
  friendly: (err: unknown) => string;
  onDone: (id: string) => void;
}) {
  const [preview, setPreview] = useState(false);
  const [composing, setComposing] = useState(false);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"approve" | "changes" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const noteId = `review-note-${item.id}`;

  async function approve() {
    setBusy("approve");
    setActionError(null);
    try {
      await blogApi.approveDoctorBlogReview(item.id);
      toast.success(t.reviewApproved);
      onDone(item.id);
    } catch (err) {
      setActionError(friendly(err) || t.reviewActionError);
    } finally {
      setBusy(null);
    }
  }

  async function sendChanges() {
    const problem = validateReviewNote(note);
    if (problem) {
      setNoteError(problem === "required" ? t.reviewNoteRequired : t.reviewNoteTooLong);
      return;
    }
    setNoteError(null);
    setBusy("changes");
    setActionError(null);
    try {
      await blogApi.requestDoctorBlogChanges(item.id, note.trim());
      toast.success(t.reviewChangesSent);
      onDone(item.id);
    } catch (err) {
      setActionError(friendly(err) || t.reviewActionError);
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="rounded-[var(--site-radius)] border border-border bg-surface p-5" data-testid="doctor-blog-review-item">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-semibold text-foreground">{item.title}</h2>
          <p className="mt-1 text-xs text-foreground/60">
            {item.category ? `${item.category.name} · ` : ""}
            {fillBlogString(t.reviewUpdated, { date: formatDate(item.updatedAt) })}
            {item.readingMinutes ? ` · ${fillBlogString(t.minRead, { n: item.readingMinutes })}` : ""}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
            item.medicalReviewStatus === "changes_requested" ? "bg-warning/10 text-warning" : "bg-[var(--site-primary)]/10 text-[var(--site-primary)]"
          )}
        >
          {item.medicalReviewStatus === "changes_requested" ? <MessageSquareWarning className="h-3.5 w-3.5" aria-hidden="true" /> : <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />}
          {item.medicalReviewStatus === "changes_requested" ? t.reviewStatusChanges : t.reviewStatusPending}
        </span>
      </div>

      {item.excerpt ? <p className="mt-3 text-sm text-foreground/70">{item.excerpt}</p> : null}

      {item.medicalReviewStatus === "changes_requested" && item.medicalReviewNote ? (
        <div className="mt-3 rounded-md bg-warning/5 p-3 text-sm text-foreground/80">
          <p className="text-xs font-medium text-warning">{t.reviewPreviousNote}</p>
          <p className="mt-1 whitespace-pre-line">{item.medicalReviewNote}</p>
        </div>
      ) : null}

      <div className="mt-4">
        <Button type="button" variant="ghost" size="sm" aria-expanded={preview} onClick={() => setPreview((v) => !v)}>
          {preview ? t.reviewHidePreview : t.reviewPreview}
        </Button>
        {preview ? (
          <div className="mt-3 rounded-md border border-border bg-background p-4" data-testid="doctor-blog-review-preview">
            {item.keyTakeaways.length > 0 ? (
              <>
                <p className="text-sm font-semibold text-foreground">{t.keyTakeaways}</p>
                <ul className="mb-4 mt-2 list-disc space-y-1 ps-5 text-sm text-foreground/80">
                  {item.keyTakeaways.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {/* Backend `sanitizeRichHtml`'den geçmiş içerik (herkese açık blogla aynı güven sınırı). */}
            <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: item.contentHtml }} />
          </div>
        ) : null}
      </div>

      {composing ? (
        <div className="mt-4 space-y-2 rounded-md border border-border p-4">
          <label htmlFor={noteId} className="block text-sm font-medium text-foreground">
            {t.reviewNoteLabel}
          </label>
          <textarea
            id={noteId}
            value={note}
            rows={4}
            aria-invalid={noteError ? true : undefined}
            aria-describedby={`${noteId}-hint`}
            onChange={(e) => {
              setNote(e.target.value);
              if (noteError) setNoteError(null);
            }}
            className="w-full rounded-md border border-border bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-primary)]"
          />
          <p id={`${noteId}-hint`} className="text-xs text-foreground/60">
            {t.reviewNoteHint} <span aria-hidden="true">{note.trim().length}/{REVIEW_NOTE_MAX}</span>
          </p>
          {noteError ? (
            <p role="alert" className="text-xs text-danger">
              {noteError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" loading={busy === "changes"} onClick={() => void sendChanges()}>
              {t.reviewSendNote}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => { setComposing(false); setNoteError(null); }}>
              {t.reviewCancel}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" size="sm" loading={busy === "approve"} disabled={busy !== null} onClick={() => void approve()}>
            {t.reviewApprove}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => setComposing(true)}>
            {t.reviewRequestChanges}
          </Button>
        </div>
      )}

      {actionError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {actionError}
        </p>
      ) : null}
    </li>
  );
}
