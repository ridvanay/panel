"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronLeft, Monitor, Play, Save, Smartphone, Tablet, X } from "lucide-react";
import * as slidersApi from "@/lib/api/sliders";
import { newId } from "@/lib/page-builder/registry";
import type { DeviceMode } from "@/lib/page-builder/types";
import type {
  PublicSlider,
  Slide,
  Slider,
  SliderLayer,
  SliderLayerAnimation,
  SliderLayerPosition,
  SliderLayerStyle,
  SliderLayerType,
  UpdateSlideRequest,
  UpdateSliderRequest,
} from "@/lib/sliders/types";
import { MAX_SLIDE_LAYERS } from "@/lib/sliders/types";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { AdvancedSlider } from "@/components/site/advanced-slider/advanced-slider";
import { SlideStrip } from "./slide-strip";
import { HeroCanvas } from "./hero-canvas";
import { HeroStudioTimeline } from "./timeline";
import { HeroStudioInspector } from "./inspector";
import { SegmentedToggle } from "@/components/admin/page-builder/blocks/segmented-toggle";

const DEVICE_OPTIONS: { value: DeviceMode; label: string; icon: typeof Monitor }[] = [
  { value: "desktop", label: "Masaüstü", icon: Monitor },
  { value: "tablet", label: "Tablet", icon: Tablet },
  { value: "mobile", label: "Mobil", icon: Smartphone },
];

function defaultPosition(): SliderLayerPosition {
  return { xPercent: 50, yPercent: 50, origin: "middle-center", offsetX: 0, offsetY: 0 };
}
function defaultAnimation(): SliderLayerAnimation {
  return { inEffect: "fade-up", delayMs: 0, durationMs: 600, easing: "ease-out" };
}
function defaultStyle(): SliderLayerStyle {
  return {};
}

function createDefaultLayer(type: SliderLayerType): SliderLayer {
  const id = newId();
  const position = defaultPosition();
  const animation = defaultAnimation();
  const style = defaultStyle();
  switch (type) {
    case "heading":
      return { id, type, content: { text: "Yeni Başlık", level: 2 }, position, style, animation };
    case "text":
      return { id, type, content: { text: "Metin buraya" }, position, style, animation };
    case "badge":
      return { id, type, content: { text: "Yeni" }, position, style, animation };
    case "image":
      return { id, type, content: { url: "", alt: "" }, position, style, animation };
    case "button":
      return { id, type, content: { label: "Tıklayın", href: "/", variant: "solid", size: "md" }, position, style, animation };
  }
}

function toUpdateSlideRequest(slide: Slide): UpdateSlideRequest {
  return {
    isActive: slide.isActive,
    label: slide.label,
    bgType: slide.bgType,
    bgMediaId: slide.bgMedia?.id ?? null,
    bgVideoUrl: slide.bgVideoUrl,
    bgVideoPosterMediaId: slide.bgVideoPosterMedia?.id ?? null,
    bgPositionX: slide.bgPositionX,
    bgPositionY: slide.bgPositionY,
    bgOverlayColor: slide.bgOverlayColor,
    bgOverlayOpacity: slide.bgOverlayOpacity,
    bgGradientFrom: slide.bgGradientFrom,
    bgGradientTo: slide.bgGradientTo,
    bgGradientAngle: slide.bgGradientAngle,
    bgKenBurns: slide.bgKenBurns,
    durationMs: slide.durationMs,
    linkHref: slide.linkHref,
    linkNewTab: slide.linkNewTab,
    layers: slide.layers,
  };
}

function toUpdateSliderRequest(slider: Slider): UpdateSliderRequest {
  return {
    name: slider.name,
    slug: slider.slug,
    autoplay: slider.autoplay,
    intervalMs: slider.intervalMs,
    loop: slider.loop,
    pauseOnHover: slider.pauseOnHover,
    transitionEffect: slider.transitionEffect,
    transitionDurationMs: slider.transitionDurationMs,
    heightMode: slider.heightMode,
    heightPx: slider.heightPx,
    aspectRatioWidth: slider.aspectRatioWidth,
    aspectRatioHeight: slider.aspectRatioHeight,
    mobileHeightMode: slider.mobileHeightMode,
    mobileHeightPx: slider.mobileHeightPx,
    mobileAspectRatioWidth: slider.mobileAspectRatioWidth,
    mobileAspectRatioHeight: slider.mobileAspectRatioHeight,
    showArrows: slider.showArrows,
    showBullets: slider.showBullets,
    showProgressBar: slider.showProgressBar,
    navigationTheme: slider.navigationTheme,
  };
}

