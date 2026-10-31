"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Film, ImageIcon, Info, Pencil, Plus, Trash2 } from "lucide-react";
import * as showcaseApi from "@/lib/api/doctor-showcase";
import * as mediaApi from "@/lib/api/media";
import { MEDIA_CATEGORY_LABELS, requiresPatientConsent, type DoctorMediaCategory, type DoctorMediaKind } from "@/lib/api/doctor-showcase";
import { DEFAULT_MAX_VIDEO_MB, formatDuration, warningsFromVideoInfo } from "@/lib/video-upload";
import { VideoUploadPanel, type VideoUploadValue } from "@/components/admin/telehealth/video-upload-panel";
import { VideoProcessingStatus } from "@/components/admin/telehealth/video-processing-status";
import type { Media } from "@/lib/api/types";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";
import { extractVideoRef } from "@/lib/video-ref";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MediaSelectField } from "@/components/admin/media/media-select-field";
import { ShowcaseLocaleTabs } from "@/components/admin/telehealth/showcase-locale-tabs";

/** İşlenen video varken liste bu aralıkla (ms) kendini yeniler; hepsi bitince durur. */
export const PROCESSING_POLL_MS = 10_000;

export const LARGE_VIDEO_NOTE = "Büyük videoları sunucuya yüklemeyin; YouTube/Vimeo'ya yükleyip bağlantısını girin.";

type LinkProvider = "youtube" | "vimeo";
export type VideoSource = "link" | "upload";

const EMPTY_UPLOAD: VideoUploadValue = { video: null, info: null, poster: null, captions: null, captionsLang: "tr", processing: null };
export const CONSENT_REQUIRED_NOTE = "Hastanın göründüğü içerik, hastadan yazılı onay alınmadan yayınlanamaz. Önce “Hastadan yazılı onay alındı” kutusunu işaretleyip onay notunu yazın.";

const EMPTY_TEXT: showcaseApi.DoctorMediaText = { title: "", description: "", alt: "" };
const CATEGORIES = Object.keys(MEDIA_CATEGORY_LABELS) as DoctorMediaCategory[];

export interface MediaFormState {
  id: string | null;
  kind: DoctorMediaKind;
  photo: Media | null;
  videoProvider: LinkProvider;
  videoInput: string;
  /** Video kaynağı: YouTube/Vimeo bağlantısı ya da yüklenen MP4. */
  videoSource: VideoSource;
  upload: VideoUploadValue;
  category: DoctorMediaCategory;
  translations: Record<string, showcaseApi.DoctorMediaText>;
  showsPatient: boolean;
  patientConsentConfirmed: boolean;
  consentNote: string;
  isPublished: boolean;
  sortOrder: number;
}

const EMPTY_FORM: MediaFormState = {
  id: null,
  kind: "photo",
  photo: null,
  videoProvider: "youtube",
  videoInput: "",
  videoSource: "link",
  upload: EMPTY_UPLOAD,
  category: "about",
  translations: {},
  showsPatient: false,
  patientConsentConfirmed: false,
  consentNote: "",
  isPublished: false,
  sortOrder: 0,
};

/** Yayın anahtarı yalnızca hasta içeriği değilse ya da yazılı onay işaretliyse açılabilir. */
export function canPublishMedia(form: Pick<MediaFormState, "category" | "showsPatient" | "patientConsentConfirmed">): boolean {
  return !requiresPatientConsent(form) || form.patientConsentConfirmed;
}

function hasText(t: showcaseApi.DoctorMediaText | undefined): boolean {
  return !!t && Object.values(t).some((v) => v.trim());
}

