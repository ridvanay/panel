"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";

export function PostEditor({ content, onChange }: { content: string; onChange: (html: string) => void }) {
  const editor = useEditor({
    extensions: [StarterKit, Link, Image],
    content,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "prose prose-sm max-w-none focus:outline-none" },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  return <EditorContent editor={editor} className="min-h-[200px] rounded-md border border-input px-3 py-2" />;
}
