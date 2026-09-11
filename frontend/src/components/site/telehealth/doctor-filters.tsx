"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Select } from "@/components/ui/select";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

/**
 * `.claude/architect-scope-telehealth-template.md` §5.2 — `/doctors` uzmanlık/dil/arama filtresi.
 * URL TEK durum kaynağı (`catalog-toolbar.tsx`'teki AYNI ilke) — sunucu bileşeni (`page.tsx`)
 * `searchParams`'ı okuyup veriyi getirir, bu istemci bileşeni yalnızca URL'i günceller.
 */
const LANGUAGE_NAMES: Record<string, string> = { tr: "Türkçe", en: "İngilizce", de: "Almanca", fr: "Fransızca", es: "İspanyolca", ar: "Arapça" };

export function DoctorFilters({
  specialtyOptions,
  languageOptions,
  activeSpecialty,
  activeLanguage,
  activeSearch,
}: {
  specialtyOptions: { slug: string; name: string }[];
  languageOptions: string[];
  activeSpecialty?: string;
  activeLanguage?: string;
  activeSearch?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchText, setSearchText] = useState(activeSearch ?? "");
  const committedRef = useRef(activeSearch ?? "");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchText(activeSearch ?? "");
    committedRef.current = activeSearch ?? "";
  }, [activeSearch]);

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  useEffect(() => {
    if (searchText === committedRef.current) return;
    const timer = setTimeout(() => {
      committedRef.current = searchText;
      updateParam("q", searchText.trim());
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `updateParam` her render'da yeniden oluşur, `searchText` yeterli bağımlılıktır (catalog-toolbar.tsx AYNI deseni)
  }, [searchText]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <InputGroup className="w-full sm:max-w-xs border-2 border-border bg-muted">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          placeholder="Doktor adına göre ara..."
          aria-label="Doktor ara"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
      </InputGroup>

      {specialtyOptions.length > 0 && (
        <Select
          aria-label="Uzmanlığa göre filtrele"
          className="w-auto"
          value={activeSpecialty ?? ""}
          onChange={(e) => updateParam("specialty", e.target.value)}
        >
          <option value="">Tüm uzmanlıklar</option>
          {specialtyOptions.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}
            </option>
          ))}
        </Select>
      )}

      {languageOptions.length > 0 && (
        <Select
          aria-label="Dile göre filtrele"
          className="w-auto"
          value={activeLanguage ?? ""}
          onChange={(e) => updateParam("language", e.target.value)}
        >
          <option value="">Tüm diller</option>
          {languageOptions.map((code) => (
            <option key={code} value={code}>
              {LANGUAGE_NAMES[code] ?? code.toUpperCase()}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
