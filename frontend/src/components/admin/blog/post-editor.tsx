"use client";

import { useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { Highlight } from "@tiptap/extension-highlight";
import { CharacterCount } from "@tiptap/extension-character-count";
import { Placeholder } from "@tiptap/extension-placeholder";
import { toast } from "sonner";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  SquareCode,
  Quote,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Minus,
  Undo2,
  Redo2,
  Link as LinkIcon,
  Image as ImageIcon,
  Table as TableIcon,
  Rows3,
  Columns3,
  Trash2,
  Highlighter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MediaPicker } from "@/components/admin/media/media-picker";
import * as mediaApi from "@/lib/api/media";
import type { Media } from "@/lib/api/types";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

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

export function PostEditor({ content, onChange }: { content: string; onChange: (html: string) => void }) {
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  // a11y: editöre eklenecek her görsel için alt metin zorunlu — MediaPicker'dan seçim yapıldıktan
  // sonra doğrudan eklemek yerine bu ara onay adımından geçirilir (bkz. görev notu Faz 2).
  const [pendingMedia, setPendingMedia] = useState<Media | null>(null);
  const [altTextDraft, setAltTextDraft] = useState("");
  const [altTextError, setAltTextError] = useState<string | null>(null);
  const [altTextSubmitting, setAltTextSubmitting] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit,
      Image,
      // resizable: false BİLİNÇLİ bir karar — sütun yeniden boyutlandırma açılırsa `colwidth`
      // attribute'u üretilir, bu backend sanitize allow-list'inde YOK (kaldırma/değiştirme).
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Highlight,
      CharacterCount,
      Placeholder.configure({ placeholder: "İçeriğinizi buraya yazın…" }),
    ],
    content,
    immediatelyRender: false,
    // TipTap v3'te varsayılan `false` ile aynı davranır — bu olmadan toolbar'daki
    // aktif/basılı durumlar (`editor.isActive(...)`) ve tablo bağlamsal butonları
    // hiçbir kullanıcı etkileşiminden sonra güncellenmez (bkz. qa-agent bulgusu).
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: "prose prose-sm max-w-none focus:outline-none" },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  function handleSetLink() {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Bağlantı URL'si", previousUrl ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  function handleInsertImage() {
    if (!editor) return;
    setMediaPickerOpen(true);
  }

  function handleMediaSelect(media: Media) {
    // Görsel doğrudan editöre eklenmez — önce alt metin onay dialoğu açılır (zorunlu a11y adımı).
    setMediaPickerOpen(false);
    setPendingMedia(media);
    setAltTextDraft(media.altText ?? "");
    setAltTextError(null);
  }

  function handleAltTextDialogOpenChange(next: boolean) {
    if (!next) {
      setPendingMedia(null);
      setAltTextDraft("");
      setAltTextError(null);
    }
  }

  async function handleConfirmAltText() {
    if (!pendingMedia) return;
    const trimmed = altTextDraft.trim();
    if (!trimmed) {
      setAltTextError("Alt metin zorunludur.");
      return;
    }

    setAltTextSubmitting(true);
    setAltTextError(null);
    try {
      const updated = await mediaApi.updateMediaAltText(pendingMedia.id, trimmed);
      editor?.chain().focus().setImage({ src: updated.url, alt: trimmed }).run();
      setPendingMedia(null);
      setAltTextDraft("");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setAltTextError(message);
      toast.error(message);
    } finally {
      setAltTextSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-input transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
      <div className="flex flex-wrap items-center gap-1 border-b border-input px-2 py-1.5">
        <ToolbarButton
          label="Kalın"
          active={editor?.isActive("bold")}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold />
        </ToolbarButton>
        <ToolbarButton
          label="İtalik"
          active={editor?.isActive("italic")}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic />
        </ToolbarButton>
        <ToolbarButton
          label="Altı çizili"
          active={editor?.isActive("underline")}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
        >
          <Underline />
        </ToolbarButton>
        <ToolbarButton
          label="Üstü çizili"
          active={editor?.isActive("strike")}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
        >
          <Strikethrough />
        </ToolbarButton>
        <ToolbarButton
          label="Satır içi kod"
          active={editor?.isActive("code")}
          onClick={() => editor?.chain().focus().toggleCode().run()}
        >
          <Code />
        </ToolbarButton>
        <ToolbarButton
          label="Vurgula"
          active={editor?.isActive("highlight")}
          onClick={() => editor?.chain().focus().toggleHighlight().run()}
        >
          <Highlighter />
        </ToolbarButton>

        <div className="mx-1 h-5 w-px bg-border" />

        <ToolbarButton
          label="Başlık 2"
          active={editor?.isActive("heading", { level: 2 })}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 />
        </ToolbarButton>
        <ToolbarButton
          label="Başlık 3"
          active={editor?.isActive("heading", { level: 3 })}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          <Heading3 />
        </ToolbarButton>

        <div className="mx-1 h-5 w-px bg-border" />

        <ToolbarButton
          label="Madde listesi"
          active={editor?.isActive("bulletList")}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <List />
        </ToolbarButton>
        <ToolbarButton
          label="Numaralı liste"
          active={editor?.isActive("orderedList")}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered />
        </ToolbarButton>

        <div className="mx-1 h-5 w-px bg-border" />

        <ToolbarButton
          label="Alıntı"
          active={editor?.isActive("blockquote")}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          <Quote />
        </ToolbarButton>
        <ToolbarButton
          label="Kod bloğu"
          active={editor?.isActive("codeBlock")}
          onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
        >
          <SquareCode />
        </ToolbarButton>
        <ToolbarButton label="Yatay çizgi" onClick={() => editor?.chain().focus().setHorizontalRule().run()}>
          <Minus />
        </ToolbarButton>
        <ToolbarButton label="Bağlantı" active={editor?.isActive("link")} onClick={handleSetLink}>
          <LinkIcon />
        </ToolbarButton>
        <ToolbarButton label="Görsel ekle" onClick={handleInsertImage}>
          <ImageIcon />
        </ToolbarButton>
        <ToolbarButton
          label="Tablo ekle"
          active={editor?.isActive("table")}
          onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        >
          <TableIcon />
        </ToolbarButton>

        {editor?.isActive("table") && (
          <>
            <ToolbarButton label="Satır ekle" onClick={() => editor?.chain().focus().addRowAfter().run()}>
              <Rows3 />
            </ToolbarButton>
            <ToolbarButton label="Sütun ekle" onClick={() => editor?.chain().focus().addColumnAfter().run()}>
              <Columns3 />
            </ToolbarButton>
            <ToolbarButton label="Satır sil" onClick={() => editor?.chain().focus().deleteRow().run()}>
              <Trash2 />
            </ToolbarButton>
            <ToolbarButton label="Sütun sil" onClick={() => editor?.chain().focus().deleteColumn().run()}>
              <Trash2 />
            </ToolbarButton>
            <ToolbarButton label="Tabloyu sil" onClick={() => editor?.chain().focus().deleteTable().run()}>
              <Trash2 />
            </ToolbarButton>
          </>
        )}

        <div className="mx-1 h-5 w-px bg-border" />

        <ToolbarButton label="Geri al" onClick={() => editor?.chain().focus().undo().run()}>
          <Undo2 />
        </ToolbarButton>
        <ToolbarButton label="Yinele" onClick={() => editor?.chain().focus().redo().run()}>
          <Redo2 />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} className="min-h-[200px] px-3 py-2" />
      <div className="border-t border-input px-3 py-1 text-right text-xs text-muted-foreground">
        {editor?.storage.characterCount.characters() ?? 0} karakter
      </div>
      <MediaPicker open={mediaPickerOpen} onOpenChange={setMediaPickerOpen} onSelect={handleMediaSelect} />

      <Dialog open={pendingMedia !== null} onOpenChange={handleAltTextDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alt metin ekle</DialogTitle>
            <DialogDescription>
              Görselin ne gösterdiğini kısaca açıklayın — ekran okuyucu kullanan ziyaretçiler için gereklidir.
            </DialogDescription>
          </DialogHeader>

          {pendingMedia && (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- yüklenen/harici görsel URL'si */}
              <img
                src={pendingMedia.url}
                alt=""
                className="h-16 w-16 shrink-0 rounded-md border border-border object-cover"
              />
              <div className="flex-1">
                <Field id="image-alt-text" label="Alt metin" required error={altTextError ?? undefined}>
                  {(inputProps) => (
                    <Input
                      {...inputProps}
                      value={altTextDraft}
                      onChange={(e) => {
                        setAltTextDraft(e.target.value);
                        if (altTextError) setAltTextError(null);
                      }}
                      placeholder="Örn. Ürünün önden çekilmiş fotoğrafı"
                    />
                  )}
                </Field>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleAltTextDialogOpenChange(false)}>
              Vazgeç
            </Button>
            <Button
              type="button"
              loading={altTextSubmitting}
              disabled={!altTextDraft.trim()}
              onClick={handleConfirmAltText}
            >
              Ekle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
