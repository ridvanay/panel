import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Locale } from "@/lib/api/types";

/**
 * Paket M (2026-10-23) — bayraklı dil seçici: yalnızca açık diller, seçili satırda ✓ ve
 * `aria-current`, tek eşleme (en→gb, ar→sa…), eşlemesiz dilde kod rozeti, satır başına `lang`/`dir`,
 * klavye (Enter ile aç, oklarla gez, Esc ile kapat).
 */
vi.mock("@/context/locale-alternates-context", () => ({ useLocaleAlternates: () => null, contentKindBasePath: () => "" }));

import { LanguageSwitcher } from "@/components/site/language-switcher";
import { LOCALE_FLAG_COUNTRY, localeFlagSrc } from "@/lib/i18n/locale-flags";

const loc = (code: string, nativeLabel: string, sortOrder: number, extra: Partial<Locale> = {}): Locale => ({
  code,
  label: nativeLabel,
  nativeLabel,
  isDefault: false,
  enabled: true,
  sortOrder,
  hreflang: null,
  ...extra,
});

const LOCALES: Locale[] = [
  loc("tr", "Türkçe", 0, { isDefault: true }),
  loc("en", "English", 1),
  loc("ar", "العربية", 2),
  loc("pt", "Português", 3),
  loc("de", "Deutsch", 4, { enabled: false }),
];

describe("bayrak eşlemesi", () => {
  it("tek eşleme; bölge alt etiketi yok sayılır; eşlemesiz dil null", () => {
    // Paket T — ro ve Sırpça Latin (`sr-latn` → Sırbistan bayrağı `rs`).
    expect(LOCALE_FLAG_COUNTRY).toEqual({ tr: "tr", en: "gb", ar: "sa", ru: "ru", es: "es", de: "de", fr: "fr", ro: "ro", "sr-latn": "rs" });
    expect(localeFlagSrc("sr-latn")).toBe("/flags/4x3/rs.svg");
    expect(localeFlagSrc("ro")).toBe("/flags/4x3/ro.svg");
    expect(localeFlagSrc("fr")).toBe("/flags/4x3/fr.svg");
    expect(localeFlagSrc("en")).toBe("/flags/4x3/gb.svg");
    expect(localeFlagSrc("ar")).toBe("/flags/4x3/sa.svg");
    expect(localeFlagSrc("en-US")).toBe("/flags/4x3/gb.svg");
    expect(localeFlagSrc("pt")).toBeNull();
  });
});

describe("LanguageSwitcher (dropdown)", () => {
  async function open() {
    const user = userEvent.setup();
    render(<LanguageSwitcher locales={LOCALES} activeLocale={LOCALES[0]!} label="Dil seç" />);
    const trigger = screen.getByRole("button", { name: "Dil seç: Türkçe" });
    return { user, trigger };
  }

  it("tetik: aktif bayrak + ad; aria-expanded açılınca true", async () => {
    const { user, trigger } = await open();
    expect(trigger.querySelector('img[src="/flags/4x3/tr.svg"]')).not.toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
  });

  it("yalnızca açık diller; seçili satırda aria-current + ✓; bayraklar alt=''; satırda lang/dir; kod rozeti", async () => {
    const { user, trigger } = await open();
    await user.click(trigger);
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Türkçe", "English", "العربية", "PTPortuguês"]);
    expect(screen.queryByText("Deutsch")).not.toBeInTheDocument();

    const [tr, en, ar, pt] = items as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    expect(tr).toHaveAttribute("aria-current", "true");
    expect(tr.querySelector("svg")).not.toBeNull(); // ✓
    // Kontrast: seçili satır ve ✓ koyu marka renginde (accent, varsayılan #2951A0) — açık birincil değil.
    expect(tr.className).toContain("text-[var(--site-accent,#2951A0)]");
    expect(tr.querySelector("svg")!.getAttribute("class")).toContain("text-[var(--site-accent,#2951A0)]");
    expect(tr.className).not.toContain("--site-primary");
    expect(en).not.toHaveAttribute("aria-current");
    expect(en.querySelector("svg")).toBeNull();

    expect(en.querySelector("img")).toHaveAttribute("src", "/flags/4x3/gb.svg");
    expect(en.querySelector("img")).toHaveAttribute("alt", "");
    expect(ar.querySelector("img")).toHaveAttribute("src", "/flags/4x3/sa.svg");
    expect(within(pt).getByTestId("locale-flag-code")).toHaveTextContent("PT");
    expect(pt.querySelector("img")).toBeNull();

    const arLabel = within(ar).getByText("العربية");
    expect(arLabel).toHaveAttribute("lang", "ar");
    expect(arLabel).toHaveAttribute("dir", "rtl");
    expect(within(en).getByText("English")).toHaveAttribute("dir", "ltr");
    expect(ar).toHaveAttribute("lang", "ar");
    expect(en).toHaveAttribute("href", "/en");
  });

  it("klavye: Enter ile açılır, ok tuşlarıyla gezinilir, Esc kapatır", async () => {
    const { user, trigger } = await open();
    trigger.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    await screen.findAllByRole("menuitem");

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    const focused = document.activeElement as HTMLElement;
    expect(focused.getAttribute("role")).toBe("menuitem");
    const before = focused.textContent;
    await user.keyboard("{ArrowDown}");
    expect((document.activeElement as HTMLElement).textContent).not.toBe(before);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });
});

describe("LanguageSwitcher (mobil liste)", () => {
  it("aynı satır tasarımı: bayrak, ad, seçili ✓ + aria-current", () => {
    render(<LanguageSwitcher locales={LOCALES} activeLocale={LOCALES[1]!} variant="list" heading="Dil" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(4);
    const en = screen.getByRole("link", { name: /English/ });
    expect(en).toHaveAttribute("aria-current", "true");
    expect(en.querySelector("img")).toHaveAttribute("src", "/flags/4x3/gb.svg");
    expect(en.querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("link", { name: /Türkçe/ })).not.toHaveAttribute("aria-current");
  });
});
