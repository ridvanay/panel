"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { CharacterCount } from "@tiptap/extension-character-count";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Bold, Italic, Heading2, Heading3, Link as LinkIcon, List, ListOrdered, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * `.claude/architect-scope-doctor-portfolio-identity-console.md` (**[DPI]**) §1.2/§1.4 —
 * `DoctorProfile.aboutHtml` (uzun biyografi) editörü. Projede ZATEN kurulu Tiptap paketleri
 * KULLANILIR (`@tiptap/react`/`starter-kit`/`extension-link`/`extension-character-count`/
 * `extension-placeholder` — `consultation-note-editor.tsx`/`rich-text-field.tsx` İLE AYNI
 * bağımlılıklar, YENİ bir paket EKLENMEZ). Toolbar bilinçli olarak DAR tutulur (tablo/epikriz
 * şablon butonları YOK — bu bir biyografi editörüdür, `ConsultationNoteEditor`'ın tıbbi not
 * bağlamı BURAYA uygun DEĞİLDİR, bu yüzden o bileşen yeniden kullanılmaz, AYNI toolbar-buton
 * desenine sahip YENİ, dar bir editör kurulur).
 *
 * Yazma yolunda sunucu `lib/html-sanitize.ts::sanitizeRichHtml`'ten GEÇER ([DPI] §1.2) — bu
 * editör istemci tarafında İKİNCİ bir sanitizasyon YAPMAZ, yalnızca üretilen HTML'i taşır.
 */

const MAX_ABOUT_HTML_LENGTH = 20000;

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
    <Button type="button" variant="ghost" size="icon-sm" aria-label={label} aria-pressed={active} onClick={onClick} className={cn(active && "bg-muted text-foreground")}>
      {children}
    </Button>
  );
}

export function DoctorAboutEditor({ content, onChange }: { content: string; onChange: (html: string) => void }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        code: false,
        heading: { levels: [2, 3] },
        link: { openOnClick: false, autolink: false },
      }),
      CharacterCount.configure({ limit: MAX_ABOUT_HTML_LENGTH }),
      Placeholder.configure({ placeholder: "Uzun biyografinizi buraya yazın…" }),
    ],
    content,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: "prose prose-sm max-w-none focus:outline-none cursor-text min-h-[200px]" },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  function handleSetLink() {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Bağlantı URL'si (yalnızca https://)", previousUrl ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-input transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        <div className="flex flex-wrap items-center gap-1 border-b border-input px-2 py-1.5">
          <ToolbarButton label="Kalın" active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()}>
            <Bold />
          </ToolbarButton>
          <ToolbarButton label="İtalik" active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}>
            <Italic />
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

          <ToolbarButton label="Madde listesi" active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
            <List />
          </ToolbarButton>
          <ToolbarButton
            label="Numaralı liste"
            active={editor?.isActive("orderedList")}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered />
          </ToolbarButton>
          <ToolbarButton label="Bağlantı" active={editor?.isActive("link")} onClick={handleSetLink}>
            <LinkIcon />
          </ToolbarButton>

          <div className="mx-1 h-5 w-px bg-border" />

          <ToolbarButton label="Geri al" onClick={() => editor?.chain().focus().undo().run()}>
            <Undo2 />
          </ToolbarButton>
          <ToolbarButton label="Yinele" onClick={() => editor?.chain().focus().redo().run()}>
            <Redo2 />
          </ToolbarButton>
        </div>
        <EditorContent editor={editor} className="px-3 py-2" />
        <div className="border-t border-input px-3 py-1 text-right text-xs text-muted-foreground">
          {editor?.storage.characterCount.characters() ?? 0} / {MAX_ABOUT_HTML_LENGTH} karakter
        </div>
      </div>
    </div>
  );
}
