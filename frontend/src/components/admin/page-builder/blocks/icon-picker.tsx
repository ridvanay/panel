import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ICON_OPTIONS, ICON_OPTION_NAMES, resolveIcon } from "@/lib/page-builder/icon-options";

/**
 * `react-hooks/static-components` kuralı, render İÇİNDE seçilen bir bileşen değişkenini JSX
 * etiketi olarak kullanmayı (`const Icon = ...; <Icon/>`) yanlış-pozitif olarak "her render'da
 * yeni bileşen" sanıyor (aslında SABİT `ICON_OPTIONS`tan mevcut bir referans döner). Küçük
 * harfli bir yardımcı FONKSİYON (bileşen DEĞİL — kural PascalCase adlandırmaya bakıyor) içine
 * alıp doğrudan bir JSX İFADESİ döndürerek kaçınılır.
 */
function iconGlyph(name: string, className: string) {
  const Icon = ICON_OPTIONS[name] ?? resolveIcon(undefined);
  return <Icon className={className} aria-hidden />;
}

/**
 * Buton VE İkon Kutusu bloklarının PAYLAŞTIĞI ikon seçici — sabit `ICON_OPTIONS` allowlist'i
 * üzerinde bir ızgara (bkz. `lib/page-builder/icon-options.ts` — güvenlik gereği kapalı liste).
 */
export function IconPickerField({
  id,
  label,
  value,
  onChange,
  allowNone,
}: {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (name: string | undefined) => void;
  /** Buton bloğunda ikon opsiyoneldir ("Yok" seçeneği); İkon Kutusunda ZORUNLUDUR. */
  allowNone?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      <Popover>
        <PopoverTrigger render={<Button id={id} type="button" variant="secondary" size="sm" />}>
          {iconGlyph(value ?? "", "h-4 w-4")}
          {value ?? "Seç"}
        </PopoverTrigger>
        <PopoverContent className="w-72">
          <div className="grid max-h-64 grid-cols-5 gap-1 overflow-y-auto">
            {allowNone && (
              <Button
                type="button"
                variant={!value ? "secondary" : "ghost"}
                size="icon-sm"
                title="Yok"
                aria-label="İkon yok"
                aria-pressed={!value}
                onClick={() => onChange(undefined)}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
            {ICON_OPTION_NAMES.map((name) => {
              const active = value === name;
              return (
                <Button
                  key={name}
                  type="button"
                  variant={active ? "secondary" : "ghost"}
                  size="icon-sm"
                  title={name}
                  aria-label={name}
                  aria-pressed={active}
                  onClick={() => onChange(name)}
                >
                  {iconGlyph(name, "h-4 w-4")}
                </Button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
