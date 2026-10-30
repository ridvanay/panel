"use client";

import { useState } from "react";
import { Languages } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { useFriendlyError, usePortalStrings } from "@/lib/i18n/use-portal-strings";
import { setInterpreterRequest } from "@/lib/api/interpreter";

export interface InterpreterOfferLanguage {
  code: string;
  nativeName: string;
}

/**
 * Paket AA — randevu sihirbazının intake adımında opsiyonel "Görüşmede ücretsiz tercüman istiyorum"
 * kutusu. Yalnızca site ayarında `interpreterIncluded=true` iken render edilir (çağıran `languages`
 * verir). Randevu oluşturma kuralına dokunmaz; booking oluştuktan sonra ayrı bir talep kaydı açar
 * (`PUT /appointments/bookings/{id}/interpreter-request`). İşaret kaldırılınca talep silinir.
 */
export function InterpreterRequestBox({
  bookingId,
  accessToken,
  languages,
  defaultLanguage,
}: {
  bookingId: string;
  accessToken?: string;
  languages: InterpreterOfferLanguage[];
  defaultLanguage?: string;
}) {
  const { t } = usePortalStrings();
  const friendlyError = useFriendlyError();
  const initial = languages.find((l) => l.code === defaultLanguage)?.code ?? languages[0]?.code ?? "";
  const [checked, setChecked] = useState(false);
  const [language, setLanguage] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(nextChecked: boolean, nextLanguage: string) {
    setError(null);
    setSaved(false);
    try {
      await setInterpreterRequest(bookingId, nextChecked ? nextLanguage : null, accessToken);
      setSaved(nextChecked);
    } catch (err) {
      // Sunucu kaydetmediyse kutu eski durumuna döner (arayüz ile sunucu ayrışmasın).
      setChecked(!nextChecked);
      setError(friendlyError(err));
    }
  }

  if (languages.length === 0) return null;
  return (
    <div data-testid="interpreter-request-box" className="space-y-3 rounded-[var(--site-radius)] border border-border bg-surface p-4">
      <label className="flex items-start gap-2 text-sm font-medium text-foreground">
        <Checkbox
          checked={checked}
          onCheckedChange={(value: boolean) => {
            setChecked(value);
            void save(value, language);
          }}
        />
        <span className="flex items-center gap-1.5">
          <Languages className="h-4 w-4 text-[var(--site-primary)]" aria-hidden="true" />
          {t.interpreter.requestLabel}
        </span>
      </label>
      {checked && (
        <div className="space-y-1.5 ps-6">
          <label htmlFor="interpreter-request-language" className="block text-xs font-medium text-foreground/70">
            {t.interpreter.requestLanguage}
          </label>
          <Select
            id="interpreter-request-language"
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
              void save(true, e.target.value);
            }}
            className="max-w-60"
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code} lang={l.code}>
                {l.nativeName}
              </option>
            ))}
          </Select>
        </div>
      )}
      {saved && (
        <p id="interpreter-request-hint" role="status" className="text-xs text-foreground/70">
          {t.interpreter.requestSaved} {t.interpreter.bookingNotice}
        </p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
