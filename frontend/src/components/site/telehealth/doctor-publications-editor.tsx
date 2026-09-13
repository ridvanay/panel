"use client";

import { Plus, Trash2 } from "lucide-react";
import type { DoctorPublication, DoctorPublicationKind } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/**
 * `.claude/architect-scope-doctor-portfolio-identity-console.md` (**[DPI]**) §1.3/§1.4 —
 * `DoctorProfile.publications` tekrarlayıcı form alanları. `doctor-cv-entries-editor.tsx` İLE
 * AYNI "kontrollü liste + `onChange(list)`" deseni. `url`/`doi` yalnızca `https://` şeması kabul
 * eder ([DPI] §1.3 kural 3) — istemci burada İKİNCİ bir protokol filtresi İCAT ETMEZ, sunucu
 * `422` ile zorlar; bu editör yalnızca `type="url"` tarayıcı-yerleşik biçim ipucunu kullanır.
 */

const KIND_OPTIONS: { value: DoctorPublicationKind; label: string }[] = [
  { value: "INTERNATIONAL_ARTICLE", label: "Uluslararası Makale" },
  { value: "NATIONAL_ARTICLE", label: "Ulusal Makale" },
  { value: "PROCEEDING", label: "Bildiri" },
  { value: "BOOK_CHAPTER", label: "Kitap Bölümü" },
  { value: "OTHER", label: "Diğer" },
];

const MAX_PUBLICATIONS = 200;

const EMPTY_PUBLICATION: DoctorPublication = {
  kind: "INTERNATIONAL_ARTICLE",
  title: "",
  venue: "",
  authors: "",
  year: new Date().getUTCFullYear(),
  doi: "",
  url: "",
};

export function DoctorPublicationsEditor({
  publications,
  onChange,
}: {
  publications: DoctorPublication[];
  onChange: (publications: DoctorPublication[]) => void;
}) {
  function addPublication() {
    if (publications.length >= MAX_PUBLICATIONS) return;
    onChange([...publications, { ...EMPTY_PUBLICATION }]);
  }

  function removePublication(index: number) {
    onChange(publications.filter((_, i) => i !== index));
  }

  function updatePublication(index: number, patch: Partial<DoctorPublication>) {
    onChange(publications.map((pub, i) => (i === index ? { ...pub, ...patch } : pub)));
  }

  return (
    <div className="space-y-3">
      {publications.length === 0 && <p className="text-xs text-foreground/50">Henüz bilimsel yayın eklenmedi.</p>}

      {publications.map((pub, index) => (
        <div key={index} className="space-y-3 rounded-[var(--site-radius)] border border-border p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-medium text-foreground/70">
                Tür
                <Select value={pub.kind} onChange={(e) => updatePublication(index, { kind: e.target.value as DoctorPublicationKind })}>
                  {KIND_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="space-y-1 text-xs font-medium text-foreground/70">
                Yıl
                <Input type="number" min={1950} value={pub.year} onChange={(e) => updatePublication(index, { year: Number(e.target.value) })} />
              </label>
              <label className="space-y-1 text-xs font-medium text-foreground/70 sm:col-span-2">
                Başlık
                <Input value={pub.title} maxLength={300} onChange={(e) => updatePublication(index, { title: e.target.value })} />
              </label>
              <label className="space-y-1 text-xs font-medium text-foreground/70">
                Dergi/Kongre/Kitap Adı
                <Input value={pub.venue} maxLength={200} onChange={(e) => updatePublication(index, { venue: e.target.value })} />
              </label>
              <label className="space-y-1 text-xs font-medium text-foreground/70">
                Yazarlar (opsiyonel)
                <Input
                  value={pub.authors ?? ""}
                  maxLength={300}
                  placeholder="Aydemir E., Bennett L. ve ark."
                  onChange={(e) => updatePublication(index, { authors: e.target.value || null })}
                />
              </label>
              <label className="space-y-1 text-xs font-medium text-foreground/70">
                DOI (opsiyonel)
                <Input value={pub.doi ?? ""} maxLength={120} onChange={(e) => updatePublication(index, { doi: e.target.value || null })} />
              </label>
              <label className="space-y-1 text-xs font-medium text-foreground/70">
                URL (opsiyonel, yalnızca https://)
                <Input
                  type="url"
                  value={pub.url ?? ""}
                  maxLength={500}
                  placeholder="https://"
                  onChange={(e) => updatePublication(index, { url: e.target.value || null })}
                />
              </label>
            </div>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Yayını kaldır" onClick={() => removePublication(index)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={publications.length >= MAX_PUBLICATIONS}
        onClick={addPublication}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Yayın Ekle
      </Button>
    </div>
  );
}
