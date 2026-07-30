import crypto from "node:crypto";

const COMBINING_MARKS = new RegExp(String.fromCharCode(0x5b, 0x5c, 0x75, 0x30, 0x33, 0x30, 0x30, 0x2d, 0x5c, 0x75, 0x30, 0x33, 0x36, 0x66, 0x5d), "g");

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(COMBINING_MARKS, "") // NFKD sonrası ayrışan aksan işaretlerini (ör. Turkce -> Türkçe) at
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "org"
  );
}

/** Çakışma ihtimaline karşı kısa rastgele son ek ekler; benzersizlik DB unique constraint ile garanti edilir. */
export function slugWithSuffix(base: string): string {
  return `${slugify(base)}-${crypto.randomBytes(3).toString("hex")}`;
}
