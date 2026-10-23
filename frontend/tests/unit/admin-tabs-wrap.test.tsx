import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Paket O (İş 6) — admin filtre sekmeleri dar sütunda yatay kaydırma çubuğu üretmez: liste satır
 * kaydırır (`flex-wrap`, sabit `h-8` yok), sekmeler küçülüp kesilmez (`flex-none`), sayı ayrı rozet.
 */
vi.mock("@/lib/api/support", () => ({}));

import { ContentListTabs } from "@/components/admin/content-list/content-list-tabs";
import { LocaleTabs } from "@/components/admin/locale-tabs";

function assertWraps(list: HTMLElement) {
  expect(list.className).toContain("flex-wrap");
  expect(list.className).toContain("h-auto");
  expect(list.className).not.toContain("overflow-x-auto");
  expect(list.className).not.toContain("flex-nowrap");
}

describe("admin sekmeleri satır kaydırır", () => {
  it("içerik listesi sekmeleri", () => {
    render(<ContentListTabs value="all" onValueChange={() => {}} counts={{ all: 120, published: 80, draft: 30, trashed: 10 }} />);
    assertWraps(screen.getByRole("tablist"));
    for (const tab of screen.getAllByRole("tab")) expect(tab.className).toContain("flex-none");
  });

  it("dil sekmeleri", () => {
    render(
      <LocaleTabs
        locales={[
          { code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: true, enabled: true, sortOrder: 0, hreflang: null },
          { code: "en", label: "İngilizce", nativeLabel: "English", isDefault: false, enabled: true, sortOrder: 1, hreflang: null },
        ]}
        value="tr"
        onValueChange={() => {}}
        statusFor={() => "untranslated"}
      />
    );
    assertWraps(screen.getByRole("tablist"));
  });

  it("Canlı Destek sekmeleri ve CRM ekran gezinmesi kaynakta kaydırma çubuğu kullanmaz", () => {
    const support = readFileSync(resolve(__dirname, "../../src/components/admin/support/support-session-list.tsx"), "utf8");
    expect(support).toContain('className="h-auto w-full max-w-full flex-wrap justify-start gap-1"');
    expect(support).not.toMatch(/TabsList[^>]*overflow-x-auto/);
    const crm = readFileSync(resolve(__dirname, "../../src/app/admin/crm/layout.tsx"), "utf8");
    expect(crm).toContain('<ul className="flex flex-wrap gap-1">');
    expect(crm).not.toContain("min-w-max");
  });
});
