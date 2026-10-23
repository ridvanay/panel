"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Stethoscope } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { DoctorHeroSettings, Media } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { MediaSelectField } from "@/components/admin/media/media-select-field";
import { DOCTOR_HERO_DEFAULT_IMAGE, DOCTOR_HERO_DEFAULT_OVERLAY } from "@/components/site/telehealth/doctor-hero-background";

const OVERLAY_MAX = 80;
/** Bunun altında admin'e kontrast uyarısı gösterilir (aralık spec gereği 0–80 kalır). */
const LOW_CONTRAST_OVERLAY = 40;

/** Ayar yalnızca id + çözümlenmiş url taşır — `MediaSelectField` görüntüleme için `url`/`altText` okur. */
function toMedia(hero: DoctorHeroSettings): Media | null {
  if (!hero.imageMediaId || !hero.imageUrl) return null;
  return {
    id: hero.imageMediaId,
    url: hero.imageUrl,
    altText: null,
    filename: "",
    mimeType: "",
    sizeBytes: 0,
    width: null,
    height: null,
    folderId: null,
    createdAt: "",
  };
}

/**
 * Paket M (2026-10-23) — "Doktor profil başlığı arka planı". Görünüm sayfasında ayrı kart, kendi
 * Kaydet'i: `PATCH /admin/telehealth/settings/doctor-hero`. Görsel YALNIZCA medya kütüphanesinden
 * (dış URL alanı yok). Telehealth modülü kapalıysa (404) kart hiç gösterilmez.
 */
export function DoctorHeroSettingsCard() {
  const [hidden, setHidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [media, setMedia] = useState<Media | null>(null);
  const [overlay, setOverlay] = useState(DOCTOR_HERO_DEFAULT_OVERLAY);
  const [snapshot, setSnapshot] = useState<{ id: string | null; overlay: number }>({ id: null, overlay: DOCTOR_HERO_DEFAULT_OVERLAY });
  const [saving, setSaving] = useState(false);

  function apply(hero: DoctorHeroSettings | undefined) {
    const value = hero ?? { imageMediaId: null, imageUrl: null, overlayOpacity: DOCTOR_HERO_DEFAULT_OVERLAY };
    const m = toMedia(value);
    setMedia(m);
    setOverlay(value.overlayOpacity);
    setSnapshot({ id: m?.id ?? null, overlay: value.overlayOpacity });
  }

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await telehealthApi.getTelehealthThemeSettings();
        if (cancelled) return;
        apply(data.doctorHero);
        setLoadError(null);
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiClientError && (err.status === 404 || err.status === 403)) setHidden(true);
        else setLoadError(friendlyErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (hidden) return null;

  const dirty = (media?.id ?? null) !== snapshot.id || overlay !== snapshot.overlay;
  const previewSrc = media?.url ?? DOCTOR_HERO_DEFAULT_IMAGE;

  async function save(input: { imageMediaId: string | null; overlayOpacity: number }) {
    setSaving(true);
    try {
      const updated = await telehealthApi.updateDoctorHeroSettings(input);
      apply(updated.doctorHero);
      toast.success("Doktor profil başlığı kaydedildi.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4" data-testid="doctor-hero-settings">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Stethoscope className="h-4 w-4" />
        </span>
        <div>
          <h2 className="admin-h2">Doktor profil başlığı arka planı</h2>
          <p className="mt-0.5 admin-text-secondary">
            Doktor sayfalarındaki başlık alanının görseli. Seçilmezse marka renklerinde varsayılan arka plan kullanılır.
          </p>
        </div>
      </div>

      {loadError && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-2">
            {loadError}
            <Button type="button" size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
              Tekrar dene
            </Button>
          </span>
        </Alert>
      )}
      {!loaded && !loadError && <div className="h-40 animate-pulse rounded-lg bg-surface-muted" aria-hidden="true" />}

      {loaded && (
        <>
          <MediaSelectField
            id="doctorHeroImage"
            label="Arka plan görseli"
            value={media}
            onChange={setMedia}
            hint="Yalnızca medya kütüphanesinden. Geniş, yatay bir görsel önerilir (en az 1600×480)."
          />

          <div className="space-y-1.5">
            <label htmlFor="doctorHeroOverlay" className="block text-sm font-medium text-foreground">
              Karartma yoğunluğu (%{overlay})
            </label>
            <input
              type="range"
              id="doctorHeroOverlay"
              min={0}
              max={OVERLAY_MAX}
              value={overlay}
              onChange={(e) => setOverlay(Number(e.target.value))}
              className="w-full accent-primary"
            />
            {overlay < LOW_CONTRAST_OVERLAY ? (
              <p className="text-xs text-warning" role="status">
                Düşük karartmada beyaz metin açık görsellerde okunaksız kalabilir (WCAG AA). %{LOW_CONTRAST_OVERLAY} ve üzeri önerilir.
              </p>
            ) : (
              <p className="text-xs text-foreground/60">Beyaz metnin okunaklı kalması için %{LOW_CONTRAST_OVERLAY} ve üzeri önerilir.</p>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium text-foreground">Önizleme</p>
            <div className="relative isolate h-32 overflow-hidden rounded-lg" data-testid="doctor-hero-preview">
              {/* eslint-disable-next-line @next/next/no-img-element -- admin önizlemesi, optimizasyon gerekmez */}
              <img src={previewSrc} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />
              <div aria-hidden="true" className="absolute inset-0 -z-10 bg-black" style={{ opacity: overlay / 100 }} />
              <div className="flex h-full flex-col justify-center px-5 text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.35)]">
                <span className="text-lg font-semibold">Op. Dr. Örnek Doktor</span>
                <span className="text-sm text-white/85">Genel Cerrahi</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving || (snapshot.id === null && snapshot.overlay === DOCTOR_HERO_DEFAULT_OVERLAY)}
              onClick={() => void save({ imageMediaId: null, overlayOpacity: DOCTOR_HERO_DEFAULT_OVERLAY })}
            >
              Varsayılana dön
            </Button>
            <Button type="button" disabled={!dirty || saving} onClick={() => void save({ imageMediaId: media?.id ?? null, overlayOpacity: overlay })}>
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