/** Form → API gövdesi. Hata varsa `error` döner (alan eşlemesiyle). */
export function buildMediaInput(form: MediaFormState): { input?: showcaseApi.DoctorMediaInput; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const translations: Record<string, showcaseApi.DoctorMediaText> = {};
  for (const [code, t] of Object.entries(form.translations)) {
    if (hasText(t)) translations[code] = { title: t.title.trim(), description: t.description.trim(), alt: t.alt.trim() };
  }
  let videoProvider: showcaseApi.DoctorMediaInput["videoProvider"] = null;
  let videoId: string | null = null;
  const isUpload = form.kind === "video" && form.videoSource === "upload";
  if (form.kind === "photo") {
    if (!form.photo) errors.mediaId = "Bir görsel seçin.";
    if (!Object.values(translations).some((t) => t.alt)) errors.translations = "Fotoğraf için en az bir dilde alt metin zorunlu.";
  } else if (isUpload) {
    if (!form.upload.video) errors.mediaId = "Bir MP4 ya da MOV video yükleyin.";
    else videoProvider = "upload";
  } else {
    const ref = extractVideoRef(form.videoInput, form.videoProvider);
    if (!ref) errors.videoId = "Geçerli bir YouTube/Vimeo bağlantısı ya da video kimliği girin.";
    else {
      videoProvider = ref.provider;
      videoId = ref.videoId;
    }
  }
  if (form.patientConsentConfirmed && !form.consentNote.trim()) errors.consentNote = "Onayın nasıl alındığını not edin.";
  if (form.isPublished && !canPublishMedia(form)) errors.patientConsentConfirmed = "Hastanın göründüğü içerik onay olmadan yayınlanamaz.";
  if (Object.keys(errors).length > 0) return { errors };
  return {
    errors,
    input: {
      kind: form.kind,
      mediaId: form.kind === "photo" ? form.photo?.id ?? null : isUpload ? form.upload.video?.id ?? null : null,
      videoProvider,
      videoId,
      ...(isUpload
        ? {
            posterMediaId: form.upload.poster?.id ?? null,
            captionsMediaId: form.upload.captions?.id ?? null,
            captionsLang: form.upload.captions ? form.upload.captionsLang : null,
          }
        : {}),
      category: form.category,
      translations,
      showsPatient: form.showsPatient,
      patientConsentConfirmed: form.patientConsentConfirmed,
      consentNote: form.patientConsentConfirmed ? form.consentNote.trim() : null,
      isPublished: form.isPublished,
      sortOrder: form.sortOrder,
    },
  };
}

function itemTitle(m: showcaseApi.AdminDoctorMedia): string {
  const t = m.translations.tr ?? m.translations.en ?? Object.values(m.translations).find(hasText);
  return t?.title || t?.alt || (m.kind === "video" ? (m.videoProvider === "upload" ? `Video (${m.media?.filename ?? "MP4"})` : `Video (${m.videoId ?? "?"})`) : m.media?.filename || "Fotoğraf");
}

