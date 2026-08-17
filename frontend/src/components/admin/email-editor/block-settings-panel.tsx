import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import type { VariableTarget } from "@/hooks/use-variable-target";
import type { EmailBlock } from "@/lib/api/types";
import { VariableInput, VariableTextarea } from "./variable-field";
import { EmailRichTextEditor } from "./rich-text-field";
import {
  AlignControl,
  ButtonRadiusControl,
  DividerThicknessControl,
  NullableColorField,
  SpacingControl,
  StyleSection,
} from "./style-controls";

function ContentFields({
  block,
  onChange,
  target,
}: {
  block: EmailBlock;
  onChange: (block: EmailBlock) => void;
  target: VariableTarget;
}) {
  switch (block.type) {
    case "logo-header":
      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-foreground">Site logosunu kullan</p>
              <p className="text-xs text-foreground/60">Kapalıysa aşağıdan özel bir görsel belirtebilirsiniz.</p>
            </div>
            <Switch
              checked={block.data.useSiteLogo}
              onCheckedChange={(checked) => onChange({ ...block, data: { ...block.data, useSiteLogo: checked } })}
            />
          </div>
          {!block.data.useSiteLogo && (
            <ImageUploadField
              id={`${block.id}-logo-url`}
              label="Özel logo"
              value={block.data.logoUrl ?? ""}
              onChange={(logoUrl) => onChange({ ...block, data: { ...block.data, logoUrl: logoUrl || null } })}
            />
          )}
          <Field id={`${block.id}-logo-height`} label="Yükseklik (px)">
            {(inputProps) => (
              <Input
                {...inputProps}
                type="number"
                min={16}
                max={120}
                value={block.data.height}
                onChange={(e) => onChange({ ...block, data: { ...block.data, height: Number(e.target.value) || 40 } })}
              />
            )}
          </Field>
        </div>
      );

    case "heading":
      return (
        <div className="space-y-3">
          <Field id={`${block.id}-heading-text`} label="Başlık metni" required>
            {(inputProps) => (
              <VariableInput
                {...inputProps}
                target={target}
                value={block.data.text}
                onChange={(text) => onChange({ ...block, data: { ...block.data, text } })}
              />
            )}
          </Field>
          <Field id={`${block.id}-heading-level`} label="Boyut">
            {(inputProps) => (
              <Select
                {...inputProps}
                value={block.data.level}
                onChange={(e) => onChange({ ...block, data: { ...block.data, level: Number(e.target.value) as 1 | 2 | 3 } })}
              >
                <option value={1}>Büyük (H1)</option>
                <option value={2}>Orta (H2)</option>
                <option value={3}>Küçük (H3)</option>
              </Select>
            )}
          </Field>
        </div>
      );

    case "text":
      return (
        <EmailRichTextEditor content={block.data.html} onChange={(html) => onChange({ ...block, data: { html } })} target={target} />
      );

    case "button":
      return (
        <div className="space-y-3">
          <Field id={`${block.id}-button-label`} label="Buton metni" required>
            {(inputProps) => (
              <VariableInput
                {...inputProps}
                target={target}
                value={block.data.label}
                onChange={(label) => onChange({ ...block, data: { ...block.data, label } })}
              />
            )}
          </Field>
          <Field id={`${block.id}-button-href`} label="Bağlantı" required hint="http(s)://… veya tek bir {{değişken}}">
            {(inputProps) => (
              <VariableInput
                {...inputProps}
                target={target}
                value={block.data.href}
                onChange={(href) => onChange({ ...block, data: { ...block.data, href } })}
              />
            )}
          </Field>
          <NullableColorField
            id={`${block.id}-button-bg`}
            label="Buton zemini"
            value={block.data.backgroundColor}
            onChange={(backgroundColor) => onChange({ ...block, data: { ...block.data, backgroundColor } })}
            checkAgainst={block.data.textColor ?? "#ffffff"}
          />
          <NullableColorField
            id={`${block.id}-button-text`}
            label="Buton metin rengi"
            value={block.data.textColor}
            onChange={(textColor) => onChange({ ...block, data: { ...block.data, textColor } })}
            checkAgainst={block.data.backgroundColor ?? "#000000"}
          />
          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground/70">Köşe yarıçapı</p>
            <ButtonRadiusControl value={block.data.radius} onChange={(radius) => onChange({ ...block, data: { ...block.data, radius } })} />
          </div>
        </div>
      );

    case "image":
      return (
        <div className="space-y-3">
          <ImageUploadField
            id={`${block.id}-image-url`}
            label="Görsel"
            value={block.data.url}
            onChange={(url) => onChange({ ...block, data: { ...block.data, url } })}
            required
          />
          <Field id={`${block.id}-image-alt`} label="Alt metin" required hint="E-posta istemcileri görselleri varsayılan engeller — tek okunabilir içerik budur.">
            {(inputProps) => (
              <Input
                {...inputProps}
                required
                value={block.data.alt}
                onChange={(e) => onChange({ ...block, data: { ...block.data, alt: e.target.value } })}
              />
            )}
          </Field>
          <div className="space-y-1.5">
            <label htmlFor={`${block.id}-image-width`} className="block text-sm font-medium text-foreground">
              Genişlik
            </label>
            <InputGroup>
              <InputGroupInput
                id={`${block.id}-image-width`}
                type="number"
                placeholder="Otomatik"
                value={block.data.width ?? ""}
                onChange={(e) =>
                  onChange({ ...block, data: { ...block.data, width: e.target.value ? Number(e.target.value) : null } })
                }
              />
              <InputGroupAddon align="inline-end">px</InputGroupAddon>
            </InputGroup>
          </div>
        </div>
      );

    case "divider":
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground/70">Kalınlık</p>
            <DividerThicknessControl value={block.data.thickness} onChange={(thickness) => onChange({ ...block, data: { ...block.data, thickness } })} />
          </div>
          <NullableColorField
            id={`${block.id}-divider-color`}
            label="Renk"
            value={block.data.color}
            onChange={(color) => onChange({ ...block, data: { ...block.data, color } })}
            fallback="#e5e7eb"
          />
        </div>
      );

    case "footer":
      return (
        <Field id={`${block.id}-footer-text`} label="Ek footer metni" hint="Adres/imza gibi ek bilgiler — zorunlu KVKK/uyum footer'ının YERİNE geçmez, ona ek olarak eklenir.">
          {(inputProps) => (
            <VariableTextarea
              {...inputProps}
              target={target}
              rows={3}
              value={block.data.text}
              onChange={(text) => onChange({ ...block, data: { ...block.data, text } })}
            />
          )}
        </Field>
      );
  }
}

