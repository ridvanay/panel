import type { ElementType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LiveChatWidget } from "@/components/site/live-chat-widget";

/**
 * `.claude/architect-scope-support-desk-and-reminders.md` §3 + `.claude/compliance-notes-support-desk.md`
 * §4 — widget gerçek backend'e bağlanır, KVKK/sağlık uyarısı SÜREKLİ görünür ve `sessionStorage`
 * (KESİNLİKLE `localStorage` DEĞİL) ile oturum korunur. Mock'lanan tek dış bağımlılık API
 * çağrılarıdır (`checkout-form.test.tsx` İLE AYNI desen).
 */
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

// `AnimatePresence mode="wait"` gerçek bir tarayıcıda animasyon bitişini bekler; jsdom'da bu asla
// tetiklenmediği için (`requestAnimationFrame`/CSS transition yok) panel hiç mount OLMAZDI. Diğer
// testlerde framer-motion için bir hassasiyet/emsal YOK — bu widget'a özgü, yerel bir stub: motion
// bileşenleri düz DOM elemanlarına, `AnimatePresence` şeffaf bir sarmalayıcıya iner (görsel/animasyon
// bu dosyanın kapsamı DEĞİL, yalnızca DOM/state davranışı test edilir).
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
            Object.entries(props).filter(([key]) => !["initial", "animate", "exit", "transition", "layoutId", "whileHover", "whileTap"].includes(key))
          );
          return <Tag {...domProps}>{children}</Tag>;
        },
    }
  ),
}));

vi.mock("@/lib/api/support", () => ({
  createSupportSession: vi.fn(),
  getSupportMessages: vi.fn(),
  sendSupportMessage: vi.fn(),
}));

vi.mock("@/lib/legal-pages", () => ({
  fetchLegalPagesClient: vi.fn().mockResolvedValue([]),
  resolveKvkkNoticePage: () => null,
}));

const supportApi = await import("@/lib/api/support");

// jsdom `Element.prototype.scrollTo`'yu implemente etmez (mesaj listesi otomatik kaydırması için
// kullanılır) — `tests/setup.ts`teki `getClientRects` polyfilleriyle AYNI ilke, bu dosyaya özgü yerel bir stub.
if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = vi.fn();
}

const SETTINGS = { siteName: "Test Site", liveChatEnabled: true as const, liveChatProvider: "internal" as const, liveChatScriptId: null };

async function openWidget() {
  const user = userEvent.setup();
  render(<LiveChatWidget settings={SETTINGS} />);
  await user.click(screen.getByRole("button", { name: "Canlı destek sohbetini aç" }));
  return user;
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.mocked(supportApi.createSupportSession).mockReset();
  vi.mocked(supportApi.getSupportMessages).mockReset();
  vi.mocked(supportApi.sendSupportMessage).mockReset();
});

describe("LiveChatWidget — Canlı Destek (internal, gerçek backend)", () => {
  it("KVKK/sağlık uyarısı mesaj kutusunun üstünde SÜREKLİ görünür ve kapatma kontrolü YOKTUR", async () => {
    await openWidget();

    expect(
      screen.getByText("Lütfen sağlık durumunuza ilişkin ayrıntı paylaşmayın; tıbbi konular için randevu oluşturun.")
    ).toBeInTheDocument();
    expect(screen.getByText(/KVKK Aydınlatma Metni/)).toBeInTheDocument();
  });

  it("ilk mesaj gönderilince `POST /support/sessions` çağrılır ve `accessToken` yalnızca `sessionStorage`'da saklanır (`localStorage` DEĞİL)", async () => {
    vi.mocked(supportApi.createSupportSession).mockResolvedValue({
      sessionId: "session-1",
      accessToken: "token-abc",
      status: "PENDING",
      message: { id: "msg-1", seq: 1, senderType: "VISITOR", senderDisplayName: null, body: "Merhaba, yardım lazım", createdAt: new Date().toISOString() },
    });

    const user = await openWidget();
    await user.type(screen.getByLabelText("Mesajınızı yazın"), "Merhaba, yardım lazım");
    await user.click(screen.getByRole("button", { name: "Mesajı gönder" }));

    expect(supportApi.createSupportSession).toHaveBeenCalledWith(expect.objectContaining({ message: "Merhaba, yardım lazım" }));
    expect(await screen.findByText("Merhaba, yardım lazım")).toBeInTheDocument();

    const stored = window.sessionStorage.getItem("support-chat-session");
    expect(stored).toContain("token-abc");
    expect(window.localStorage.getItem("support-chat-session")).toBeNull();
  });

  it("kapatılmış oturuma mesaj gönderimi (`SUPPORT_SESSION_CLOSED`) 'Yeni Sohbet Başlat' durumunu gösterir", async () => {
    const { ApiClientError } = await import("@/lib/api/error");
    window.sessionStorage.setItem("support-chat-session", JSON.stringify({ sessionId: "session-1", accessToken: "token-abc" }));
    vi.mocked(supportApi.getSupportMessages).mockResolvedValue({ items: [], meta: { status: "CLOSED", lastSeq: null } });
    vi.mocked(supportApi.sendSupportMessage).mockRejectedValue(
      new ApiClientError(409, { code: "SUPPORT_SESSION_CLOSED", message: "Oturum kapatılmış." })
    );

    const user = await openWidget();
    await screen.findByText("Bu sohbet kapatıldı.");
    expect(screen.getByRole("button", { name: "Yeni Sohbet Başlat" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Yeni Sohbet Başlat" }));
    expect(window.sessionStorage.getItem("support-chat-session")).toBeNull();
    expect(screen.getByLabelText("Mesajınızı yazın")).toBeInTheDocument();
  });
});
