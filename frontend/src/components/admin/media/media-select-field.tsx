"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Images, UploadCloud, X } from "lucide-react";
import * as mediaApi from "@/lib/api/media";
import type { Media } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { MediaPicker } from "@/components/admin/media/media-picker";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

interface MediaSelectFieldProps {
  id: string;
  label: string;
  value: Media | null;
  onChange: (media: Media | null) => void;
  required?: boolean;
}

/**
 * `ImageUploadField`ten FARKLI (bkz. image-upload-field.tsx): Page/BlogPost'un düz string
 * `coverImageUrl` alanının aksine Product/Portfolio artık gerçek `Media` İLİŞKİSİ kullanıyor
 * (`coverMediaId`) — bu yüzden yalnızca URL değil, seçilen `Media` NESNESİNİN TAMAMINI
 * (id + url + altText) tutar/döner. Aynı seçim/yükleme akışını (`MediaPicker`) kullanır.
 *
 * Seçili görselin alt-metnini SALT-OKUNUR gösterir — medya kütüphanesinden gelen değeri
 * yansıtır, burada DEĞİŞTİRİLEMEZ. Alt-text değişikliği yalnızca medya kütüphanesi sayfasından
 * yapılır (bkz. görev notu) — bu bileşenin sorumluluğu değildir.
 */
export function MediaSelectField({ id, label, value, onChange, required }: MediaSelectFieldProps) {
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
      onChange(media);
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
    onChange(media);
    setPickerOpen(false);
  }

  return (
    <div className="space-y-1.5">
      <span id={`${id}-label`} className="block text-sm font-medium text-foreground">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </span>

      {value && (
        <div className="space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element -- yüklenen/harici görsel URL'si, next/image remotePatterns henüz tanımlı değil */}
          <img src={value.url} alt="" className="h-32 w-full rounded-md border border-border object-cover" />
          <p className="text-xs text-foreground/60">
            Alt metin:{" "}
            {value.altText ? value.altText : <span className="italic text-foreground/40">Tanımlanmamış</span>}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${id}-label`}>
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
        {value && (
          <Button type="button" variant="ghost" aria-label="Görseli kaldır" onClick={() => onChange(null)}>
            <X className="h-4 w-4" />
            <span className="hidden sm:inline">Kaldır</span>
          </Button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          aria-label="Bilgisayardan görsel yükle"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      <MediaPicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={handlePick} />
    </div>
  );
}
