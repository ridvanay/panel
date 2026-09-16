"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Select } from "@/components/ui/select";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import type { TelehealthStrings } from "@/lib/i18n/site-dictionaries";

/**
 * `.claude/architect-scope-telehealth-template.md` §5.2 — `/doctors` uzmanlık/dil/arama filtresi.
 * URL TEK durum kaynağı (`catalog-toolbar.tsx`'teki AYNI ilke) — sunucu bileşeni (`page.tsx`)
 * `searchParams`'ı okuyup veriyi getirir, bu istemci bileşeni yalnızca URL'i günceller.
 *
 * `.claude/architect-scope-i18n.md` §14.3 — eski sabit `LANGUAGE_NAMES` haritası `Intl.DisplayNames`
 * İLE DEĞİŞTİRİLDİ (elle çevrilen bir harita her yeni dilde N×M bakım borcu üretirdi).
 */

export function DoctorFilters({
  dict,
  locale,
  specialtyOptions,
  languageOptions,
  activeSpecialty,
  activeLanguage,
  activeSearch,
}: {
  /** `dict.telehealth` namespace dilimi — sunucu bileşeni (`doctors/page.tsx`) geçirir (§14.3). */
  dict: TelehealthStrings;
  /** `contentLocaleToIntl(lang)` — `Intl.DisplayNames`'in dil adlarını hangi dilde göstereceği. */
  locale: string;
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

  const languageNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: "language" });
    } catch {
      return null;
    }
  }, [locale]);

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
      <InputGroup className="w-full sm:max-w-xs">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          placeholder={dict.searchPlaceholder}
          aria-label={dict.searchAriaLabel}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
      </InputGroup>

      {specialtyOptions.length > 0 && (
        <Select
          aria-label={dict.specialtyFilterAriaLabel}
          className="w-auto"
          value={activeSpecialty ?? ""}
          onChange={(e) => updateParam("specialty", e.target.value)}
        >
          <option value="">{dict.allSpecialties}</option>
          {specialtyOptions.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}
            </option>
          ))}
        </Select>
      )}

      {languageOptions.length > 0 && (
        <Select
          aria-label={dict.languageFilterAriaLabel}
          className="w-auto"
          value={activeLanguage ?? ""}
          onChange={(e) => updateParam("language", e.target.value)}
        >
          <option value="">{dict.allLanguages}</option>
          {languageOptions.map((code) => (
            <option key={code} value={code}>
              {languageNames?.of(code) ?? code.toUpperCase()}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
