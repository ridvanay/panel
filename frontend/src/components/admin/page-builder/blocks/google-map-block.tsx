import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  extractGoogleMapEmbedUrlFromInput,
  getMapEmbedUrl,
  MAP_IFRAME_REFERRER_POLICY,
  MAP_IFRAME_SANDBOX,
  MAP_STYLE_FILTER,
} from "@/lib/page-builder/map-embed";
import {
  GOOGLE_MAP_DEFAULT_HEIGHT_PX,
  GOOGLE_MAP_DEFAULT_ZOOM,
  GOOGLE_MAP_MAX_ADDRESS_LENGTH,
  GOOGLE_MAP_MAX_HEIGHT_PX,
  GOOGLE_MAP_MAX_HEIGHT_VH,
  GOOGLE_MAP_MAX_MARKER_TITLE_LENGTH,
  GOOGLE_MAP_MAX_ZOOM,
  GOOGLE_MAP_MIN_HEIGHT_PX,
  GOOGLE_MAP_MIN_ZOOM,
  GOOGLE_MAP_UI_MIN_HEIGHT_VH,
  type GoogleMapBlock,
  type GoogleMapHeight,
  type GoogleMapStyle,
} from "@/lib/page-builder/types";
import { SegmentedToggle } from "./segmented-toggle";

type MapSourceMode = "address" | "embedUrl";

const SOURCE_MODE_OPTIONS: { value: MapSourceMode; label: string }[] = [
  { value: "address", label: "Adres" },
  { value: "embedUrl", label: "Yerleştirme Kodu" },
];

const HEIGHT_UNIT_OPTIONS: { value: GoogleMapHeight["unit"]; label: string }[] = [
  { value: "px", label: "px" },
  { value: "vh", label: "vh (ekran yüksekliği)" },
];

const MAP_STYLE_OPTIONS: { value: GoogleMapStyle; label: string }[] = [
  { value: "standard", label: "Standart" },
  { value: "dark", label: "Koyu" },
  { value: "silver", label: "Gümüş" },
  { value: "retro", label: "Retro" },
];

const WIDTH_MODE_OPTIONS: { value: NonNullable<GoogleMapBlock["data"]["widthMode"]>; label: string }[] = [
  { value: "boxed", label: "Kutulu" },
  { value: "full-width", label: "Tam Genişlik" },
];

