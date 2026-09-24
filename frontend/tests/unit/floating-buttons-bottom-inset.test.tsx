import type { ElementType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => mockPathname }));
let mockPathname = "/";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: new Proxy(
    {},
    {
      get:
        (_target, tag: string) =>
        ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => {
          const Tag = tag as unknown as ElementType;
          const domProps = Object.fromEntries(
            Object.entries(props).filter(([key]) => !["initial", "animate", "exit", "transition"].includes(key))
          );
          return <Tag {...domProps}>{children}</Tag>;
        },
    }
  ),
}));
vi.mock("@/lib/api/support", () => ({ createSupportSession: vi.fn(), getSupportMessages: vi.fn(), sendSupportMessage: vi.fn() }));
vi.mock("@/lib/legal-pages", () => ({ fetchLegalPagesClient: vi.fn().mockResolvedValue([]), resolveKvkkNoticePage: () => null }));
vi.mock("@/context/auth-context", () => ({ useAuthOptional: () => ({ status: "unauthenticated" }) }));

import { BottomBarInsetObserver, measureBottomInset } from "@/components/site/bottom-bar-inset";
import { LiveChatWidget } from "@/components/site/live-chat-widget";
import { BackToTopButton } from "@/components/site/back-to-top-button";

// jsdom `Element.prototype.scrollTo`'yu implemente etmez (mesaj listesi) — live-chat-widget.test.tsx ile aynı stub.
if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = vi.fn();
}

const SETTINGS = { siteName: "Test", liveChatEnabled: true as const, liveChatProvider: "internal" as const, liveChatScriptId: null };

function bar(top: number, height: number, extra: Partial<CSSStyleDeclaration> = {}) {
  const el = document.createElement("div");
  el.setAttribute("data-bottom-bar", "");
  Object.assign(el.style, extra);
  el.getBoundingClientRect = () => ({ top, height, width: 360, bottom: top + height, left: 0, right: 360, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("style");
  mockPathname = "/";
});

describe("measureBottomInset — alta sabit çubuklar", () => {
  it("görünür çubukların en yükseğinin üst kenarından ekran altına kadar olan mesafe", () => {
    bar(736, 64); // randevu çubuğu (800 px ekran)
    bar(728, 72); // çerez bildirimi
    expect(measureBottomInset(document, 800)).toBe(72);
  });

  it("ekranın altına kaydırılmış, gizli veya boyutsuz çubuklar sayılmaz", () => {
    bar(800, 64); // translate-y-full ile gizli
    bar(700, 100, { display: "none" });
    bar(700, 0);
    expect(measureBottomInset(document, 800)).toBe(0);
  });

  it("gözlemci değeri <html> üzerindeki --site-bottom-inset değişkenine yazar", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    bar(736, 64);
    render(<BottomBarInsetObserver />);
    expect(document.documentElement.style.getPropertyValue("--site-bottom-inset")).toBe("64px");
  });
});

describe("LiveChatWidget — konum", () => {
  it("varsayılan sağ alt; alt çubuk ve güvenli alan payı hesaba katılır", () => {
    render(<LiveChatWidget settings={SETTINGS} />);
    const container = screen.getByRole("button", { name: "Canlı destek sohbetini aç" }).parentElement!;
    expect(container.getAttribute("data-live-chat-position")).toBe("right");
    expect(container.style.right).toBe("1.5rem");
    expect(container.style.bottom).toContain("var(--site-bottom-inset, 0px)");
    expect(container.style.bottom).toContain("env(safe-area-inset-bottom, 0px)");
    expect(document.documentElement.style.getPropertyValue("--site-chat-stack-right")).toBe("4.25rem");
  });

  it("sol alt seçilince düğme ve pencere sola hizalanır", async () => {
    render(<LiveChatWidget settings={{ ...SETTINGS, liveChatPosition: "BOTTOM_LEFT" }} />);
    const container = screen.getByRole("button", { name: "Canlı destek sohbetini aç" }).parentElement!;
    expect(container.getAttribute("data-live-chat-position")).toBe("left");
    expect(container.style.left).toBe("1.5rem");
    expect(container.style.right).toBe("");
    expect(container.className).toContain("items-start");
    await act(async () => {
      screen.getByRole("button", { name: "Canlı destek sohbetini aç" }).click();
    });
    expect(screen.getByRole("dialog").style.maxHeight).toContain("var(--site-bottom-inset, 0px)");
    expect(document.documentElement.style.getPropertyValue("--site-chat-stack-left")).toBe("4.25rem");
    expect(document.documentElement.style.getPropertyValue("--site-chat-stack-right")).toBe("");
  });

  it("görüşme sayfasında hiç render edilmez", () => {
    mockPathname = "/consultation/abc";
    render(<LiveChatWidget settings={SETTINGS} />);
    expect(screen.queryByRole("button", { name: "Canlı destek sohbetini aç" })).toBeNull();
  });
});

describe("BackToTopButton — ortak mekanizma", () => {
  it("alt çubuk, sağdaki sohbet düğmesi ve güvenli alan kadar yukarıda durur", () => {
    const { container } = render(<BackToTopButton />);
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Yukarı çık"]')!;
    expect(button.style.bottom).toContain("var(--site-bottom-inset, 0px)");
    expect(button.style.bottom).toContain("var(--site-chat-stack-right, 0px)");
    expect(button.style.bottom).toContain("env(safe-area-inset-bottom, 0px)");
  });
});
