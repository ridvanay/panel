"use client";

import { useRef, useState, type ChangeEvent } from "react";
import * as mediaApi from "@/lib/api/media";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

interface ImageUploadFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (url: string) => void;
  required?: boolean;
}

/** Kapak görseli / blok görselleri için: önizleme + bilgisayardan yükleme + manuel URL girişi. */
export function ImageUploadField({ id, label, value, onChange, required }: ImageUploadFieldProps) {
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
      onChange(media.url);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {value && (
        // eslint-disable-next-line @next/next/no-img-element -- yüklenen/harici görsel URL'si, next/image remotePatterns henüz tanımlı değil
        <img src={value} alt="" className="h-32 w-full rounded-md border border-border object-cover" />
      )}

      <div className="flex gap-2">
        <div className="flex-1">
          <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://…" required={required} />
        </div>
        <Button type="button" variant="secondary" loading={uploading} onClick={() => fileInputRef.current?.click()}>
          Yükle
        </Button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
