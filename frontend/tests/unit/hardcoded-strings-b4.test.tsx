import fs from "node:fs";
import path from "node:path";
import type { ElementType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Paket U (B4) — sözlüğe taşınan sabit metinler: canlı destek sohbeti, erişilebilirlik etiketleri
 * (yukarı çık, galeri, video, slider), aktivasyon ekranı ve sayfa meta açıklamaları dile göre gelir;
 * taşınan dosyalarda Türkçe sabit metin kalmaz (regresyon taraması).
 */
let activeLocale = "sr-latn";
vi.mock("@/context/locale-alternates-context", () => ({
  useActiveLocaleCode: () => activeLocale,
  useLocalizePath: () => (p: string) => (activeLocale === "en" ? p : `/${activeLocale}${p}`),
  useLocaleAlternates: () => null,
  contentKindBasePath: () => "",
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("email=test@example.com"),
}));
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        ({ children, ...props }: { children?: ReactNode; [k: string]: unknown }) => {
          const Tag = tag as unknown as ElementType;
          const dom = Object.fromEntries(Object.entries(props).filter(([k]) => !["initial", "animate", "exit", "transition", "layoutId", "whileHover", "whileTap"].includes(k)));
          return <Tag {...dom}>{children}</Tag>;
        },
    }
  ),
}));
vi.mock("@/lib/api/support", () => ({ createSupportSession: vi.fn(), getSupportMessages: vi.fn(), sendSupportMessage: vi.fn() }));
vi.mock("@/lib/legal-pages", () => ({ fetchLegalPagesClient: vi.fn().mockResolvedValue([]), resolveKvkkNoticePage: () => null }));
vi.mock("@/context/auth-context", () => ({ useAuthOptional: () => ({ status: "unauthenticated" }), useAuth: () => ({ activateAccount: vi.fn() }) }));
vi.mock("@/components/auth/auth-page-shell", () => ({
  AuthPageShell: ({ title, subtitle, footer, children }: { title: string; subtitle?: string; footer?: ReactNode; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {children}
      {footer}
    </div>
  ),
}));

import { LiveChatWidget } from "@/components/site/live-chat-widget";
import { BackToTopButton } from "@/components/site/back-to-top-button";
import ActivateAccountPage from "@/app/[lang]/(site)/activate-account/page";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";

if (typeof Element.prototype.scrollTo !== "function") Element.prototype.scrollTo = vi.fn();

const TURKISH = /[çğıöşüÇĞİÖŞÜ]/;
const SETTINGS = {
  siteName: "WM Health",
  liveChatEnabled: true as const,
  liveChatProvider: "internal" as const,
  liveChatScriptId: null,
  liveChatPreChatEnabled: true as const,
  liveChatRequireName: true as const,
  liveChatRequirePhone: true as const,
  liveChatRequireEmail: false as const,
};

beforeEach(() => {
  activeLocale = "sr-latn";
  window.sessionStorage.clear();
});

describe("canlı destek sohbeti dile göre", () => {
  it("sr-latn: düğme, ön form, KVKK/sağlık uyarısı ve doğrulama mesajları Latin Sırpça; Türkçe kalıntı yok", async () => {
    const user = userEvent.setup();
    const { container } = render(<LiveChatWidget settings={SETTINGS} />);
    await user.click(screen.getByRole("button", { name: "Otvori čet podrške" }));
    expect(screen.getByRole("form", { name: "Obrazac pre početka četa" })).toBeInTheDocument();
    expect(screen.getByText(/Molimo Vas da ne delite pojedinosti/)).toBeInTheDocument();
    expect(screen.getByText(/Korišćenjem ovog četa prihvatate/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Započni čet" }));
    expect(await screen.findByText("Ime i prezime su obavezni.")).toBeInTheDocument();
    expect(screen.getByText("Broj telefona je obavezan.")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(TURKISH);
  });

  it("tr: mevcut Türkçe metinler korunur", async () => {
    activeLocale = "tr";
    const user = userEvent.setup();
    render(<LiveChatWidget settings={SETTINGS} />);
    await user.click(screen.getByRole("button", { name: "Canlı destek sohbetini aç" }));
    expect(screen.getByText(/KVKK Aydınlatma Metni/)).toBeInTheDocument();
  });
});

describe("erişilebilirlik etiketleri ve aktivasyon ekranı", () => {
  it("yukarı çık düğmesi dile göre", () => {
    activeLocale = "ro";
    render(<BackToTopButton />);
    expect(screen.getByLabelText("Înapoi sus", { selector: "button" })).toBeInTheDocument();
  });

  it("aktivasyon ekranı (fr): başlık, alanlar, düğme ve giriş bağlantısı Fransızca ve dil önekli", async () => {
    activeLocale = "fr";
    const { container } = render(<ActivateAccountPage />);
    expect(await screen.findByText("Activez votre compte")).toBeInTheDocument();
    expect(screen.getByLabelText(/Code de vérification/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activer mon compte" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Vous avez déjà un compte/ })).toHaveAttribute("href", "/fr/login");
    expect(container.textContent).not.toMatch(TURKISH);
  });
});

describe("sözlük ve regresyon taraması", () => {
  it("meta açıklamaları 9 dilde ve yer tutucuları korunmuş", async () => {
    for (const code of ["en", "tr", "es", "de", "ar", "ru", "ro", "fr", "sr-latn"]) {
      const t = (await getSiteDictionary(code)).telehealth;
      expect(t.doctorsMetaDescription, code).toContain("{specialties}");
      expect(t.specialtiesMetaDescription, code).toContain("{specialties}");
      expect(t.specialtyMetaDescription, code).toContain("{specialty}");
      if (code !== "tr") expect(`${t.doctorsMetaDescription}${t.doctorsMetaDescriptionDefault}`, code).not.toMatch(TURKISH);
      const ui = (await getSiteDictionary(code)).ui;
      expect(ui.chatKvkkSentence, code).toContain("{notice}");
    }
  });

  it("taşınan dosyalarda Türkçe sabit metin (yorum dışı string/JSX) kalmadı", () => {
    const root = path.resolve(__dirname, "../../src");
    const files = [
      "components/site/live-chat-widget.tsx",
      "components/site/back-to-top-button.tsx",
      "components/site/advanced-slider/advanced-slider.tsx",
      "components/site/blocks/gallery-block.tsx",
      "components/site/blocks/gallery-lightbox.tsx",
      "components/site/blocks/image-block.tsx",
      "components/site/blocks/video-block.tsx",
      "components/site/blocks/before-after-slider-block.tsx",
      "components/site/blocks/testimonial-block.tsx",
      "components/site/contact-form.tsx",
      "app/[lang]/(site)/activate-account/page.tsx",
      "app/[lang]/(site)/doctors/page.tsx",
      "app/[lang]/(site)/specialties/page.tsx",
      "app/[lang]/(site)/specialties/[slug]/page.tsx",
    ];
    const offenders: string[] = [];
    for (const rel of files) {
      // Yorumlar atlanır (satır numaraları korunur): blok yorum içi, `//`, `*` ve `{/* */}` satırları.
      let inBlock = false;
      const code = fs
        .readFileSync(path.join(root, rel), "utf8")
        .split("\n")
        .map((l) => {
          const t = l.trim();
          if (inBlock) {
            if (t.includes("*/")) inBlock = false;
            return "";
          }
          if (t.startsWith("/*") || t.startsWith("{/*")) {
            if (!t.includes("*/")) inBlock = true;
            return "";
          }
          if (t.startsWith("//") || t.startsWith("*")) return "";
          return l.replace(/\s\/\/\s.*$/, "");
        });
      code.forEach((line, i) => {
        const strings = [...line.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
        const jsxText = [...line.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]);
        for (const v of [...strings, ...jsxText]) if (TURKISH.test(v)) offenders.push(`${rel}:${i + 1} ${v}`);
        if (/^\s*[A-Za-zÇĞİÖŞÜçğıöşü][^<>{}=;()]*$/.test(line) && TURKISH.test(line)) offenders.push(`${rel}:${i + 1} ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
