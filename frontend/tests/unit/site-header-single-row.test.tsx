import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Locale } from "@/lib/api/types";

/**
 * Paket O (İş 2) — masaüstünde başlık tek satır: kapsayıcılar satır kaydırmaz, logo küçülmez, dar
 * masaüstünde dil seçicide yalnızca bayrak (ad tooltip + aria-label), giriş yalnızca ikon; sığmazsa
 * mobil menüye geçilir. Gerçek ölçümler (6 dil × 1024/1280/1440) raporda Playwright ekran görüntüleriyle.
 */
vi.mock("@/context/locale-alternates-context", () => ({ useLocaleAlternates: () => null, contentKindBasePath: () => "" }));

import { LanguageSwitcher } from "@/components/site/language-switcher";

const LOCALES: Locale[] = [
  { code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: true, enabled: true, sortOrder: 0, hreflang: null },
  { code: "ru", label: "Rusça", nativeLabel: "Русский", isDefault: false, enabled: true, sortOrder: 1, hreflang: null },
];

describe("başlık tek satır", () => {
  it("masaüstü satırı flex-nowrap + whitespace-nowrap; nav satır kaydırmaz; logo shrink-0; sığmazsa mobil menü", () => {
    const src = readFileSync(resolve(__dirname, "../../src/components/site/site-header.tsx"), "utf8");
    expect(src).not.toContain("lg:flex-wrap");
    expect(src).toContain('"hidden flex-nowrap items-center gap-x-3 whitespace-nowrap text-sm lg:flex xl:gap-x-5"');
    expect(src).toContain("lg:shrink-0");
    expect(src).toContain('desktopOverflow ? "lg:flex" : "lg:hidden"');
    expect(src).toContain('<span className="hidden xl:inline">{dict.login}</span>');
  });

  it("dar masaüstünde dil seçicide yalnızca bayrak: ad xl'de görünür, tooltip ve aria-label'da kalır", () => {
    render(<LanguageSwitcher locales={LOCALES} activeLocale={LOCALES[1]!} label="Язык" compactBelowXl />);
    const trigger = screen.getByRole("button", { name: "Язык: Русский" });
    expect(trigger).toHaveAttribute("title", "Русский");
    expect(trigger.querySelector("span[lang='ru']")?.className).toContain("hidden xl:inline");
  });
});
