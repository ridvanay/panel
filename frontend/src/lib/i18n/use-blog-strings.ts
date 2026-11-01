"use client";

import { useActiveLocaleCode } from "@/context/locale-alternates-context";
import { blogStrings as enBlog, type BlogStrings } from "./site-dictionaries/en/blog";
import { blogStrings as trBlog } from "./site-dictionaries/tr/blog";
import { blogStrings as esBlog } from "./site-dictionaries/es/blog";
import { blogStrings as deBlog } from "./site-dictionaries/de/blog";
import { blogStrings as arBlog } from "./site-dictionaries/ar/blog";
import { blogStrings as ruBlog } from "./site-dictionaries/ru/blog";
import { blogStrings as roBlog } from "./site-dictionaries/ro/blog";
import { blogStrings as frBlog } from "./site-dictionaries/fr/blog";
import { blogStrings as srLatnBlog } from "./site-dictionaries/sr-latn/blog";

/** Paket Z1 — blog metinleri (client bileşenler: içindekiler, SSS, paylaşım, doktor kuyruğu); `use-packages-strings.ts` deseni. */
export const BLOG_DICTIONARIES: Record<string, BlogStrings> = {
  en: enBlog,
  tr: trBlog,
  es: esBlog,
  de: deBlog,
  ar: arBlog,
  ru: ruBlog,
  ro: roBlog,
  fr: frBlog,
  "sr-latn": srLatnBlog,
};

export function useBlogStrings(): BlogStrings {
  const lang = useActiveLocaleCode();
  return BLOG_DICTIONARIES[lang] ?? enBlog;
}
