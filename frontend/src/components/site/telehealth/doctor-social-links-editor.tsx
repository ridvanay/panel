"use client";

import { Plus, Trash2 } from "lucide-react";
import type { DoctorSocialLink, DoctorSocialLinkPlatform } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/**
 * `.claude/architect-scope-doctor-portfolio-identity-console.md` (**[DPI]**) — `DoctorProfile.
 * socialLinks` tekrarlayıcı form alanları. `doctor-cv-entries-editor.tsx`/`doctor-publications-
 * editor.tsx` İLE AYNI "kontrollü liste + `onChange(list)`" deseni (YENİ bir liste-yönetim
 * kütüphanesi İCAT EDİLMEZ). Sunucu bu diziyi TAMAMEN değiştirir (kısmi birleştirme YOK) — bu
 * yüzden `onChange` her değişiklikte TÜM diziyi geri verir. `url` yalnızca `https://` kabul eder
 * (`DoctorPublication.url` İLE AYNI gerekçe) — istemci ikinci bir protokol filtresi İCAT ETMEZ,
 * sunucu `422` ile zorlar; bu editör yalnızca `type="url"` tarayıcı-yerleşik biçim ipucunu kullanır.
 */

const PLATFORM_OPTIONS: { value: DoctorSocialLinkPlatform; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "youtube", label: "YouTube" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "x", label: "X (Twitter)" },
  { value: "tiktok", label: "TikTok" },
  { value: "website", label: "Web Sitesi" },
];

const MAX_SOCIAL_LINKS = 8;

const EMPTY_LINK: DoctorSocialLink = { platform: "instagram", url: "", label: "" };

export function DoctorSocialLinksEditor({
  links,
  onChange,
}: {
  links: DoctorSocialLink[];
  onChange: (links: DoctorSocialLink[]) => void;
}) {
  function addLink() {
    if (links.length >= MAX_SOCIAL_LINKS) return;
    onChange([...links, { ...EMPTY_LINK }]);
  }

  function removeLink(index: number) {
    onChange(links.filter((_, i) => i !== index));
  }

  function updateLink(index: number, patch: Partial<DoctorSocialLink>) {
    onChange(links.map((link, i) => (i === index ? { ...link, ...patch } : link)));
  }

  return (
    <div className="space-y-3">
      {links.length === 0 && <p className="text-xs text-foreground/50">Henüz sosyal medya/web bağlantısı eklenmedi.</p>}

      {links.map((link, index) => (
        <div key={index} className="space-y-3 rounded-[var(--site-radius)] border border-border p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-medium text-foreground/70">
                Platform
                <Select
                  aria-label={`Bağlantı ${index + 1} platformu`}
                  value={link.platform}
                  onChange={(e) => updateLink(index, { platform: e.target.value as DoctorSocialLinkPlatform })}
                >
                  {PLATFORM_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="space-y-1 text-xs font-medium text-foreground/70">
                Etiket (opsiyonel)
                <Input
                  aria-label={`Bağlantı ${index + 1} etiketi`}
                  value={link.label ?? ""}
                  maxLength={80}
                  placeholder="Örn. Kişisel Instagram"
                  onChange={(e) => updateLink(index, { label: e.target.value || undefined })}
                />
              </label>
              <label className="space-y-1 text-xs font-medium text-foreground/70 sm:col-span-2">
                URL (yalnızca https://)
                <Input
                  aria-label={`Bağlantı ${index + 1} adresi`}
                  type="url"
                  value={link.url}
                  maxLength={500}
                  placeholder="https://"
                  onChange={(e) => updateLink(index, { url: e.target.value })}
                />
              </label>
            </div>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`${index + 1}. bağlantıyı kaldır`} onClick={() => removeLink(index)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={links.length >= MAX_SOCIAL_LINKS} onClick={addLink}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Bağlantı Ekle
      </Button>
    </div>
  );
}
