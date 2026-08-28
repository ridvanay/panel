"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ExternalLink, GalleryHorizontal, Plus } from "lucide-react";
import * as slidersApi from "@/lib/api/sliders";
import type { SliderSummary } from "@/lib/sliders/types";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { AdvancedSliderBlock } from "@/lib/page-builder/types";

/**
 * §6.4 architect — slider seçici (`GET /admin/sliders` listesinden). Blok İÇERİK TAŞIMAZ,
 * yalnızca `sliderId` referansı — bu editör slayt/katman DÜZENLEMEZ, o `/admin/sliders/{id}`
 * (Hero Studio) yetkisidir. `featured-portfolio-block.tsx` deseniyle AYNI: hafif liste çekme +
 * `Select`.
 */
export function AdvancedSliderBlockEditor({ block, onChange }: { block: AdvancedSliderBlock; onChange: (block: AdvancedSliderBlock) => void }) {
  const [sliders, setSliders] = useState<SliderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const result = await slidersApi.listSliders({ trashed: "exclude", limit: 100 });
      setSliders(result.items);
      setError(null);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, []);

  async function handleCreateFirst() {
    setCreating(true);
    try {
      const created = await slidersApi.createSlider({ name: "Yeni Slider" });
      toast.success("Slider oluşturuldu.");
      onChange({ ...block, data: { sliderId: created.id } });
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  if (sliders === null) {
    return (
      <div className="flex items-center justify-center py-6">
        <Spinner className="h-5 w-5 text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-danger">{error}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          Tekrar Dene
        </Button>
      </div>
    );
  }

  if (sliders.length === 0) {
    return (
      <EmptyState
        icon={GalleryHorizontal}
        title="Henüz slider yok"
        description="Bu blokta göstermek için önce bir Hero Studio slider'ı oluşturun."
        action={
          <Button type="button" onClick={handleCreateFirst} loading={creating}>
            <Plus className="h-4 w-4" />
            İlk Slider&apos;ı Oluştur
          </Button>
        }
      />
    );
  }

  const selected = sliders.find((s) => s.id === block.data.sliderId) ?? null;

  return (
    <div className="space-y-3">
      <Select
        aria-label="Slider seç"
        value={block.data.sliderId ?? ""}
        onChange={(e) => onChange({ ...block, data: { sliderId: e.target.value || undefined } })}
      >
        <option value="">Slider seçin…</option>
        {sliders.map((slider) => (
          <option key={slider.id} value={slider.id}>
            {slider.name} ({slider.slideCount} slayt)
          </option>
        ))}
      </Select>

      {selected ? (
        <Link
          href={`/admin/sliders/${selected.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Hero Studio&apos;da Slider&apos;ı Düzenle
        </Link>
      ) : (
        <p className="text-xs text-foreground/60">Seçilmezse bu blok public sitede hiçbir şey göstermez.</p>
      )}
    </div>
  );
}