export function GoogleMapBlockEditor({
  block,
  onChange,
}: {
  block: GoogleMapBlock;
  onChange: (block: GoogleMapBlock) => void;
}) {
  // Mod, veri modelinde AYRI bir alan olarak SAKLANMAZ (mimar §2.1 yalnızca `embedUrl`/`address`
  // taşır) — editörün başlangıç sekmesi mevcut `embedUrl` doluluğundan çıkarılır, sonrası yerel
  // UI state'idir (ui-designer §1.4/1: "Adres" varsayılan/ilk sekme).
  const [mode, setMode] = useState<MapSourceMode>(block.data.embedUrl ? "embedUrl" : "address");

  const height = block.data.height ?? { value: GOOGLE_MAP_DEFAULT_HEIGHT_PX, unit: "px" as const };
  const previewUrl = getMapEmbedUrl(block.data);
  const previewTitle = block.data.markerTitle?.trim() || block.data.address?.trim() || "Harita";
  const embedUrlHasKey = (block.data.embedUrl ?? "").includes("key=");

  function updateData(patch: Partial<GoogleMapBlock["data"]>) {
    onChange({ ...block, data: { ...block.data, ...patch } });
  }

  function handleUnitChange(unit: GoogleMapHeight["unit"]) {
    // Birim değiştirildiğinde değer DÖNÜŞTÜRÜLMEZ — ilgili birimin varsayılanına sıfırlanır
    // (ui-designer §1.1: piksel↔vh dönüşümü viewport'a bağlıdır, "sahte dönüşüm" yapılmaz).
    updateData({ height: unit === "px" ? { value: GOOGLE_MAP_DEFAULT_HEIGHT_PX, unit: "px" } : { value: 50, unit: "vh" } });
  }

  function handleHeightValueChange(raw: number) {
    if (!Number.isFinite(raw)) return;
    const clamped =
      height.unit === "px"
        ? Math.max(GOOGLE_MAP_MIN_HEIGHT_PX, Math.min(GOOGLE_MAP_MAX_HEIGHT_PX, Math.round(raw)))
        : Math.max(GOOGLE_MAP_UI_MIN_HEIGHT_VH, Math.min(GOOGLE_MAP_MAX_HEIGHT_VH, Math.round(raw)));
    updateData({ height: { value: clamped, unit: height.unit } });
  }

  return (
    <div className="space-y-3">
      {previewUrl && (
        <div className="h-[180px] w-full overflow-hidden rounded-md border border-border bg-muted">
          <iframe
            src={previewUrl}
            title={previewTitle}
            referrerPolicy={MAP_IFRAME_REFERRER_POLICY}
            sandbox={MAP_IFRAME_SANDBOX}
            allowFullScreen
            style={{ filter: MAP_STYLE_FILTER[block.data.mapStyle ?? "standard"] }}
            className="h-full w-full border-0"
          />
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Kaynak</p>
        <SegmentedToggle value={mode} options={SOURCE_MODE_OPTIONS} onChange={setMode} />
      </div>

      {mode === "address" ? (
        <>
          <Field id={`${block.id}-address`} label="Adres" hint={`En fazla ${GOOGLE_MAP_MAX_ADDRESS_LENGTH} karakter.`}>
            {(inputProps) => (
              <Input
                {...inputProps}
                maxLength={GOOGLE_MAP_MAX_ADDRESS_LENGTH}
                value={block.data.address ?? ""}
                onChange={(e) => updateData({ address: e.target.value })}
              />
            )}
          </Field>
          {/* Mod "Yerleştirme Kodu" iken bu alan TAMAMEN GİZLENİR (DOM'dan kaldırılır) — mimar R4:
              o modda zoom etkisizdir (Mod A'da `pb=` parametresinin içine gömülüdür). */}
          <Field id={`${block.id}-zoom`} label="Yakınlaştırma (zoom)">
            {(inputProps) => (
              <InputGroup>
                <InputGroupInput
                  {...inputProps}
                  type="number"
                  min={GOOGLE_MAP_MIN_ZOOM}
                  max={GOOGLE_MAP_MAX_ZOOM}
                  value={block.data.zoom ?? GOOGLE_MAP_DEFAULT_ZOOM}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    const clamped = Number.isFinite(raw)
                      ? Math.max(GOOGLE_MAP_MIN_ZOOM, Math.min(GOOGLE_MAP_MAX_ZOOM, Math.round(raw)))
                      : GOOGLE_MAP_DEFAULT_ZOOM;
                    updateData({ zoom: clamped });
                  }}
                />
              </InputGroup>
            )}
          </Field>
        </>
      ) : (
        <div className="space-y-1.5">
          <Field
            id={`${block.id}-embed-url`}
            label="Google Haritayı Yerleştir kodu"
            hint="Google Haritalar → Paylaş → Haritayı yerleştir panelinden alınan bağlantı"
          >
            {(inputProps) => (
              <Textarea
                {...inputProps}
                rows={3}
                className="text-xs"
                value={block.data.embedUrl ?? ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  // Kullanıcı tüm `<iframe>` snippet'ini yapıştırdıysa çıplak embed URL'i çıkarılır
                  // ve state'e ÇIKARILMIŞ hâli yazılır (textarea temiz URL'i gösterir — geri bildirim).
                  // Bare bir URL yazılıyor/düzenleniyorsa davranış DEĞİŞMEZ.
                  const value = /<iframe/i.test(raw) ? extractGoogleMapEmbedUrlFromInput(raw) : raw;
                  updateData({ embedUrl: value });
                }}
              />
            )}
          </Field>
          {embedUrlHasKey && (
            <div className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Bu bağlantı bir API anahtarı içeriyor. Google Cloud Console&apos;da anahtarı mutlaka HTTP
                referrer kısıtı ile sınırlandırın.
              </span>
            </div>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Yükseklik</p>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedToggle value={height.unit} options={HEIGHT_UNIT_OPTIONS} onChange={handleUnitChange} />
          <InputGroup className="w-32">
            <InputGroupInput
              type="number"
              aria-label="Yükseklik değeri"
              min={height.unit === "px" ? GOOGLE_MAP_MIN_HEIGHT_PX : GOOGLE_MAP_UI_MIN_HEIGHT_VH}
              max={height.unit === "px" ? GOOGLE_MAP_MAX_HEIGHT_PX : GOOGLE_MAP_MAX_HEIGHT_VH}
              step={height.unit === "px" ? 10 : 1}
              value={height.value}
              onChange={(e) => handleHeightValueChange(Number(e.target.value))}
            />
            <InputGroupAddon align="inline-end">{height.unit}</InputGroupAddon>
          </InputGroup>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Harita stili</p>
        <SegmentedToggle
          value={block.data.mapStyle ?? "standard"}
          options={MAP_STYLE_OPTIONS}
          onChange={(mapStyle) => updateData({ mapStyle })}
        />
      </div>

      {/* 180px'lik önizleme kutusu (yukarıda) sabit boyutludur, genişlik modundan ETKİLENMEZ —
          WYSIWYG yalnızca gerçek canvas/public render'da (`GoogleMapBlockView`) gerçekleşir. */}
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Genişlik</p>
        <SegmentedToggle
          value={block.data.widthMode ?? "boxed"}
          options={WIDTH_MODE_OPTIONS}
          onChange={(widthMode) => updateData({ widthMode })}
        />
      </div>

      <Field
        id={`${block.id}-marker-title`}
        label="Harita başlığı (opsiyonel)"
        hint="Erişilebilirlik için önerilir; boş bırakılırsa adres kullanılır."
      >
        {(inputProps) => (
          <Input
            {...inputProps}
            maxLength={GOOGLE_MAP_MAX_MARKER_TITLE_LENGTH}
            value={block.data.markerTitle ?? ""}
            onChange={(e) => updateData({ markerTitle: e.target.value })}
          />
        )}
      </Field>
    </div>
  );
}
