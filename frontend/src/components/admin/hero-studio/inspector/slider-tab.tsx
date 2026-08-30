"use client";

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { DeviceMode } from "@/lib/page-builder/types";
import type { Slider, SliderHeightMode, SliderNavigationTheme, SliderTransitionEffect, SliderWidthMode } from "@/lib/sliders/types";

export function SliderInspectorTab({ slider, device, onUpdate }: { slider: Slider; device: DeviceMode; onUpdate: (patch: Partial<Slider>) => void }) {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Kimlik</p>
        <Field id="slider-name" label="Ad" required>
          {(p) => <Input {...p} value={slider.name} onChange={(e) => onUpdate({ name: e.target.value })} />}
        </Field>
        <Field id="slider-slug" label="Slug">
          {(p) => <Input {...p} value={slider.slug} onChange={(e) => onUpdate({ slug: e.target.value })} />}
        </Field>
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Otomatik Oynatma</p>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Switch checked={slider.autoplay} onCheckedChange={(v) => onUpdate({ autoplay: v })} aria-label="Otomatik oynatma" />
          Otomatik oynat
        </label>
        <Field id="slider-interval" label="Aralık (ms)">
          {(p) => (
            <Input {...p} type="number" min={1000} max={60000} step={100} value={slider.intervalMs} onChange={(e) => onUpdate({ intervalMs: Number(e.target.value) })} />
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Switch checked={slider.loop} onCheckedChange={(v) => onUpdate({ loop: v })} aria-label="Döngü" />
          Sonsuz döngü
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Switch checked={slider.pauseOnHover} onCheckedChange={(v) => onUpdate({ pauseOnHover: v })} aria-label="Üzerine gelince duraklat" />
          Üzerine gelince / odaklanınca duraklat
        </label>
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Geçiş</p>
        <Field id="slider-transition" label="Geçiş efekti">
          {(p) => (
            <Select {...p} value={slider.transitionEffect} onChange={(e) => onUpdate({ transitionEffect: e.target.value as SliderTransitionEffect })}>
              <option value="slide">Kaydırma</option>
              <option value="fade">Solma</option>
              <option value="cube">Küp</option>
              <option value="zoom">Yakınlaşma</option>
            </Select>
          )}
        </Field>
        <Field id="slider-transitionDuration" label="Geçiş süresi (ms)">
          {(p) => (
            <Input
              {...p}
              type="number"
              min={100}
              max={3000}
              step={50}
              value={slider.transitionDurationMs}
              onChange={(e) => onUpdate({ transitionDurationMs: Number(e.target.value) })}
            />
          )}
        </Field>
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Yerleşim</p>
        <Field
          id="slider-widthMode"
          label="Genişlik modu"
          hint={
            slider.widthMode === "boxed" && slider.heightMode === "full-screen"
              ? "Kutulu yerleşimde tam ekran yüksekliği genellikle istenmez."
              : undefined
          }
        >
          {(p) => (
            <Select {...p} value={slider.widthMode} onChange={(e) => onUpdate({ widthMode: e.target.value as SliderWidthMode })}>
              <option value="full-width">Tam genişlik</option>
              <option value="boxed">Kutulu (içerik genişliği)</option>
            </Select>
          )}
        </Field>
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Yükseklik {device !== "desktop" && `— ${device === "tablet" ? "Tablet" : "Mobil"}`}</p>

        {device === "tablet" && (
          <p className="rounded-md border border-dashed border-border p-3 text-xs text-foreground/50">
            Tablet için ayrı bir yükseklik ayarı yoktur — masaüstü değerini miras alır.
          </p>
        )}

        {device !== "tablet" && device !== "mobile" && (
          <>
            <Field id="slider-heightMode" label="Yükseklik modu">
              {(p) => (
                <Select {...p} value={slider.heightMode} onChange={(e) => onUpdate({ heightMode: e.target.value as SliderHeightMode })}>
                  <option value="full-screen">Tam ekran (100svh)</option>
                  <option value="custom-px">Sabit piksel</option>
                  <option value="aspect-ratio">En-boy oranı</option>
                </Select>
              )}
            </Field>
            {slider.heightMode === "custom-px" && (
              <Field id="slider-heightPx" label="Yükseklik (px)">
                {(p) => (
                  <Input {...p} type="number" min={120} max={2000} value={slider.heightPx ?? 600} onChange={(e) => onUpdate({ heightPx: Number(e.target.value) })} />
                )}
              </Field>
            )}
            {slider.heightMode === "aspect-ratio" && (
              <div className="grid grid-cols-2 gap-3">
                <Field id="slider-aspectW" label="Genişlik oranı">
                  {(p) => (
                    <Input {...p} type="number" min={1} max={64} value={slider.aspectRatioWidth} onChange={(e) => onUpdate({ aspectRatioWidth: Number(e.target.value) })} />
                  )}
                </Field>
                <Field id="slider-aspectH" label="Yükseklik oranı">
                  {(p) => (
                    <Input {...p} type="number" min={1} max={64} value={slider.aspectRatioHeight} onChange={(e) => onUpdate({ aspectRatioHeight: Number(e.target.value) })} />
                  )}
                </Field>
              </div>
            )}
          </>
        )}

        {device === "mobile" && (
          <>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Switch
                checked={slider.mobileHeightMode != null}
                onCheckedChange={(v) =>
                  onUpdate(
                    v
                      ? { mobileHeightMode: slider.heightMode, mobileHeightPx: slider.heightPx, mobileAspectRatioWidth: slider.aspectRatioWidth, mobileAspectRatioHeight: slider.aspectRatioHeight }
                      : { mobileHeightMode: null, mobileHeightPx: null, mobileAspectRatioWidth: null, mobileAspectRatioHeight: null }
                  )
                }
                aria-label="Mobilde farklı yükseklik kullan"
              />
              Mobilde farklı yükseklik kullan
            </label>
            {slider.mobileHeightMode != null && (
              <>
                <Field id="slider-mobileHeightMode" label="Mobil yükseklik modu">
                  {(p) => (
                    <Select {...p} value={slider.mobileHeightMode!} onChange={(e) => onUpdate({ mobileHeightMode: e.target.value as SliderHeightMode })}>
                      <option value="full-screen">Tam ekran (100svh)</option>
                      <option value="custom-px">Sabit piksel</option>
                      <option value="aspect-ratio">En-boy oranı</option>
                    </Select>
                  )}
                </Field>
                {slider.mobileHeightMode === "custom-px" && (
                  <Field id="slider-mobileHeightPx" label="Yükseklik (px)">
                    {(p) => (
                      <Input {...p} type="number" min={120} max={2000} value={slider.mobileHeightPx ?? 500} onChange={(e) => onUpdate({ mobileHeightPx: Number(e.target.value) })} />
                    )}
                  </Field>
                )}
                {slider.mobileHeightMode === "aspect-ratio" && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field id="slider-mobileAspectW" label="Genişlik oranı">
                      {(p) => (
                        <Input
                          {...p}
                          type="number"
                          min={1}
                          max={64}
                          value={slider.mobileAspectRatioWidth ?? slider.aspectRatioWidth}
                          onChange={(e) => onUpdate({ mobileAspectRatioWidth: Number(e.target.value) })}
                        />
                      )}
                    </Field>
                    <Field id="slider-mobileAspectH" label="Yükseklik oranı">
                      {(p) => (
                        <Input
                          {...p}
                          type="number"
                          min={1}
                          max={64}
                          value={slider.mobileAspectRatioHeight ?? slider.aspectRatioHeight}
                          onChange={(e) => onUpdate({ mobileAspectRatioHeight: Number(e.target.value) })}
                        />
                      )}
                    </Field>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Navigasyon</p>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Switch checked={slider.showArrows} onCheckedChange={(v) => onUpdate({ showArrows: v })} aria-label="Ok butonları" />
          Ok butonlarını göster
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Switch checked={slider.showBullets} onCheckedChange={(v) => onUpdate({ showBullets: v })} aria-label="Sayfa göstergeleri" />
          Sayfa göstergelerini (bullet) göster
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Switch checked={slider.showProgressBar} onCheckedChange={(v) => onUpdate({ showProgressBar: v })} aria-label="İlerleme çubuğu" />
          İlerleme çubuğunu göster
        </label>
        <Field id="slider-navTheme" label="Navigasyon teması" hint="Slaytın zemin tonuna göre seçin (açık zemin → koyu kroma).">
          {(p) => (
            <Select {...p} value={slider.navigationTheme} onChange={(e) => onUpdate({ navigationTheme: e.target.value as SliderNavigationTheme })}>
              <option value="light">Açık zemin</option>
              <option value="dark">Koyu zemin</option>
            </Select>
          )}
        </Field>
      </div>
    </div>
  );
}
