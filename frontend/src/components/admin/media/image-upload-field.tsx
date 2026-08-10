"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Images, UploadCloud } from "lucide-react";
import * as mediaApi from "@/lib/api/media";
import type { Media } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MediaPicker } from "@/components/admin/media/media-picker";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

interface ImageUploadFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (url: string) => void;
  required?: boolean;
  /**
   * Önizleme şekli. Varsayılan `"square"` (mevcut davranış, DEĞİŞMEZ). `"circle"`
   * yalnızca avatar gibi dairesel gösterilmesi gereken görseller için kullanılır
   * (bkz. `.claude/design-notes-account-page.md` Karar 2).
   */
  previewShape?: "square" | "circle";
}

/** Kapak görseli / blok görselleri için: önizleme + kütüphaneden seçim + bilgisayardan yükleme + manuel URL girişi. */
export function ImageUploadField({
  id,
  label,
  value,
  onChange,
  required,
  previewShape = "square",
}: ImageUploadFieldProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setUploading(true);
    try {
      const media = await mediaApi.uploadMedia(file);
      onChange(media.url);
      toast.success("Görsel yüklendi.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setUploading(false);
    }
  }

  function handlePick(media: Media) {
    onChange(media.url);
    setPickerOpen(false);
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
        // Önizleme HER ZAMAN kendi konteynerine sığdırılmış (object-fit) gösterilir —
        // konteyner `overflow-hidden` + sabit boyutla sınırlı olduğu için görselin gerçek
        // (intrinsic) boyutu ne olursa olsun taşma/dev-boyut görünümü oluşamaz. Kare mod
        // (logo/kapak görseli gibi kırpılmaması gereken içerik) `object-contain` + nötr bir
        // zemin (letterbox alanı için) kullanır; dairesel mod (avatar) BİLEREK `object-cover`
        // ile kırpmaya devam eder (tasarım kararı: avatar dairesini eksiksiz doldurmalı).
        <div
          className={
            previewShape === "circle"
              ? "mx-auto flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-border bg-muted"
              : "flex h-32 w-full items-center justify-center overflow-hidden rounded-md border border-border bg-muted"
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- yüklenen/harici görsel URL'si, next/image remotePatterns henüz tanımlı değil */}
          <img
            src={value}
            alt=""
            className={previewShape === "circle" ? "h-full w-full object-cover" : "h-full w-full object-contain"}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          className="min-w-[160px] flex-1 basis-full sm:basis-auto"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…"
          required={required}
        />
        <Button type="button" variant="secondary" aria-label="Kütüphaneden Seç" onClick={() => setPickerOpen(true)}>
          <Images className="h-4 w-4" />
          <span className="hidden sm:inline">Kütüphaneden Seç</span>
        </Button>
        <Button
          type="button"
          variant="secondary"
          aria-label="Yükle"
          loading={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadCloud className="h-4 w-4" />
          <span className="hidden sm:inline">Yükle</span>
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          aria-label="Bilgisayardan görsel yükle"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <MediaPicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={handlePick} />
    </div>
  );
}