/** §A.4 — sağ panelin "İçerik" + "Stil" bölümleri; blok tipine göre içerik alanları değişir, stil bölümü ortaktır. */
export function EmailBlockSettingsPanel({
  block,
  onChange,
  target,
}: {
  block: EmailBlock;
  onChange: (block: EmailBlock) => void;
  target: VariableTarget;
}) {
  return (
    <div className="space-y-4">
      <StyleSection title="İçerik" first>
        <ContentFields block={block} onChange={onChange} target={target} />
      </StyleSection>
      <StyleSection title="Hizalama">
        <AlignControl value={block.style.align} onChange={(align) => onChange({ ...block, style: { ...block.style, align } })} />
      </StyleSection>
      <StyleSection title="Renk">
        <div className="space-y-3">
          <NullableColorField
            id={`${block.id}-style-bg`}
            label="Arka plan"
            value={block.style.backgroundColor}
            onChange={(backgroundColor) => onChange({ ...block, style: { ...block.style, backgroundColor } })}
            checkAgainst={block.style.textColor ?? "#ffffff"}
          />
          <NullableColorField
            id={`${block.id}-style-text`}
            label="Metin"
            value={block.style.textColor}
            onChange={(textColor) => onChange({ ...block, style: { ...block.style, textColor } })}
            checkAgainst={block.style.backgroundColor ?? "#ffffff"}
          />
        </div>
      </StyleSection>
      <StyleSection title="Boşluk">
        <SpacingControl
          paddingY={block.style.paddingY}
          paddingX={block.style.paddingX}
          onChange={(patch) => onChange({ ...block, style: { ...block.style, ...patch } })}
        />
      </StyleSection>
    </div>
  );
}
