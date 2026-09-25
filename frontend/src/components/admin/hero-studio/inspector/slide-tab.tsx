"use client";

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MediaSelectField } from "@/components/admin/media/media-select-field";
import type { Media } from "@/lib/api/types";
import type { DeviceMode } from "@/lib/page-builder/types";
import type { Slide, SlideBackgroundType } from "@/lib/sliders/types";
import { resolveSlideBackgrounds } from "@/components/site/advanced-slider/background";
import { FocalPointPicker } from "./focal-point-picker";

const DEVICE_LABEL: Record<DeviceMode, string> = { desktop: "Masaüstü", tablet: "Tablet", mobile: "Mobil" };

/** Düz karartma açılırken opaklık 0 ise makul bir başlangıç değeri. */
const DEFAULT_OVERLAY_OPACITY = 40;

/**
 * Slayt ayarları. Arka plan görselinin cihaza göre seçimi ve odak noktası cihazdan bağımsız
 * listelenir; odak noktası üst çubukta SEÇİLİ CİHAZ için düzenlenir (tablet/mobil boşsa bir üst
 * cihazın değeri geçerlidir — `background.ts::resolveSlideBackgrounds` ile AYNI yedek zinciri).
 */
export function SlideInspectorTab({ slide, device, onUpdate }: { slide: Slide; device: DeviceMode; onUpdate: (patch: Partial<Slide>) => void }) {
  const backgrounds = resolveSlideBackgrounds(slide);
  const current = backgrounds[device];
  const overlayOn = slide.bgOverlayOpacity > 0;
  const focalOverridden = device === "tablet" ? slide.bgTabletPositionX !== null : device === "mobile" ? slide.bgMobilePositionX !== null : false;

  function setFocal(x: number, y: number) {
    if (device === "tablet") onUpdate({ bgTabletPositionX: x, bgTabletPositionY: y });
    else if (device === "mobile") onUpdate({ bgMobilePositionX: x, bgMobilePositionY: y });
    else onUpdate({ bgPositionX: x, bgPositionY: y });
  }

  function resetFocal() {
    if (device === "tablet") onUpdate({ bgTabletPositionX: null, bgTabletPositionY: null });
    if (device === "mobile") onUpdate({ bgMobilePositionX: null, bgMobilePositionY: null });
  }

  return (
    <div className="space-y-4">
      <Field id="slide-label" label="Panel içi etiket" hint="Yalnızca slayt şeridinde görünür, public sitede render edilmez.">
        {(inputProps) => <Input {...inputProps} value={slide.label ?? ""} onChange={(e) => onUpdate({ label: e.target.value || null })} />}
      </Field>

      <Field id="slide-bgType" label="Arka plan türü">
        {(inputProps) => (
          <Select {...inputProps} value={slide.bgType} onChange={(e) => onUpdate({ bgType: e.target.value as SlideBackgroundType })}>
            <option value="gradient">Renk geçişi</option>
            <option value="image">Görsel</option>
            <option value="video">Video</option>
          </Select>
        )}
      </Field>

      {slide.bgType === "image" && (
        <>
          <MediaSelectField id="slide-bgMedia" label="Masaüstü görseli" value={slide.bgMedia} onChange={(media: Media | null) => onUpdate({ bgMedia: media })} required />
          <MediaSelectField
            id="slide-bgTabletMedia"
            label="Tablet görseli"
            hint="Boş bırakılırsa masaüstü görseli kullanılır."
            value={slide.bgTabletMedia}
            onChange={(media: Media | null) => onUpdate({ bgTabletMedia: media })}
          />
          <MediaSelectField
            id="slide-bgMobileMedia"
            label="Mobil görseli"
            hint="Dikey banner önerilir. Boş bırakılırsa tablet, o da yoksa masaüstü görseli kullanılır."
            value={slide.bgMobileMedia}
            onChange={(media: Media | null) => onUpdate({ bgMobileMedia: media })}
          />

          {current && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">Odak noktası — {DEVICE_LABEL[device]}</p>
                {focalOverridden && (
                  <button type="button" className="text-xs text-primary hover:underline" onClick={resetFocal}>
                    Üst cihazın değerini kullan
                  </button>
                )}
              </div>
              <p className="text-xs text-foreground/50">
                Görsel kırpıldığında hangi bölümün görünür kalacağını belirler. Diğer cihazlar için üst çubuktan cihaz değiştirin.
              </p>
              <FocalPointPicker media={current.media} x={current.x} y={current.y} onChange={setFocal} label={`Odak noktası (${DEVICE_LABEL[device]})`} />
              <div className="grid grid-cols-2 gap-3">
                <Field id="slide-bgPosX" label="Yatay (%)">
                  {(inputProps) => (
                    <Input {...inputProps} type="number" min={0} max={100} value={current.x} onChange={(e) => setFocal(Number(e.target.value), current.y)} />
                  )}
                </Field>
                <Field id="slide-bgPosY" label="Dikey (%)">
                  {(inputProps) => (
                    <Input {...inputProps} type="number" min={0} max={100} value={current.y} onChange={(e) => setFocal(current.x, Number(e.target.value))} />
                  )}
                </Field>
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-foreground">
            <Switch checked={slide.bgKenBurns} onCheckedChange={(v) => onUpdate({ bgKenBurns: v })} aria-label="Ken Burns" />
            Yavaş yakınlaşma (Ken Burns)
          </label>
        </>
      )}

      {slide.bgType === "video" && (
        <>
          <MediaSelectField id="slide-bgVideoMedia" label="Kütüphaneden video" value={slide.bgMedia} onChange={(media: Media | null) => onUpdate({ bgMedia: media })} />
          <Field id="slide-bgVideoUrl" label="Harici video URL'si" hint="Kütüphaneden video seçilmemişse kullanılır (.mp4).">
            {(inputProps) => <Input {...inputProps} value={slide.bgVideoUrl ?? ""} onChange={(e) => onUpdate({ bgVideoUrl: e.target.value || null })} />}
          </Field>
          <MediaSelectField id="slide-bgPoster" label="Poster kare (önerilir)" value={slide.bgVideoPosterMedia} onChange={(media: Media | null) => onUpdate({ bgVideoPosterMedia: media })} />
        </>
      )}

      {slide.bgType === "gradient" && (
        <div className="grid grid-cols-2 gap-3">
          <Field id="slide-gradFrom" label="Başlangıç rengi">
            {(inputProps) => <Input {...inputProps} type="color" value={slide.bgGradientFrom ?? "#111827"} onChange={(e) => onUpdate({ bgGradientFrom: e.target.value })} />}
          </Field>
          <Field id="slide-gradTo" label="Bitiş rengi">
            {(inputProps) => <Input {...inputProps} type="color" value={slide.bgGradientTo ?? "#111827"} onChange={(e) => onUpdate({ bgGradientTo: e.target.value })} />}
          </Field>
          <Field id="slide-gradAngle" label="Açı (°)">
            {(inputProps) => (
              <Input {...inputProps} type="number" min={0} max={360} value={slide.bgGradientAngle} onChange={(e) => onUpdate({ bgGradientAngle: Number(e.target.value) })} />
            )}
          </Field>
        </div>
      )}

      <div className="space-y-3 border-t border-border pt-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Karartma</p>
          <p className="mt-1 text-xs text-foreground/50">İçinde yazı olan açık renkli banner&apos;larda ikisini de kapalı tutun.</p>
        </div>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <Switch
            checked={overlayOn}
            onCheckedChange={(v) =>
              onUpdate(v ? { bgOverlayOpacity: DEFAULT_OVERLAY_OPACITY, bgOverlayColor: slide.bgOverlayColor ?? "#000000" } : { bgOverlayOpacity: 0 })
            }
            aria-label="Düz karartma"
          />
          Düz karartma (tüm görselin üstünde)
        </label>
        {overlayOn && (
          <div className="grid grid-cols-2 gap-3">
            <Field id="slide-overlayColor" label="Renk">
              {(inputProps) => <Input {...inputProps} type="color" value={slide.bgOverlayColor ?? "#000000"} onChange={(e) => onUpdate({ bgOverlayColor: e.target.value })} />}
            </Field>
            <Field id="slide-overlayOpacity" label="Opaklık (%)">
              {(inputProps) => (
                <Input
                  {...inputProps}
                  type="number"
                  min={1}
                  max={100}
                  value={slide.bgOverlayOpacity}
                  onChange={(e) => onUpdate({ bgOverlayOpacity: Math.max(1, Number(e.target.value)) })}
                />
              )}
            </Field>
          </div>
        )}

        {slide.bgType === "image" && (
          <>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Switch checked={slide.bgScrimEnabled} onCheckedChange={(v) => onUpdate({ bgScrimEnabled: v })} aria-label="Soldan okunabilirlik gradyanı" />
              Soldan okunabilirlik gradyanı (koyudan şeffafa)
            </label>
            {slide.bgScrimEnabled && (
              <Field id="slide-scrimOpacity" label="Gradyan koyuluğu (%)" hint="Sol kenardaki koyuluk; sağa doğru şeffaflaşır.">
                {(inputProps) => (
                  <Input
                    {...inputProps}
                    type="number"
                    min={1}
                    max={100}
                    value={slide.bgScrimOpacity}
                    onChange={(e) => onUpdate({ bgScrimOpacity: Math.max(1, Number(e.target.value)) })}
                  />
                )}
              </Field>
            )}
          </>
        )}
      </div>

      <Field id="slide-duration" label="Bu slaytın süresi (ms)" hint="Boş bırakılırsa slider'ın genel süresi kullanılır.">
        {(inputProps) => (
          <Input
            {...inputProps}
            type="number"
            min={1000}
            max={60000}
            step={100}
            value={slide.durationMs ?? ""}
            placeholder="Slider varsayılanı"
            onChange={(e) => onUpdate({ durationMs: e.target.value ? Number(e.target.value) : null })}
          />
        )}
      </Field>

      <div className="border-t border-border pt-4">
        <Field id="slide-linkHref" label="Slayt bağlantısı" hint="Girilirse tüm slayt tıklanabilir olur.">
          {(inputProps) => <Input {...inputProps} value={slide.linkHref ?? ""} onChange={(e) => onUpdate({ linkHref: e.target.value || null })} />}
        </Field>
        {slide.linkHref && (
          <label className="mt-2 flex items-center gap-2 text-sm text-foreground">
            <Switch checked={slide.linkNewTab} onCheckedChange={(v) => onUpdate({ linkNewTab: v })} aria-label="Yeni sekmede aç" />
            Yeni sekmede aç
          </label>
        )}
      </div>
    </div>
  );
}