function toPreviewPublicSlider(slider: Slider): PublicSlider {
  return {
    id: slider.id,
    name: slider.name,
    autoplay: slider.autoplay,
    intervalMs: slider.intervalMs,
    loop: slider.loop,
    pauseOnHover: slider.pauseOnHover,
    transitionEffect: slider.transitionEffect,
    transitionDurationMs: slider.transitionDurationMs,
    heightMode: slider.heightMode,
    heightPx: slider.heightPx,
    aspectRatioWidth: slider.aspectRatioWidth,
    aspectRatioHeight: slider.aspectRatioHeight,
    mobileHeightMode: slider.mobileHeightMode,
    mobileHeightPx: slider.mobileHeightPx,
    mobileAspectRatioWidth: slider.mobileAspectRatioWidth,
    mobileAspectRatioHeight: slider.mobileAspectRatioHeight,
    showArrows: slider.showArrows,
    showBullets: slider.showBullets,
    showProgressBar: slider.showProgressBar,
    navigationTheme: slider.navigationTheme,
    slides: slider.slides
      .filter((s) => s.isActive)
      .map(
        (s): PublicSlider["slides"][number] => ({
          id: s.id,
          order: s.order,
          bgType: s.bgType,
          bgMedia: s.bgMedia,
          bgVideoUrl: s.bgVideoUrl,
          bgVideoPosterMedia: s.bgVideoPosterMedia,
          bgPositionX: s.bgPositionX,
          bgPositionY: s.bgPositionY,
          bgOverlayColor: s.bgOverlayColor,
          bgOverlayOpacity: s.bgOverlayOpacity,
          bgGradientFrom: s.bgGradientFrom,
          bgGradientTo: s.bgGradientTo,
          bgGradientAngle: s.bgGradientAngle,
          bgKenBurns: s.bgKenBurns,
          durationMs: s.durationMs,
          linkHref: s.linkHref,
          linkNewTab: s.linkNewTab,
          layers: s.layers,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })
      ),
  };
}

