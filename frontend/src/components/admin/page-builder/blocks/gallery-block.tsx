"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import * as mediaApi from "@/lib/api/media";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { GalleryBlock } from "@/lib/page-builder/types";

function GalleryImageRow({
  index,
  url,
  alt,
  onChangeUrl,
  onChangeAlt,
  onRemove,
}: {
  index: number;
  url: string;
  alt: string;
  onChangeUrl: (url: string) => void;
  onChangeAlt: (alt: string) => void;
  onRemove: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // §10.15.4 a11y düzeltmesi — `placeholder` kalıcı bir etiket DEĞİLDİR (WCAG 3.3.2 ihlali).
  // Satır tekrarlandığı için görsel gürültü olmasın diye label `sr-only`, ama DOM'da bulunur
  // ve her satır için tekil id/metin taşır ("Görsel N URL", "Görsel N alt metni").
  const urlInputId = `gallery-image-url-${index}`;
  const altInputId = `gallery-image-alt-${index}`;

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setUploading(true);
    try {
      const media = await mediaApi.uploadMedia(file);
      onChangeUrl(media.url);
      toast.success("Görsel yüklendi.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor={urlInputId} className="sr-only">
            {`Görsel ${index + 1} URL`}
          </label>
          <Input id={urlInputId} placeholder="Görsel URL" value={url} onChange={(e) => onChangeUrl(e.target.value)} />
        </div>
        <div className="flex-1">
          <label htmlFor={altInputId} className="sr-only">
            {`Görsel ${index + 1} alt metni`}
          </label>
          <Input id={altInputId} placeholder="Alt metin" value={alt} onChange={(e) => onChangeAlt(e.target.value)} />
        </div>
        <Button type="button" variant="secondary" size="sm" loading={uploading} onClick={() => fileInputRef.current?.click()}>
          Yükle
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          aria-label="Bilgisayardan görsel yükle"
          className="hidden"
          onChange={handleFileChange}
        />
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
          index={index}
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
