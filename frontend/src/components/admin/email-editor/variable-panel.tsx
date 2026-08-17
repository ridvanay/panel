import { useMemo, useState } from "react";
import { Info, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { StyleSectionLabel } from "./style-controls";
import { CUSTOM_VARIABLE_KEY_PATTERN, slugifyVariableKey } from "@/lib/email-blocks/variable-key";
import type { VariableTarget } from "@/hooks/use-variable-target";
import type { EmailCustomVariable, EmailVariableDefinition } from "@/lib/api/types";

const GROUP_LABEL: Record<EmailVariableDefinition["source"] | "global", string> = {
  global: "Genel",
  system: "Sistem Değişkenleri",
  "contact-field": "Form Alanları",
  custom: "Özel Değişkenler",
};

const GLOBAL_KEYS = new Set(["site_name", "site_url"]);

function groupVariables(variables: EmailVariableDefinition[]) {
  const global: EmailVariableDefinition[] = [];
  const system: EmailVariableDefinition[] = [];
  const contactField: EmailVariableDefinition[] = [];
  const custom: EmailVariableDefinition[] = [];
  for (const v of variables) {
    if (v.source === "system" && GLOBAL_KEYS.has(v.key)) global.push(v);
    else if (v.source === "system") system.push(v);
    else if (v.source === "contact-field") contactField.push(v);
    else custom.push(v);
  }
  return { global, system, contactField, custom };
}

/**
 * BUG DÜZELTMESİ (qa-agent, design-notes §A.7 ihlali) — `variables` prop'u yalnızca sunucudan EN
 * SON YÜKLEMEDE gelen (kaydedilmiş) listeyi taşır. Kullanıcının editörde henüz KAYDETMEDEN
 * tanımladığı yeni özel değişkenler (`customVariables`, bellek içi) bu listede YOKTUR — birleşim
 * yapılmazsa "Eklenen değişken ANINDA 'Özel Değişkenler' grubunun listesine düşer" davranışı
 * (design-notes §A.7, bağlayıcı) ihlal edilir. `variables` içinde ZATEN bulunan bir anahtar
 * (kaydedilmiş) varsa bellek içi kopyası ile ÇAKIŞMAZ — sunucu sürümü öncelikli kalır.
 */
function mergeCustomVariables(
  variables: EmailVariableDefinition[],
  customVariables: EmailCustomVariable[]
): EmailVariableDefinition[] {
  const existingKeys = new Set(variables.map((v) => v.key));
  const pendingOnly = customVariables
    .filter((cv) => !existingKeys.has(cv.key))
    .map((cv): EmailVariableDefinition => ({ key: cv.key, label: cv.label, sampleValue: cv.sampleValue, source: "custom" }));
  return [...variables, ...pendingOnly];
}

function VariableRow({ variable, disabled, onInsert }: { variable: EmailVariableDefinition; disabled: boolean; onInsert: (key: string) => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onInsert(variable.key)}
      className="flex w-full flex-col items-start gap-0.5 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-border/60 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="text-sm font-medium text-foreground">{variable.label}</span>
      <span className="font-mono text-xs text-foreground/50">{`{{${variable.key}}}`}</span>
    </button>
  );
}

function VariableGroup({
  title,
  variables,
  disabled,
  onInsert,
}: {
  title: string;
  variables: EmailVariableDefinition[];
  disabled: boolean;
  onInsert: (key: string) => void;
}) {
  if (variables.length === 0) return null;
  return (
    <div className="space-y-1">
      <StyleSectionLabel>{title}</StyleSectionLabel>
      <div className="space-y-0.5">
        {variables.map((v) => (
          <VariableRow key={v.key} variable={v} disabled={disabled} onInsert={onInsert} />
        ))}
      </div>
    </div>
  );
}

const MAX_CUSTOM_VARIABLES = 20;

/**
 * §A.3 + §A.7 — gruplu + aramalı değişken paneli (Genel/Sistem/Form Alanları/Özel), ≥8 toplam
 * değişkende arama kutusu; hedef yokken TÜM satırlar disabled + bilgi çubuğu. Özel değişken
 * ekleme formu inline genişler (modal DEĞİL).
 */
