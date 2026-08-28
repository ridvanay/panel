"use client";

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MediaSelectField } from "@/components/admin/media/media-select-field";
import type { Media } from "@/lib/api/types";
import type { Slide, SlideBackgroundType } from "@/lib/sliders/types";

/** Slide seviyesi alanların HİÇBİRİNDE cihaz override YOKTUR (yalnızca katman position/style/
 *  animation'ında var, bkz. architect §2.4) — bu sekme cihaz görünümünden BAĞIMSIZ çalışır. */
export function SlideInspectorTab({ slide, onUpdate }: { slide: Slide; onUpdate: (patch: Partial<Slide>) => void }) {
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
          <MediaSelectField id="slide-bgMedia" label="Arka plan görseli" value={slide.bgMedia} onChange={(media: Media | null) => onUpdate({ bgMedia: media })} required />
          <div className="grid grid-cols-2 gap-3">
            <Field id="slide-bgPosX" label="Odak X (%)">
              {(inputProps) => (
                <Input {...inputProps} type="number" min={0} max={100} value={slide.bgPositionX} onChange={(e) => onUpdate({ bgPositionX: Number(e.target.value) })} />
              )}
            </Field>
            <Field id="slide-bgPosY" label="Odak Y (%)">
              {(inputProps) => (
                <Input {...inputProps} type="number" min={0} max={100} value={slide.bgPositionY} onChange={(e) => onUpdate({ bgPositionY: Number(e.target.value) })} />
              )}
            </Field>
          </div>
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

      <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
        <Field id="slide-overlayColor" label="Overlay rengi">
          {(inputProps) => <Input {...inputProps} type="color" value={slide.bgOverlayColor ?? "#000000"} onChange={(e) => onUpdate({ bgOverlayColor: e.target.value })} />}
        </Field>
        <Field id="slide-overlayOpacity" label="Overlay opaklığı (%)">
          {(inputProps) => (
            <Input
              {...inputProps}
              type="number"
              min={0}
              max={100}
              value={slide.bgOverlayOpacity}
              onChange={(e) => onUpdate({ bgOverlayOpacity: Number(e.target.value) })}
            />
          )}
        </Field>
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
