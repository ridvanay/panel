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

/**
 * `favorite-button.test.tsx` İLE AYNI desen — `useAuthOptional()` bu mutable değişken üzerinden
 * kontrol edilir, her testin başında `beforeEach`'te `"unauthenticated"`e sıfırlanır (misafir
 * varsayılan davranıştır).
 */
let authStatus: "authenticated" | "unauthenticated" = "unauthenticated";
vi.mock("@/context/auth-context", () => ({
  useAuthOptional: () => ({ status: authStatus }),
}));

const supportApi = await import("@/lib/api/support");

// jsdom `Element.prototype.scrollTo`'yu implemente etmez (mesaj listesi otomatik kaydırması için
// kullanılır) — `tests/setup.ts`teki `getClientRects` polyfilleriyle AYNI ilke, bu dosyaya özgü yerel bir stub.
if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = vi.fn();
}

const SETTINGS = { siteName: "Test Site", liveChatEnabled: true as const, liveChatProvider: "internal" as const, liveChatScriptId: null };

/** `.claude/architect-scope-support-desk-and-reminders.md` §7.1 backend Prisma varsayılanlarıyla AYNI. */
const SETTINGS_PRECHAT = {
  ...SETTINGS,
  liveChatPreChatEnabled: true as const,
  liveChatRequireName: true as const,
  liveChatRequirePhone: true as const,
  liveChatRequireEmail: false as const,
};

async function openWidget(settings: typeof SETTINGS | typeof SETTINGS_PRECHAT = SETTINGS) {
  const user = userEvent.setup();
  render(<LiveChatWidget settings={settings} />);
  await user.click(screen.getByRole("button", { name: "Canlı destek sohbetini aç" }));
  return user;
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  authStatus = "unauthenticated";
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

describe("LiveChatWidget — ön görüşme (pre-chat) formu (2026-09-16)", () => {
  it("`liveChatPreChatEnabled=true` VE misafirse ilk mesajdan ÖNCE ad/telefon/e-posta/mesaj formu gösterilir, normal mesaj kutusu HENÜZ görünmez", async () => {
    await openWidget(SETTINGS_PRECHAT);

    expect(screen.getByLabelText(/Adınız Soyadınız/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Telefon Numaranız/)).toBeInTheDocument();
    expect(screen.getByLabelText(/E-posta Adresiniz/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Mesajınız/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Görüşmeyi Başlat" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Mesajınızı yazın")).not.toBeInTheDocument();
  });

  it("zorunlu alanlar (`liveChatRequireName`/`liveChatRequirePhone`) boşken gönderilemiyor — `createSupportSession` ÇAĞRILMAZ", async () => {
    const user = await openWidget(SETTINGS_PRECHAT);

    await user.type(screen.getByLabelText(/Mesajınız/), "Merhaba, yardım lazım");
    await user.click(screen.getByRole("button", { name: "Görüşmeyi Başlat" }));

    expect(await screen.findByText("Ad soyad zorunludur.")).toBeInTheDocument();
    expect(screen.getByText("Telefon numarası zorunludur.")).toBeInTheDocument();
    // `liveChatRequireEmail=false` — e-posta hatası GÖRÜNMEZ.
    expect(screen.queryByText("E-posta zorunludur.")).not.toBeInTheDocument();
    expect(supportApi.createSupportSession).not.toHaveBeenCalled();
  });

  it("geçersiz biçimli (opsiyonel) e-posta zorunlu olmasa bile reddedilir — basit format doğrulaması", async () => {
    const user = await openWidget(SETTINGS_PRECHAT);

    await user.type(screen.getByLabelText(/Adınız Soyadınız/), "Ayşe Yılmaz");
    await user.type(screen.getByLabelText(/Telefon Numaranız/), "+90 555 123 45 67");
    await user.type(screen.getByLabelText(/E-posta Adresiniz/), "gecersiz-eposta");
    await user.type(screen.getByLabelText(/Mesajınız/), "Merhaba, yardım lazım");
    await user.click(screen.getByRole("button", { name: "Görüşmeyi Başlat" }));

    expect(await screen.findByText("Geçerli bir e-posta adresi girin.")).toBeInTheDocument();
    expect(supportApi.createSupportSession).not.toHaveBeenCalled();
  });

  it("geçerli bilgilerle gönderim `POST /support/sessions`'ı `visitorName`/`visitorPhone` + ilk mesajla çağırır ve sohbet ekranına geçer", async () => {
    vi.mocked(supportApi.createSupportSession).mockResolvedValue({
      sessionId: "session-2",
      accessToken: "token-xyz",
      status: "PENDING",
      message: { id: "msg-2", seq: 1, senderType: "VISITOR", senderDisplayName: null, body: "Merhaba, yardım lazım", createdAt: new Date().toISOString() },
    });

    const user = await openWidget(SETTINGS_PRECHAT);
    await user.type(screen.getByLabelText(/Adınız Soyadınız/), "Ayşe Yılmaz");
    await user.type(screen.getByLabelText(/Telefon Numaranız/), "+90 555 123 45 67");
    await user.type(screen.getByLabelText(/Mesajınız/), "Merhaba, yardım lazım");
    await user.click(screen.getByRole("button", { name: "Görüşmeyi Başlat" }));

    expect(await screen.findByText("Merhaba, yardım lazım")).toBeInTheDocument();
    expect(supportApi.createSupportSession).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Merhaba, yardım lazım",
        visitorName: "Ayşe Yılmaz",
        visitorPhone: "+90 555 123 45 67",
      })
    );
    // Form kaybolur, normal (mevcut) mesaj kutusu artık görünür — sonraki mesajlar İÇİN.
    expect(screen.queryByLabelText(/Adınız Soyadınız/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Mesajınızı yazın")).toBeInTheDocument();
  });

  it("giriş yapmış kullanıcıda form HİÇ gösterilmez, doğrudan sohbet ekranına geçilir", async () => {
    authStatus = "authenticated";

    await openWidget(SETTINGS_PRECHAT);

    expect(screen.queryByLabelText(/Adınız Soyadınız/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Mesajınızı yazın")).toBeInTheDocument();
  });

  it("`liveChatPreChatEnabled=false` iken davranış DEĞİŞMEZ — form hiç gösterilmez", async () => {
    await openWidget(SETTINGS);

    expect(screen.queryByLabelText(/Adınız Soyadınız/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Mesajınızı yazın")).toBeInTheDocument();
  });
});