export function VariablePanel({
  variables,
  customVariables,
  onAddCustomVariable,
  target,
}: {
  variables: EmailVariableDefinition[];
  customVariables: EmailCustomVariable[];
  onAddCustomVariable: (variable: EmailCustomVariable) => void;
  target: VariableTarget;
}) {
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [sampleValue, setSampleValue] = useState("");

  // Sunucudan yüklenmiş + editörde henüz kaydedilmemiş özel değişkenlerin BİRLEŞİMİ — panelin
  // TÜM türetimleri (gruplama, arama, çakışma kontrolü, arama-kutusu eşiği) BUNDAN beslenir.
  const allVariables = useMemo(() => mergeCustomVariables(variables, customVariables), [variables, customVariables]);

  const key = slugifyVariableKey(label);
  const keyConflict = key.length > 0 && allVariables.some((v) => v.key === key);
  const canAddMore = customVariables.length < MAX_CUSTOM_VARIABLES;

  const filtered = useMemo(() => {
    if (!query.trim()) return allVariables;
    const q = query.trim().toLowerCase();
    return allVariables.filter((v) => v.label.toLowerCase().includes(q) || v.key.toLowerCase().includes(q));
  }, [allVariables, query]);

  const groups = groupVariables(filtered);
  const showSearch = allVariables.length >= 8;

  function resetForm() {
    setLabel("");
    setSampleValue("");
    setFormOpen(false);
  }

  function handleAdd() {
    if (!key || keyConflict || !sampleValue.trim() || !CUSTOM_VARIABLE_KEY_PATTERN.test(key)) return;
    onAddCustomVariable({ key, label: label.trim(), sampleValue: sampleValue.trim() });
    resetForm();
  }

  return (
    <div className="space-y-3">
      <StyleSectionLabel>Değişkenler</StyleSectionLabel>

      {!target.hasTarget && (
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-surface-muted px-3 py-2 text-xs text-foreground/60">
          <Info className="h-3.5 w-3.5 shrink-0" />
          Önce bir metin alanına tıklayın
        </div>
      )}

      {showSearch && (
        <InputGroup className="h-8">
          <InputGroupAddon align="inline-start">
            <Search className="h-3.5 w-3.5 text-foreground/40" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Değişken ara"
            placeholder="Değişken ara…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>
      )}

      <div className="space-y-3">
        <VariableGroup title={GROUP_LABEL.global} variables={groups.global} disabled={!target.hasTarget} onInsert={target.insertVariable} />
        <VariableGroup title={GROUP_LABEL.system} variables={groups.system} disabled={!target.hasTarget} onInsert={target.insertVariable} />
        <VariableGroup
          title={GROUP_LABEL["contact-field"]}
          variables={groups.contactField}
          disabled={!target.hasTarget}
          onInsert={target.insertVariable}
        />
        <VariableGroup title={GROUP_LABEL.custom} variables={groups.custom} disabled={!target.hasTarget} onInsert={target.insertVariable} />
      </div>

      {canAddMore &&
        (formOpen ? (
          <div className="space-y-2.5 rounded-lg border border-border/60 bg-surface-muted/60 p-3">
            <div className="space-y-1">
              <label htmlFor="custom-var-label" className="block text-xs font-medium text-foreground/70">
                Etiket
              </label>
              <Input
                id="custom-var-label"
                className="h-8"
                placeholder="ör. Telefon Numarası"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                autoFocus
              />
              <p className="font-mono text-xs text-foreground/50">Anahtar: {`{{${key || "…"}}}`}</p>
              {keyConflict && <p className="text-xs text-danger">Bu anahtar zaten kullanılıyor</p>}
            </div>
            <div className="space-y-1">
              <label htmlFor="custom-var-sample" className="block text-xs font-medium text-foreground/70">
                Örnek Değer
              </label>
              <Input
                id="custom-var-sample"
                className="h-8"
                placeholder="ör. 0555 000 00 00"
                value={sampleValue}
                onChange={(e) => setSampleValue(e.target.value)}
              />
              <p className="text-xs text-foreground/40">Test gönderiminde bu değer kullanılır</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={resetForm}>
                Vazgeç
              </Button>
              <Button type="button" size="sm" disabled={!key || keyConflict || !sampleValue.trim()} onClick={handleAdd}>
                Ekle
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs font-medium text-foreground/60 hover:border-foreground/30 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Özel Değişken Ekle
          </button>
        ))}
    </div>
  );
}
