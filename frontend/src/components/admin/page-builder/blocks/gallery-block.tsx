"use client";

import { useRef, useState, type ChangeEvent } from "react";
import * as mediaApi from "@/lib/api/media";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { GalleryBlock } from "@/lib/page-builder/types";

function GalleryImageRow({
  url,
  alt,
  onChangeUrl,
  onChangeAlt,
  onRemove,
}: {
  url: string;
  alt: string;
  onChangeUrl: (url: string) => void;
  onChangeAlt: (alt: string) => void;
  onRemove: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setUploading(true);
    try {
      const media = await mediaApi.uploadMedia(file);
      onChangeUrl(media.url);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input placeholder="Görsel URL" value={url} onChange={(e) => onChangeUrl(e.target.value)} />
        </div>
        <div className="flex-1">
          <Input placeholder="Alt metin" value={alt} onChange={(e) => onChangeAlt(e.target.value)} />
        </div>
        <Button type="button" variant="secondary" size="sm" loading={uploading} onClick={() => fileInputRef.current?.click()}>
          Yükle
        </Button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          Kaldır
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export function GalleryBlockEditor({ block, onChange }: { block: GalleryBlock; onChange: (block: GalleryBlock) => void }) {
  function updateImage(index: number, field: "url" | "alt", value: string) {
    const images = block.data.images.map((img, i) => (i === index ? { ...img, [field]: value } : img));
    onChange({ ...block, data: { images } });
  }

  function removeImage(index: number) {
    onChange({ ...block, data: { images: block.data.images.filter((_, i) => i !== index) } });
  }

  function addImage() {
    onChange({ ...block, data: { images: [...block.data.images, { url: "", alt: "" }] } });
  }

  return (
    <div className="space-y-3">
      {block.data.images.map((image, index) => (
        <GalleryImageRow
          key={index}
          url={image.url}
          alt={image.alt}
          onChangeUrl={(url) => updateImage(index, "url", url)}
          onChangeAlt={(alt) => updateImage(index, "alt", alt)}
          onRemove={() => removeImage(index)}
        />
      ))}
      <Button type="button" variant="secondary" size="sm" onClick={addImage}>
        Görsel ekle
      </Button>
    </div>
  );
}
