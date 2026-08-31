import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import { newId } from "@/lib/page-builder/registry";
import { LOGO_MARQUEE_MAX_ITEMS, type LogoDisplayMode, type LogoMarqueeBlock, type LogoMarqueeItem } from "@/lib/page-builder/types";
import { SegmentedToggle } from "./segmented-toggle";

const DISPLAY_MODE_OPTIONS: { value: LogoDisplayMode; label: string }[] = [
  { value: "marquee", label: "Bant (kayan)" },
  { value: "grid", label: "Izgara" },
];

/** `grayscale` ile AYNI sınıf çifti (ui-designer §3.2, `site/blocks/logo-marquee-block.tsx` ile
 *  BİREBİR — sürüklenmeyi önlemek için TEK tabloda tutulur). */
const GRAYSCALE_CLASS: Record<"true" | "false", string> = {
  true: "grayscale hover:grayscale-0 transition-all",
  false: "opacity-90 hover:opacity-100 transition-opacity",
};

/** ui-designer §6.2 — kart-içi anlık önizleme: `grayscale` anahtarının etkisini gerçek render
 *  sınıflarıyla (küçültülmüş `h-8` ölçeğinde) doğrular. `displayMode` bu önizlemeyi DEĞİŞTİRMEZ. */
function LogoPreview({ items, grayscale }: { items: LogoMarqueeItem[]; grayscale: boolean }) {
  if (items.length === 0) return null;
  const grayscaleClass = GRAYSCALE_CLASS[grayscale ? "true" : "false"];
  return (
    <div className="flex h-20 w-full items-center gap-4 overflow-x-auto overflow-y-hidden rounded-md border border-border bg-muted px-3">
      {items.map((item) => (
        // eslint-disable-next-line @next/next/no-img-element -- image-block.tsx ile AYNI gerekçe
        <img key={item.id} src={item.url} alt="" className={cn("h-8 w-auto shrink-0 object-contain", grayscaleClass)} />
      ))}
    </div>
  );
}

export function LogoMarqueeBlockEditor({
  block,
  onChange,
  simple = false,
}: {
  block: LogoMarqueeBlock;
  onChange: (block: LogoMarqueeBlock) => void;
  /** §2.5 tablo B — şablon modunda hız/üzerine gelince durdur kilitlidir. */
  simple?: boolean;
}) {
  const items = block.data.items;

  function updateItem(id: string, patch: Partial<LogoMarqueeItem>) {
    onChange({ ...block, data: { ...block.data, items: items.map((item) => (item.id === id ? { ...item, ...patch } : item)) } });
  }

  function removeItem(id: string) {
    onChange({ ...block, data: { ...block.data, items: items.filter((item) => item.id !== id) } });
  }

  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange({ ...block, data: { ...block.data, items: next } });
  }

  function addItem() {
    if (items.length >= LOGO_MARQUEE_MAX_ITEMS) return;
    onChange({ ...block, data: { ...block.data, items: [...items, { id: newId(), url: "", alt: "" }] } });
  }

  const grayscale = block.data.grayscale ?? true;
  const displayMode = block.data.displayMode ?? "marquee";

  return (
    <div className="space-y-3">
      <LogoPreview items={items} grayscale={grayscale} />
      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={item.id} className="space-y-2 rounded-lg border border-border/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground/50">Logo {index + 1}</span>
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Yukarı taşı" onClick={() => moveItem(index, -1)} disabled={index === 0}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Aşağı taşı"
                  onClick={() => moveItem(index, 1)}
                  disabled={index === items.length - 1}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Logoyu sil" onClick={() => removeItem(item.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <ImageUploadField id={`${item.id}-url`} label="Logo görseli" required value={item.url} onChange={(url) => updateItem(item.id, { url })} />
            <Field id={`${item.id}-alt`} label="Alternatif metin (alt)">
              {(p) => <Input {...p} value={item.alt} onChange={(e) => updateItem(item.id, { alt: e.target.value })} />}
            </Field>
            <Field id={`${item.id}-href`} label="Bağlantı (opsiyonel)">
              {(p) => (
                <Input
                  {...p}
                  value={item.href ?? ""}
                  onChange={(e) => updateItem(item.id, { href: e.target.value || undefined })}
                />
              )}
            </Field>
          </div>
        ))}
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={addItem} disabled={items.length >= LOGO_MARQUEE_MAX_ITEMS}>
        <Plus className="h-4 w-4" />
        Logo Ekle
      </Button>

      {!simple && (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">Görünüm</p>
            <SegmentedToggle
              value={displayMode}
              options={DISPLAY_MODE_OPTIONS}
              onChange={(nextMode) => onChange({ ...block, data: { ...block.data, displayMode: nextMode } })}
            />
          </div>
          <div className="flex items-center justify-between">
            <label htmlFor="logo-marquee-grayscale" className="text-sm font-medium text-foreground">
              Siyah-beyaz göster
            </label>
            <Switch
              id="logo-marquee-grayscale"
              checked={grayscale}
              onCheckedChange={(nextGrayscale) => onChange({ ...block, data: { ...block.data, grayscale: nextGrayscale } })}
            />
          </div>
          {/* `displayMode: "grid"` iken `speedSeconds`/`pauseOnHover` ANLAMSIZDIR — veri modelinde
              KALIR (mod değiştirip geri dönünce ayar kaybolmasın), yalnızca UI'da GİZLENİR
              (mimar §2.5). */}
          {displayMode === "marquee" && (
            <>
              <Field id="logo-marquee-speed" label="Hız (bir tam döngü, saniye)">
                {(p) => (
                  <InputGroup>
                    <InputGroupInput
                      {...p}
                      type="number"
                      min={5}
                      max={120}
                      value={block.data.speedSeconds}
                      onChange={(e) => {
                        const raw = Number(e.target.value);
                        const clamped = Number.isFinite(raw) ? Math.max(5, Math.min(120, Math.round(raw))) : 30;
                        onChange({ ...block, data: { ...block.data, speedSeconds: clamped } });
                      }}
                    />
                    <InputGroupAddon align="inline-end">sn</InputGroupAddon>
                  </InputGroup>
                )}
              </Field>
              <div className="flex items-center justify-between">
                <label htmlFor="logo-marquee-pause" className="text-sm font-medium text-foreground">
                  Üzerine gelince durdur
                </label>
                <Switch
                  id="logo-marquee-pause"
                  checked={block.data.pauseOnHover}
                  onCheckedChange={(pauseOnHover) => onChange({ ...block, data: { ...block.data, pauseOnHover } })}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
