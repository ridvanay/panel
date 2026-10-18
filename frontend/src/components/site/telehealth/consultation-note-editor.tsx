"use client";

import { useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { CharacterCount } from "@tiptap/extension-character-count";
import { Placeholder } from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Table as TableIcon,
  Rows3,
  Columns3,
  Trash2,
  Undo2,
  Redo2,
  ClipboardList,
  Pill,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmt, usePortalStrings } from "@/lib/i18n/use-portal-strings";

/**
 * §13.4.1 tadilat turu 4 — doktorun "Seansı Tamamla" akışındaki epikriz/reçete editörü.
 * `post-editor.tsx`'in (blog) toolbar/çerçeve deseninin BİREBİR aynısı, yalnızca bu bağlamda
 * ANLAMSIZ olan görsel/galeri/vurgula/alıntı/kod/yatay-çizgi/bağlantı düğümleri ÇIKARILMIŞTIR
 * (`rich-text-field.tsx`'in StarterKit.configure ile düğüm kapatma deseni İLE AYNI yaklaşım).
 * `Table.configure({ resizable: false })` ZORUNLU — sütun yeniden boyutlandırma `colwidth`
 * attribute'u üretir, bu backend sanitize allow-list'inde YOK.
 */



function ToolbarButton({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(active && "bg-muted text-foreground")}
    >
      {children}
    </Button>
  );
}

export function ConsultationNoteEditor({
  content,
  onChange,
  minHeightClassName = "min-h-[240px]",
}: {
  content: string;
  onChange: (html: string) => void;
  minHeightClassName?: string;
}) {
  // Yalnızca GÖRSEL geri bildirim amaçlı — hangi şablonun EN SON uygulandığını izler, editör
  // içeriğinin o şablonla hâlâ eşleşip eşleşmediğini DOĞRULAMAZ (kullanıcı serbestçe düzenleyebilir).
  const { t } = usePortalStrings();
  const [selectedTemplate, setSelectedTemplate] = useState<"epicrisis" | "prescription" | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        code: false,
        heading: { levels: [2, 3] },
      }),
      // resizable: false BİLİNÇLİ bir karar — sütun yeniden boyutlandırma açılırsa `colwidth`
      // attribute'u üretilir, bu backend sanitize allow-list'inde YOK (kaldırma/değiştirme).
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      CharacterCount,
      Placeholder.configure({ placeholder: t.richEditor.notePlaceholder }),
    ],
    content,
    immediatelyRender: false,
    // TipTap v3'te varsayılan `false` ile aynı davranır — bu olmadan toolbar'daki aktif/basılı
    // durumlar (`editor.isActive(...)`) ve tablo bağlamsal butonları hiçbir kullanıcı
    // etkileşiminden sonra güncellenmez (bkz. `post-editor.tsx` gerekçesi).
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: `prose prose-sm max-w-none focus:outline-none cursor-text ${minHeightClassName}` },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  function applyTemplate(template: "epicrisis" | "prescription") {
    if (!editor) return;
    const isEmpty = editor.getText().trim().length === 0;
    if (!isEmpty) {
      const confirmed = window.confirm(t.richEditor.templateOverwriteConfirm);
      if (!confirmed) return;
    }
    const templateHtml = template === "epicrisis" ? t.richEditor.templateEpicrisisHtml : t.richEditor.templatePrescriptionHtml;
    editor.commands.setContent(templateHtml);
    onChange(editor.getHTML());
    setSelectedTemplate(template);
  }

  return (
    <div className="space-y-2">
      <div className="inline-flex items-center gap-1 rounded-lg border border-input bg-muted/30 p-1">
        <button
          type="button"
          onClick={() => applyTemplate("epicrisis")}
          aria-pressed={selectedTemplate === "epicrisis"}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            selectedTemplate === "epicrisis" ? "bg-surface text-foreground shadow-sm" : "text-foreground/60 hover:text-foreground"
          )}
        >
          <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
          {t.richEditor.templateEpicrisis}
        </button>
        <button
          type="button"
          onClick={() => applyTemplate("prescription")}
          aria-pressed={selectedTemplate === "prescription"}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            selectedTemplate === "prescription" ? "bg-surface text-foreground shadow-sm" : "text-foreground/60 hover:text-foreground"
          )}
        >
          <Pill className="h-3.5 w-3.5" aria-hidden="true" />
          {t.richEditor.templatePrescription}
        </button>
      </div>

      <div className="rounded-lg border border-input transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        <div className="flex flex-wrap items-center gap-1 border-b border-input px-2 py-1.5">
          <ToolbarButton label={t.richEditor.bold} active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()}>
            <Bold />
          </ToolbarButton>
          <ToolbarButton label={t.richEditor.italic} active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}>
            <Italic />
          </ToolbarButton>

          <div className="mx-1 h-5 w-px bg-border" />

          <ToolbarButton
            label={t.richEditor.heading2}
            active={editor?.isActive("heading", { level: 2 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 />
          </ToolbarButton>
          <ToolbarButton
            label={t.richEditor.heading3}
            active={editor?.isActive("heading", { level: 3 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            <Heading3 />
          </ToolbarButton>

          <div className="mx-1 h-5 w-px bg-border" />

          <ToolbarButton
            label={t.richEditor.bulletList}
            active={editor?.isActive("bulletList")}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List />
          </ToolbarButton>
          <ToolbarButton
            label={t.richEditor.orderedList}
            active={editor?.isActive("orderedList")}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered />
          </ToolbarButton>

          <div className="mx-1 h-5 w-px bg-border" />

          <ToolbarButton
            label={t.richEditor.insertTable}
            active={editor?.isActive("table")}
            onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          >
            <TableIcon />
          </ToolbarButton>

          {editor?.isActive("table") && (
            <>
              <ToolbarButton label={t.richEditor.addRow} onClick={() => editor?.chain().focus().addRowAfter().run()}>
                <Rows3 />
              </ToolbarButton>
              <ToolbarButton label={t.richEditor.addColumn} onClick={() => editor?.chain().focus().addColumnAfter().run()}>
                <Columns3 />
              </ToolbarButton>
              <ToolbarButton label={t.richEditor.deleteRow} onClick={() => editor?.chain().focus().deleteRow().run()}>
                <Trash2 />
              </ToolbarButton>
              <ToolbarButton label={t.richEditor.deleteColumn} onClick={() => editor?.chain().focus().deleteColumn().run()}>
                <Trash2 />
              </ToolbarButton>
              <ToolbarButton label={t.richEditor.deleteTable} onClick={() => editor?.chain().focus().deleteTable().run()}>
                <Trash2 />
              </ToolbarButton>
            </>
          )}

          <div className="mx-1 h-5 w-px bg-border" />

          <ToolbarButton label={t.richEditor.undo} onClick={() => editor?.chain().focus().undo().run()}>
            <Undo2 />
          </ToolbarButton>
          <ToolbarButton label={t.richEditor.redo} onClick={() => editor?.chain().focus().redo().run()}>
            <Redo2 />
          </ToolbarButton>
        </div>
        <EditorContent editor={editor} className="px-3 py-2" />
        <div className="border-t border-input px-3 py-1 text-right text-xs text-muted-foreground">
          {fmt(t.richEditor.characters, { count: editor?.storage.characterCount.characters() ?? 0 })}
        </div>
      </div>
    </div>
  );
}