export function HeroStudio({ sliderId }: { sliderId: string }) {
  const [slider, setSlider] = useState<Slider | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceMode>("desktop");
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busySlideId, setBusySlideId] = useState<string | null>(null);
  const [addingSlide, setAddingSlide] = useState(false);
  const [deleteSlideTarget, setDeleteSlideTarget] = useState<Slide | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await slidersApi.getSlider(sliderId);
      setSlider(data);
      setLoadError(null);
      setSelectedSlideId((prev) => prev ?? data.slides[0]?.id ?? null);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, [sliderId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const selectedSlide = useMemo(() => slider?.slides.find((s) => s.id === selectedSlideId) ?? null, [slider, selectedSlideId]);
  const selectedLayer = useMemo(() => selectedSlide?.layers.find((l) => l.id === selectedLayerId) ?? null, [selectedSlide, selectedLayerId]);

  function selectSlide(id: string) {
    setSelectedSlideId(id);
    setSelectedLayerId(null);
  }

  function updateSliderLocal(patch: Partial<Slider>) {
    setSlider((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function updateSlideLocal(slideId: string, patch: Partial<Slide>) {
    setSlider((prev) => (prev ? { ...prev, slides: prev.slides.map((s) => (s.id === slideId ? { ...s, ...patch } : s)) } : prev));
  }

  function updateLayerLocal(slideId: string, layerId: string, updater: (layer: SliderLayer) => SliderLayer) {
    setSlider((prev) =>
      prev
        ? {
            ...prev,
            slides: prev.slides.map((s) => (s.id === slideId ? { ...s, layers: s.layers.map((l) => (l.id === layerId ? updater(l) : l)) } : s)),
          }
        : prev
    );
  }

  function handleAddLayer(type: SliderLayerType) {
    if (!selectedSlide) return;
    if (selectedSlide.layers.length >= MAX_SLIDE_LAYERS) {
      toast.error(`Bir slaytta en fazla ${MAX_SLIDE_LAYERS} katman olabilir.`);
      return;
    }
    const layer = createDefaultLayer(type);
    updateSlideLocal(selectedSlide.id, { layers: [...selectedSlide.layers, layer] });
    setSelectedLayerId(layer.id);
  }

  function handleDeleteLayer() {
    if (!selectedSlide || !selectedLayerId) return;
    updateSlideLocal(selectedSlide.id, { layers: selectedSlide.layers.filter((l) => l.id !== selectedLayerId) });
    setSelectedLayerId(null);
  }

  async function handleAddSlide() {
    if (!slider) return;
    setAddingSlide(true);
    try {
      const created = await slidersApi.createSlide(slider.id, {});
      setSlider((prev) => (prev ? { ...prev, slides: [...prev.slides, created] } : prev));
      selectSlide(created.id);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setAddingSlide(false);
    }
  }

  async function handleDuplicateSlide(slideId: string) {
    if (!slider) return;
    setBusySlideId(slideId);
    try {
      const created = await slidersApi.duplicateSlide(slider.id, slideId);
      await load();
      selectSlide(created.id);
      toast.success("Slayt kopyalandı.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusySlideId(null);
    }
  }

  async function confirmDeleteSlide() {
    if (!slider || !deleteSlideTarget) return;
    setBusySlideId(deleteSlideTarget.id);
    try {
      await slidersApi.deleteSlide(slider.id, deleteSlideTarget.id);
      setDeleteSlideTarget(null);
      await load();
      setSelectedSlideId(null);
      setSelectedLayerId(null);
      toast.success("Slayt silindi.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusySlideId(null);
    }
  }

  function handleReorderSlides(orderedIds: string[]) {
    if (!slider) return;
    const previous = slider.slides;
    const reordered = orderedIds.map((id) => previous.find((s) => s.id === id)!).filter(Boolean);
    setSlider({ ...slider, slides: reordered });
    void slidersApi.reorderSlides(slider.id, { slideIds: orderedIds }).catch((err) => {
      toast.error(friendlyErrorMessage(err));
      setSlider((prev) => (prev ? { ...prev, slides: previous } : prev));
    });
  }

  async function handleSave() {
    if (!slider) return;
    setSaving(true);
    try {
      await slidersApi.updateSlider(slider.id, toUpdateSliderRequest(slider));
      for (const slide of slider.slides) {
        await slidersApi.updateSlide(slider.id, slide.id, toUpdateSlideRequest(slide));
      }
      toast.success("Slider kaydedildi.");
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="p-6">
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            {loadError}
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      </div>
    );
  }

  if (!slider) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col overflow-hidden">
      <div className="sticky top-14 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/admin/sliders" className="flex items-center gap-1 text-sm text-foreground/60 hover:text-foreground" aria-label="Slider listesine dön">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <input
            aria-label="Slider adı"
            value={slider.name}
            onChange={(e) => updateSliderLocal({ name: e.target.value })}
            className="admin-h3 min-w-0 max-w-xs truncate border-none bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>

        <SegmentedToggle value={device} options={DEVICE_OPTIONS} onChange={setDevice} />

        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setPreviewOpen(true)} disabled={slider.slides.every((s) => !s.isActive)}>
            <Play className="h-3.5 w-3.5" />
            Önizle
          </Button>
          <Button type="button" size="sm" onClick={() => void handleSave()} loading={saving}>
            <Save className="h-3.5 w-3.5" />
            Kaydet
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <SlideStrip
          slides={slider.slides}
          selectedSlideId={selectedSlideId}
          busySlideId={busySlideId}
          onSelect={selectSlide}
          onReorder={handleReorderSlides}
          onAdd={() => void handleAddSlide()}
          onDuplicate={(id) => void handleDuplicateSlide(id)}
          onDelete={(id) => {
            const target = slider.slides.find((s) => s.id === id);
            if (target) setDeleteSlideTarget(target);
          }}
          onToggleActive={(id, next) => updateSlideLocal(id, { isActive: next })}
          adding={addingSlide}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          {selectedSlide ? (
            <>
              <HeroCanvas
                slider={slider}
                slide={selectedSlide}
                device={device}
                selectedLayerId={selectedLayerId}
                onSelectLayer={setSelectedLayerId}
                onUpdateLayer={(layerId, updater) => updateLayerLocal(selectedSlide.id, layerId, updater)}
              />
              <HeroStudioTimeline
                slider={slider}
                slide={selectedSlide}
                device={device}
                selectedLayerId={selectedLayerId}
                onSelectLayer={setSelectedLayerId}
                onUpdateLayer={(layerId, updater) => updateLayerLocal(selectedSlide.id, layerId, updater)}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-foreground/50">
              Başlamak için sol taraftan bir slayt seçin veya yeni bir slayt ekleyin.
            </div>
          )}
        </div>

        <HeroStudioInspector
          slider={slider}
          slide={selectedSlide}
          layer={selectedLayer}
          device={device}
          onUpdateSlider={updateSliderLocal}
          onUpdateSlide={(patch) => selectedSlide && updateSlideLocal(selectedSlide.id, patch)}
          onUpdateLayer={(updater) => selectedSlide && selectedLayerId && updateLayerLocal(selectedSlide.id, selectedLayerId, updater)}
          onDeleteLayer={handleDeleteLayer}
          onAddLayer={handleAddLayer}
        />
      </div>

      <ConfirmDialog
        open={deleteSlideTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteSlideTarget(null);
        }}
        title="Slaytı sil"
        description={deleteSlideTarget ? `"${deleteSlideTarget.label || "Bu slayt"}" silinecek. Bu işlem geri alınamaz.` : undefined}
        confirmText="Sil"
        tone="danger"
        loading={busySlideId === deleteSlideTarget?.id}
        onConfirm={confirmDeleteSlide}
      />

      {previewOpen && (
        <div className="fixed inset-0 z-[100] bg-black">
          <button
            type="button"
            onClick={() => setPreviewOpen(false)}
            aria-label="Önizlemeyi kapat"
            className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white backdrop-blur-sm hover:bg-black/70"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="site-scope h-full w-full overflow-auto">
            <AdvancedSlider slider={toPreviewPublicSlider(slider)} />
          </div>
        </div>
      )}
    </div>
  );
}
