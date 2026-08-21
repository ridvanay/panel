import { ShieldAlert } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { CUSTOM_HTML_MAX_LENGTH, type CustomHtmlBlock } from "@/lib/page-builder/types";

export function CustomHtmlBlockEditor({ block, onChange }: { block: CustomHtmlBlock; onChange: (block: CustomHtmlBlock) => void }) {
  const remaining = CUSTOM_HTML_MAX_LENGTH - block.data.html.length;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Kaydedilirken kod güvenlik için otomatik temizlenir: <code>script</code>/<code>style</code>{" "}
          etiketleri ve tıklama/olay öznitelikleri (<code>onclick</code> vb.) her zaman kaldırılır.
          Yalnızca <code>http(s)</code> kaynaklı <code>iframe</code> (harici widget/harita gömme
          için) izin verilir.
        </span>
      </div>
      <Field id={`${block.id}-html`} label="HTML kodu" hint={`${remaining} karakter kaldı.`}>
        {(inputProps) => (
          <Textarea
            {...inputProps}
            rows={10}
            className="font-mono text-xs"
            placeholder='<iframe src="https://www.google.com/maps/embed?..." width="600" height="450"></iframe>'
            value={block.data.html}
            onChange={(e) => onChange({ ...block, data: { ...block.data, html: e.target.value.slice(0, CUSTOM_HTML_MAX_LENGTH) } })}
          />
        )}
      </Field>
    </div>
  );
}
