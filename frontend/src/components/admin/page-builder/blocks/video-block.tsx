import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { VideoBlock, VideoProvider } from "@/lib/page-builder/types";
import { SegmentedToggle } from "./segmented-toggle";

const PROVIDER_OPTIONS: { value: VideoProvider; label: string }[] = [
  { value: "youtube", label: "YouTube" },
  { value: "vimeo", label: "Vimeo" },
  { value: "mp4", label: "MP4 dosyası" },
];

const URL_HINT: Record<VideoProvider, string> = {
  youtube: "YouTube video bağlantısı (ör. https://www.youtube.com/watch?v=…)",
  vimeo: "Vimeo video bağlantısı (ör. https://vimeo.com/…)",
  mp4: "Doğrudan .mp4 dosya bağlantısı",
};

export function VideoBlockEditor({ block, onChange }: { block: VideoBlock; onChange: (block: VideoBlock) => void }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Kaynak</p>
        <SegmentedToggle
          value={block.data.provider}
          options={PROVIDER_OPTIONS}
          onChange={(provider) => onChange({ ...block, data: { ...block.data, provider } })}
        />
      </div>
      <Field id={`${block.id}-url`} label="Video bağlantısı" hint={URL_HINT[block.data.provider]} required>
        {(inputProps) => (
          <Input
            {...inputProps}
            value={block.data.url}
            onChange={(e) => onChange({ ...block, data: { ...block.data, url: e.target.value } })}
          />
        )}
      </Field>
      <div className="flex items-center justify-between">
        <label htmlFor={`${block.id}-autoplay`} className="text-sm font-medium text-foreground">
          Otomatik oynat
        </label>
        <Switch
          id={`${block.id}-autoplay`}
          checked={block.data.autoplay}
          onCheckedChange={(autoplay) => onChange({ ...block, data: { ...block.data, autoplay } })}
        />
      </div>
      <div className="flex items-center justify-between">
        <label htmlFor={`${block.id}-muted`} className="text-sm font-medium text-foreground">
          Sessiz başlat
        </label>
        <Switch
          id={`${block.id}-muted`}
          checked={block.data.muted}
          onCheckedChange={(muted) => onChange({ ...block, data: { ...block.data, muted } })}
        />
      </div>
      {block.data.autoplay && !block.data.muted && (
        <p className="text-xs text-warning">Tarayıcılar çoğunlukla yalnızca sessiz videoların otomatik oynatılmasına izin verir.</p>
      )}
    </div>
  );
}