/** Paket Y — "Foto ve videolar" yöneticisi. Hasta görünen içerik onaysız yayınlanamaz (arayüz + sunucu 422). */
export function DoctorMediaManager({ doctorId }: { doctorId: string }) {
  const [items, setItems] = useState<showcaseApi.AdminDoctorMedia[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<MediaFormState | null>(null);
  const [locale, setLocale] = useState<string>("tr");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<showcaseApi.AdminDoctorMedia | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [maxVideoMb, setMaxVideoMb] = useState(DEFAULT_MAX_VIDEO_MB);
  const [queuePositions, setQueuePositions] = useState<Record<string, number | null>>({});
  const [retryingId, setRetryingId] = useState<string | null>(null);

  useEffect(() => {
    // Ayar okunamazsa varsayılan (100 MB) ile devam edilir; sunucu yine son karar verir.
    showcaseApi
      .getDoctorMediaSettings()
      .then((s) => {
        if (s?.maxVideoUploadMb) setMaxVideoMb(s.maxVideoUploadMb);
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setItems(await showcaseApi.listDoctorMedia(doctorId));
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, [doctorId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  // İşlenen (dönüştürülen) video varsa liste + kuyruk sırası 10 sn'de bir yenilenir; hepsi bitince durur.
  const hasProcessing = !!items?.some((m) => m.processing?.status === "processing");
  useEffect(() => {
    if (!hasProcessing) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const jobs = await mediaApi.listTranscodeJobs();
        if (!cancelled) setQueuePositions(Object.fromEntries(jobs.map((j) => [j.mediaId, j.queuePosition])));
      } catch {
        // Sıra bilgisi yardımcıdır; alınamazsa rozet sırasız gösterilir.
      }
      if (!cancelled) await load();
    };
    void refresh();
    const timer = setInterval(() => void refresh(), PROCESSING_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [hasProcessing, load]);

  async function retryTranscode(m: showcaseApi.AdminDoctorMedia) {
    if (!m.media) return;
    setRetryingId(m.id);
    try {
      await mediaApi.retryTranscode(m.media.id);
      toast.success("Video yeniden kuyruğa alındı.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setRetryingId(null);
      await load();
    }
  }

  function openNew() {
    setForm({ ...EMPTY_FORM, sortOrder: items?.length ?? 0 });
    setLocale("tr");
    setFormError(null);
    setFieldErrors({});
  }

  function openEdit(m: showcaseApi.AdminDoctorMedia) {
    setForm({
      id: m.id,
      kind: m.kind,
      photo: m.media ? ({ id: m.media.id, url: m.media.url, filename: m.media.filename, width: m.media.width, height: m.media.height, altText: null } as unknown as Media) : null,
      videoProvider: m.videoProvider === "vimeo" ? "vimeo" : "youtube",
      videoInput: m.videoId ?? "",
      videoSource: m.videoProvider === "upload" ? "upload" : "link",
      upload:
        m.videoProvider === "upload"
          ? {
              video: m.media ? ({ altText: null, sizeBytes: 0, mimeType: "video/mp4", folderId: null, createdAt: m.createdAt, ...m.media } as unknown as Media) : null,
              info: m.video ?? null,
              processing: m.processing ?? null,
              poster: m.thumbnailMediaId && m.thumbnailUrl ? ({ id: m.thumbnailMediaId, url: m.thumbnailUrl, filename: "poster", mimeType: "image/jpeg", sizeBytes: 0, altText: null, width: null, height: null, folderId: null, createdAt: m.createdAt } as Media) : null,
              captions: m.captionsMediaId ? ({ id: m.captionsMediaId, url: m.captionsUrl ?? "", filename: "altyazi.vtt", mimeType: "text/vtt", sizeBytes: 0, altText: null, width: null, height: null, folderId: null, createdAt: m.createdAt } as Media) : null,
              captionsLang: m.captionsLang ?? "tr",
            }
          : EMPTY_UPLOAD,
      category: m.category,
      translations: { ...m.translations },
      showsPatient: m.showsPatient,
      patientConsentConfirmed: m.patientConsentConfirmed,
      consentNote: m.consentNote ?? "",
      isPublished: m.isPublished,
      sortOrder: m.sortOrder,
    });
    setLocale("tr");
    setFormError(null);
    setFieldErrors({});
  }

  function patch(change: Partial<MediaFormState>) {
    setForm((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...change };
      // Onay geri alınır ya da hasta içeriği olursa yayın anahtarı kendiliğinden kapanır.
      if (!canPublishMedia(next)) next.isPublished = false;
      return next;
    });
  }

  function setText(key: keyof showcaseApi.DoctorMediaText, value: string) {
    setForm((prev) => (prev ? { ...prev, translations: { ...prev.translations, [locale]: { ...(prev.translations[locale] ?? EMPTY_TEXT), [key]: value } } } : prev));
  }

  async function save() {
    if (!form) return;
    setFormError(null);
    const built = buildMediaInput(form);
    setFieldErrors(built.errors);
    if (!built.input) {
      setFormError("Formdaki hataları düzeltin.");
      return;
    }
    setSaving(true);
    try {
      if (form.id) await showcaseApi.updateDoctorMedia(doctorId, form.id, built.input);
      else await showcaseApi.createDoctorMedia(doctorId, built.input);
      toast.success("Medya öğesi kaydedildi.");
      setForm(null);
      await load();
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setFormError(message);
      // Sunucu 422'si (ör. onaysız hasta içeriği) ilgili alana bağlanır.
      setFieldErrors(fieldErrorsFrom(err));
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await showcaseApi.deleteDoctorMedia(doctorId, pendingDelete.id);
      toast.success("Medya öğesi silindi.");
      setPendingDelete(null);
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  const current = form?.translations[locale] ?? EMPTY_TEXT;
  const videoRef = form && form.kind === "video" && form.videoSource === "link" ? extractVideoRef(form.videoInput, form.videoProvider) : null;
  const publishLocked = form ? !canPublishMedia(form) : false;

  return (
    <Card className="space-y-4" data-testid="doctor-media-manager">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="admin-h2">Foto ve videolar</h2>
          <p className="mt-0.5 admin-text-secondary">Profilde “Fotoğraflar ve videolar” galerisinde gösterilir.</p>
        </div>
        {!form && (
          <Button type="button" variant="outline" size="sm" onClick={openNew}>
            <Plus className="h-4 w-4" />
            Medya ekle
          </Button>
        )}
      </div>

      <Alert variant="info">
        <span className="flex items-center gap-2">
          <Info className="h-4 w-4 shrink-0" />
          {LARGE_VIDEO_NOTE}
        </span>
      </Alert>

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

      {!loadError && items === null && (
        <div className="flex justify-center py-6">
          <Spinner className="h-5 w-5 text-primary" />
        </div>
      )}

      {items && items.length === 0 && !form && <p className="text-sm text-foreground/60">Henüz foto ya da video eklenmedi.</p>}

      {items && items.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                {m.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- admin küçük resmi, harici/yerel medya URL'si
                  <img src={m.thumbnailUrl} alt="" loading="lazy" className="h-10 w-14 shrink-0 rounded object-cover" />
                ) : m.kind === "video" ? (
                  <Film className="h-4 w-4 shrink-0 text-foreground/50" aria-hidden="true" />
                ) : (
                  <ImageIcon className="h-4 w-4 shrink-0 text-foreground/50" aria-hidden="true" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{itemTitle(m)}</p>
                  <p className="text-xs text-foreground/60">
                    {MEDIA_CATEGORY_LABELS[m.category]} · Sıra {m.sortOrder}
                    {requiresPatientConsent(m) ? (m.patientConsentConfirmed ? " · Hasta onayı var" : " · Hasta onayı YOK") : ""}
                    {m.videoProvider === "upload" && m.video ? ` · ${formatDuration(m.video.durationSec)}` : ""}
                  </p>
                  {m.videoProvider === "upload" && (
                    <p className="mt-0.5 flex flex-wrap items-center gap-1">
                      <Badge tone="neutral" size="sm">
                        MP4{m.video?.codec ? ` · ${m.video.codec}` : ""}
                      </Badge>
                      {(m.processing ? [] : warningsFromVideoInfo(m.video ?? null)).map((w) => (
                        <span key={w.code} title={w.message}>
                          <Badge tone="warning" size="sm">
                            {w.code === "HEVC_CODEC" ? "HEVC uyarısı" : "Optimize değil"}
                          </Badge>
                        </span>
                      ))}
                    </p>
                  )}
                  {m.videoProvider === "upload" && m.processing && (
                    <VideoProcessingStatus
                      processing={m.processing}
                      queuePosition={m.media ? queuePositions[m.media.id] : null}
                      retrying={retryingId === m.id}
                      onRetry={() => void retryTranscode(m)}
                    />
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={m.isPublished ? "success" : "neutral"}>{m.isPublished ? "Yayında" : "Taslak"}</Badge>
                <Button type="button" variant="ghost" size="sm" aria-label={`${itemTitle(m)} öğesini düzenle`} onClick={() => openEdit(m)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" aria-label={`${itemTitle(m)} öğesini sil`} onClick={() => setPendingDelete(m)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {form && (
        <div className="space-y-4 rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold text-foreground">{form.id ? "Medya öğesini düzenle" : "Yeni medya öğesi"}</h3>
          {formError && (
            <Alert variant="error">
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {formError}
              </span>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="media-kind" label="Tür" required>
              {(inputProps) => (
                <Select {...inputProps} value={form.kind} onChange={(e) => patch({ kind: e.target.value as DoctorMediaKind })}>
                  <option value="photo">Fotoğraf</option>
                  <option value="video">Video</option>
                </Select>
              )}
            </Field>
            <Field id="media-category" label="Kategori" required>
              {(inputProps) => (
                <Select {...inputProps} value={form.category} onChange={(e) => patch({ category: e.target.value as DoctorMediaCategory })}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {MEDIA_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          {form.kind === "photo" ? (
            <div className="space-y-1">
              <MediaSelectField id="doctor-media-photo" label="Görsel" required value={form.photo} onChange={(photo) => patch({ photo })} />
              {fieldErrors.mediaId && (
                <p role="alert" className="text-xs text-danger">
                  {fieldErrors.mediaId}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <Field id="media-video-source" label="Video kaynağı">
                {(inputProps) => (
                  <Select {...inputProps} value={form.videoSource} onChange={(e) => patch({ videoSource: e.target.value as VideoSource })}>
                    <option value="link">YouTube/Vimeo bağlantısı</option>
                    <option value="upload">Video yükle (MP4 ya da MOV)</option>
                  </Select>
                )}
              </Field>
              {form.videoSource === "upload" ? (
                <VideoUploadPanel
                  value={form.upload}
                  onChange={(change) => setForm((prev) => (prev ? { ...prev, upload: { ...prev.upload, ...change } } : prev))}
                  maxVideoMb={maxVideoMb}
                  error={fieldErrors.mediaId}
                />
              ) : (
              <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
                <Field id="media-video-provider" label="Sağlayıcı">
                  {(inputProps) => (
                    <Select {...inputProps} value={videoRef?.provider ?? form.videoProvider} onChange={(e) => patch({ videoProvider: e.target.value as LinkProvider })}>
                      <option value="youtube">YouTube</option>
                      <option value="vimeo">Vimeo</option>
                    </Select>
                  )}
                </Field>
                <Field
                  id="media-video-input"
                  label="Video bağlantısı ya da kimliği"
                  required
                  error={fieldErrors.videoId}
                  hint={videoRef ? `Algılanan: ${videoRef.provider === "youtube" ? "YouTube" : "Vimeo"} · kimlik ${videoRef.videoId}` : "Örn. https://youtu.be/XXXXXXXXXXX ya da https://vimeo.com/123456789"}
                >
                  {(inputProps) => <Input {...inputProps} value={form.videoInput} onChange={(e) => patch({ videoInput: e.target.value })} />}
                </Field>
              </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <ShowcaseLocaleTabs value={locale} onChange={setLocale} filled={(c) => hasText(form.translations[c])} label="Medya metni dili" />
            <div className="space-y-3" role="tabpanel" aria-label={`Medya metni (${locale.toUpperCase()})`} dir={locale === "ar" ? "rtl" : undefined}>
              <Field id={`media-title-${locale}`} label="Başlık">
                {(inputProps) => <Input {...inputProps} maxLength={160} value={current.title} onChange={(e) => setText("title", e.target.value)} />}
              </Field>
              <Field id={`media-description-${locale}`} label="Açıklama">
                {(inputProps) => <Textarea {...inputProps} rows={3} maxLength={1000} value={current.description} onChange={(e) => setText("description", e.target.value)} />}
              </Field>
              <Field
                id={`media-alt-${locale}`}
                label={form.kind === "photo" ? "Alt metin (görsel açıklaması)" : "Alt metin (opsiyonel)"}
                required={form.kind === "photo"}
                error={fieldErrors.translations}
                hint={form.kind === "photo" ? "Fotoğraf için en az bir dilde zorunlu; ekran okuyucular bunu okur." : undefined}
              >
                {(inputProps) => <Input {...inputProps} maxLength={200} value={current.alt} onChange={(e) => setText("alt", e.target.value)} />}
              </Field>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm">
                <span className="font-medium text-foreground">Hastanın göründüğü içerik</span>
                <span className="block text-xs text-foreground/60">Hasta tanınabiliyorsa açın. “Önce / sonra” kategorisi her zaman hasta içeriği sayılır.</span>
              </span>
              <Switch checked={form.showsPatient || form.category === "before-after"} disabled={form.category === "before-after"} onCheckedChange={(checked: boolean) => patch({ showsPatient: checked })} aria-label="Hastanın göründüğü içerik" />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={form.patientConsentConfirmed} onChange={(e) => patch({ patientConsentConfirmed: e.target.checked })} />
              <span>
                <span className="font-medium text-foreground">Hastadan yazılı onay alındı</span>
                <span className="block text-xs text-foreground/60">Hasta içeriğinin yayını için zorunludur.</span>
              </span>
            </label>
            {form.patientConsentConfirmed && (
              <Field id="media-consent-note" label="Onay notu" required error={fieldErrors.consentNote} hint="Onayın nasıl ve ne zaman alındığını yazın (belge no, tarih vb.). Kişisel veri yazmayın.">
                {(inputProps) => <Textarea {...inputProps} rows={2} maxLength={1000} value={form.consentNote} onChange={(e) => patch({ consentNote: e.target.value })} />}
              </Field>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="media-sort" label="Sıra" hint="Küçük sayı önce gösterilir.">
              {(inputProps) => <Input {...inputProps} type="number" min={0} max={100000} className="w-28" value={form.sortOrder} onChange={(e) => patch({ sortOrder: Math.max(0, Number(e.target.value) || 0) })} />}
            </Field>
            <div>
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                <span className="text-sm font-medium text-foreground">Yayında</span>
                <Switch checked={form.isPublished} disabled={publishLocked} onCheckedChange={(checked: boolean) => patch({ isPublished: checked })} aria-label="Medya yayında" aria-describedby={publishLocked ? "media-publish-lock" : undefined} />
              </div>
              {publishLocked && (
                <p id="media-publish-lock" className="mt-1 text-xs text-warning">
                  {CONSENT_REQUIRED_NOTE}
                </p>
              )}
              {fieldErrors.patientConsentConfirmed && (
                <p role="alert" className="mt-1 text-xs text-danger">
                  {fieldErrors.patientConsentConfirmed}
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setForm(null)}>
              Vazgeç
            </Button>
            <Button type="button" loading={saving} onClick={() => void save()}>
              Kaydet
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Medya öğesi silinsin mi?"
        description={pendingDelete ? `“${itemTitle(pendingDelete)}” galeriden kalıcı olarak kaldırılır (medya kütüphanesindeki dosya silinmez).` : undefined}
        confirmText="Sil"
        tone="danger"
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </Card>
  );
}
