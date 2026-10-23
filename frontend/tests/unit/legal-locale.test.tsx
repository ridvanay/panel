import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { legalDisplayMode } from "@/lib/legal-locale";
import { LegalBindingVersionsNote } from "@/components/site/legal-document-notice";
import { legalStrings as ar } from "@/lib/i18n/site-dictionaries/ar/legal";

/** Paket L — yasal sayfanın dile göre gösterim modu ve "bağlayıcı sürümler" notu. */
describe("legalDisplayMode", () => {
  const base = { isLegalDocument: true, defaultLocaleCode: "en", translated: false };

  it("yasal olmayan, varsayılan dil veya çevrilmiş sayfa normal içerik", () => {
    expect(legalDisplayMode({ ...base, isLegalDocument: false, lang: "de" })).toBe("content");
    expect(legalDisplayMode({ ...base, lang: "en" })).toBe("content");
    expect(legalDisplayMode({ ...base, lang: "ru", translated: true })).toBe("content");
  });

  it("bağlayıcı dil (tr) çevrilmemişse bildirim; yeni dillerde kanonik metin + not", () => {
    expect(legalDisplayMode({ ...base, lang: "tr" })).toBe("notice");
    for (const lang of ["es", "de", "ar", "ru"]) expect(legalDisplayMode({ ...base, lang })).toBe("binding-fallback");
  });

  it("not ziyaretçinin dilindeki metni gösterir", () => {
    render(<LegalBindingVersionsNote text={ar.bindingVersionsNote} />);
    expect(screen.getByRole("note")).toHaveTextContent(ar.bindingVersionsNote);
  });
});
