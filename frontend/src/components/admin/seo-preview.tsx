"use client";

import { Globe, ImageIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";

const GOOGLE_TITLE_LIMIT = 60;
const GOOGLE_DESCRIPTION_LIMIT = 155;

/** Google'ın karakter sınırını taklit eder: sınırı aşan metni "…" ile keser. */
function truncateForGoogle(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

function CharacterCounter({ label, length, limit }: { label: string; length: number; limit: number }) {
  const overLimit = length > limit;
  return (
    <span className={cn("text-xs", overLimit ? "text-amber-500" : "text-foreground/50")}>
      {label}: {length}/{limit} karakter
      {overLimit && " (uzun, kesilecek)"}
    </span>
  );
}

interface SeoPreviewProps {
  title: string;
  description: string;
  slug: string;
  imageUrl?: string | null;
  /** Gerçek site URL'si prop olarak geçilmezse kullanılan yer tutucu domain. */
  baseUrl?: string;
}

/**
 * Blog yazısı / sayfa editörlerinde kullanıcı yazdıkça CANLI güncellenen, salt
 * görsel bir Google arama sonucu + sosyal medya (OG/Twitter) kart önizlemesi.
 * Kendi state'i yoktur — tamamen prop'lardan render eder (controlled/pure).
 */
export function SeoPreview({ title, description, slug, imageUrl, baseUrl = "example.com" }: SeoPreviewProps) {
  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  const cleanSlug = slug.trim().replace(/^\/+/, "");

  const displayTitle = trimmedTitle ? truncateForGoogle(trimmedTitle, GOOGLE_TITLE_LIMIT) : "Başlık girilmedi";
  const displayDescription = trimmedDescription
    ? truncateForGoogle(trimmedDescription, GOOGLE_DESCRIPTION_LIMIT)
    : "Açıklama girilmedi";

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">SEO Önizleme</h2>
        <p className="mt-1 text-xs text-foreground/50">Arama motorlarında ve sosyal medyada nasıl görüneceğini önizle.</p>
      </div>

      <Tabs defaultValue="google">
        <TabsList>
          <TabsTrigger value="google">Google Önizleme</TabsTrigger>
          <TabsTrigger value="social">Sosyal Medya (Twitter/LinkedIn)</TabsTrigger>
        </TabsList>

        <TabsContent value="google" className="mt-4 space-y-3 outline-none">
          <div className="overflow-hidden rounded-lg border border-black/10 bg-white p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400">
                <Globe className="h-4 w-4" />
              </span>
              <div className="min-w-0 leading-tight">
                <p className="truncate text-sm text-gray-800">{baseUrl}</p>
                <p className="truncate text-xs text-gray-500">
                  {baseUrl} › {cleanSlug || "sayfa"}
                </p>
              </div>
            </div>
            <p className="mt-2 truncate text-xl text-[#1a0dab]">{displayTitle}</p>
            <p className="mt-1 text-sm leading-snug text-gray-600">{displayDescription}</p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <CharacterCounter label="Başlık" length={trimmedTitle.length} limit={GOOGLE_TITLE_LIMIT} />
            <CharacterCounter label="Açıklama" length={trimmedDescription.length} limit={GOOGLE_DESCRIPTION_LIMIT} />
          </div>
        </TabsContent>

        <TabsContent value="social" className="mt-4 outline-none">
          <div className="overflow-hidden rounded-xl border border-border/60">
            <div className="relative aspect-[1.91/1] w-full bg-surface-muted">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- harici/yüklenen görsel URL'si, next/image remotePatterns tanımlı değil
                <img src={imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-foreground/30">
                  <ImageIcon className="h-8 w-8" />
                  <span className="text-xs">Kapak görseli yok</span>
                </div>
              )}
            </div>
            <div className="space-y-1 border-t border-border/60 bg-surface/80 p-3">
              <p className="truncate text-xs font-medium uppercase tracking-wide text-foreground/40">{baseUrl}</p>
              <p className="truncate text-sm font-semibold text-foreground">{trimmedTitle || "Başlık girilmedi"}</p>
              <p className="line-clamp-2 text-xs text-foreground/60">{trimmedDescription || "Açıklama girilmedi"}</p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </Card>
  );
}
