import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Component, type ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { NextRequest } from "next/server";

/**
 * Paket AP — gizli token'lar adres çubuğunda yalnızca `#` parçasında; sayfa okuyup adresten siler, sekmede
 * `sessionStorage`'da tutar, API'ye `X-Access-Token` başlığı ya da POST gövdesiyle gönderir. Eski biçim
 * (`?t=`, `?token=`, yol) 2026-12-21'e kadar okunur ve hemen yeni biçime çevrilir.
 */
const mocks = vi.hoisted(() => ({
  bookingPanel: vi.fn(),
  invoicePanel: vi.fn(),
  room: vi.fn(),
  refresh: vi.fn(),
  reload: vi.fn(),
  replace: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace, push: vi.fn() }),
  notFound: () => mocks.notFound(),
}));
vi.mock("@/lib/page-reload", () => ({ reloadPage: () => mocks.reload() }));
vi.mock("@/components/site/telehealth/patient-booking-detail-panel", () => ({
  PatientBookingDetailPanel: (props: { accessToken?: string }) => {
    mocks.bookingPanel(props);
    return <div data-testid="booking-panel">{props.accessToken ?? "none"}</div>;
  },
}));
vi.mock("@/components/site/telehealth/patient-booking-invoice-panel", () => ({
  PatientBookingInvoicePanel: (props: { accessToken?: string }) => {
    mocks.invoicePanel(props);
    return <div data-testid="invoice-panel">{props.accessToken ?? "none"}</div>;
  },
}));
vi.mock("@/components/site/telehealth/consultation-room", () => ({
  ConsultationRoom: (props: { accessToken?: string }) => {
    mocks.room(props);
    return <div data-testid="room">{props.accessToken ?? "none"}</div>;
  },
}));

import { LEGACY_TOKEN_IN_URL_UNTIL, readHashToken, takeTokenFromLocation, tokenFragment } from "@/lib/access-token-url";
import { ConsultationGate, PatientBookingDetailGate, PatientBookingInvoiceGate } from "@/components/site/telehealth/access-token-gates";
import { BlogPreviewTokenBootstrap } from "@/components/site/blog/blog-preview-token-bootstrap";
import { POST as previewTokenPost } from "@/app/api/blog-preview-token/route";

/** Next'in not-found sınırının test karşılığı. */
class NotFoundBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <div data-testid="not-found" /> : this.props.children;
  }
}

const BEFORE_DEADLINE = new Date("2026-11-10T00:00:00.000Z");
const AFTER_DEADLINE = new Date(LEGACY_TOKEN_IN_URL_UNTIL.getTime() + 1000);

function goTo(url: string) {
  window.history.replaceState(null, "", url);
}
const currentUrl = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: BEFORE_DEADLINE });
  window.sessionStorage.clear();
  Object.values(mocks).forEach((m) => m.mockClear());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  goTo("/");
});

describe("adres yardımcıları", () => {
  it("readHashToken: anahtarlı ve çıplak parça; tokenFragment kodlar", () => {
    expect(readHashToken("#t=abc%2B1&x=2", "t")).toBe("abc+1");
    expect(readHashToken("#token=zz", "token")).toBe("zz");
    expect(readHashToken("#RAW-TOKEN", undefined)).toBe("RAW-TOKEN");
    expect(readHashToken("", "t")).toBeNull();
    expect(tokenFragment("a+b")).toBe("#t=a%2Bb");
    expect(tokenFragment(undefined)).toBe("");
  });

  it("# parçası okunur, adresten silinir (diğer sorgular korunur) ve sessionStorage'a yazılır", () => {
    goTo("/en/patient/bookings/b1?payment=success#t=NEW-TOKEN");
    expect(takeTokenFromLocation({ hashKey: "t", legacyQueryKey: "t", storageKey: "k" })).toBe("NEW-TOKEN");
    expect(currentUrl()).toBe("/en/patient/bookings/b1?payment=success");
    expect(window.sessionStorage.getItem("k")).toBe("NEW-TOKEN");
    // yenileme: adreste token yok → sekme deposundan
    expect(takeTokenFromLocation({ hashKey: "t", legacyQueryKey: "t", storageKey: "k" })).toBe("NEW-TOKEN");
    expect(window.localStorage.length).toBe(0);
  });

  it("eski ?t= geçiş süresinde okunur ve adresten hemen silinir", () => {
    goTo("/en/patient/bookings/b1?t=OLD-TOKEN&payment=cancelled");
    expect(takeTokenFromLocation({ hashKey: "t", legacyQueryKey: "t" })).toBe("OLD-TOKEN");
    expect(currentUrl()).toBe("/en/patient/bookings/b1?payment=cancelled");
  });

  it("süre dolunca eski biçim token sayılmaz ama adresten yine silinir", () => {
    vi.setSystemTime(AFTER_DEADLINE);
    goTo("/reset-password?token=OLD");
    expect(takeTokenFromLocation({ hashKey: "token", legacyQueryKey: "token" })).toBeNull();
    expect(currentUrl()).toBe("/reset-password");
    // yeni biçim süre sonrasında da çalışır
    goTo("/reset-password#token=NEW");
    expect(takeTokenFromLocation({ hashKey: "token", legacyQueryKey: "token" })).toBe("NEW");
  });

  it("eski yol biçimi: token yoldan alınır, adres token'sız yeni yola çevrilir", () => {
    goTo("/en/review/PATH-TOKEN?optout=1");
    const clean = (p: string) => p.replace(/\/[^/]+\/?$/, "");
    expect(takeTokenFromLocation({ legacyPathToken: "PATH-TOKEN", cleanPath: clean })).toBe("PATH-TOKEN");
    expect(currentUrl()).toBe("/en/review?optout=1");
  });
});

describe("API istemcisi", () => {
  function stubFetch(body: unknown = { data: {} }) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("telehealth çağrıları token'ı X-Access-Token başlığıyla taşır, adreste değil", async () => {
    const fetchMock = stubFetch({ data: { id: "b1" } });
    const telehealthApi = await import("@/lib/api/telehealth");
    await telehealthApi.getBooking("b1", "SECRET-1");
    await telehealthApi.cancelBooking?.("b1", "SECRET-1").catch(() => undefined);
    for (const [url, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(url).not.toContain("SECRET-1");
      expect((init.headers as Record<string, string>)["X-Access-Token"]).toBe("SECRET-1");
    }
  });

  it("yorum daveti ve kullanıcı daveti token'ı POST gövdesinde gönderir", async () => {
    const fetchMock = stubFetch({ data: { doctorName: "Dr. X", organizationId: "o1" } });
    const reviewsApi = await import("@/lib/api/reviews");
    const invitationsApi = await import("@/lib/api/invitations");
    await reviewsApi.getReviewInvite("REV-TOKEN");
    await reviewsApi.optOutReviewInvite("REV-TOKEN").catch(() => undefined);
    await invitationsApi.acceptInvitation("INV-TOKEN");
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([u]) => new URL(u).pathname)).toEqual(["/api/v1/reviews/invite/lookup", "/api/v1/reviews/invite/opt-out", "/api/v1/invitations/accept"]);
    for (const [url, init] of calls) {
      expect(url).not.toMatch(/REV-TOKEN|INV-TOKEN/);
      expect(init.method).toBe("POST");
    }
    expect(JSON.parse(String(calls[0]![1].body))).toEqual({ token: "REV-TOKEN" });
    expect(JSON.parse(String(calls[2]![1].body))).toEqual({ token: "INV-TOKEN" });
  });
});

describe("sayfa sarmalayıcıları (panel/oda bileşenleri değişmez, aynı prop)", () => {
  it("rezervasyon: #t= okunur, adres temizlenir, panel token'ı alır; fatura aynı sekmede depodan alır", async () => {
    goTo("/en/patient/bookings/b1#t=BOOK-TOKEN");
    render(<PatientBookingDetailGate bookingId="b1" lang="en" />);
    expect(await screen.findByTestId("booking-panel")).toHaveTextContent("BOOK-TOKEN");
    expect(currentUrl()).toBe("/en/patient/bookings/b1");

    goTo("/en/patient/bookings/b1/invoice");
    render(<PatientBookingInvoiceGate bookingId="b1" />);
    expect(await screen.findByTestId("invoice-panel")).toHaveTextContent("BOOK-TOKEN");
  });

  it("görüşme odası: eski ?t= geçiş süresinde çalışır ve adres temizlenir", async () => {
    goTo("/en/consultation/a1?t=ROOM-TOKEN");
    render(<ConsultationGate appointmentId="a1" />);
    expect(await screen.findByTestId("room")).toHaveTextContent("ROOM-TOKEN");
    expect(currentUrl()).toBe("/en/consultation/a1");
  });

  it("görüşme odası: süre dolunca eski ?t= yok sayılır (oda token'sız açılır → kendi erişim kapısı)", async () => {
    vi.setSystemTime(AFTER_DEADLINE);
    goTo("/en/consultation/a2?t=ROOM-TOKEN");
    render(<ConsultationGate appointmentId="a2" />);
    expect(await screen.findByTestId("room")).toHaveTextContent("none");
    expect(currentUrl()).toBe("/en/consultation/a2");
  });
});

describe("blog önizleme — belirteç çereze", () => {
  it("istemci bileşeni #t='yi POST gövdesiyle gönderir, adresi temizler ve sayfayı TAM yeniler", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    goTo("/en/blog/preview/p1#t=p_session");
    render(<BlogPreviewTokenBootstrap postId="p1" hasContent={false} />);
    await waitFor(() => expect(mocks.reload).toHaveBeenCalledTimes(1));
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(currentUrl()).toBe("/en/blog/preview/p1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/blog-preview-token");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ postId: "p1", token: "p_session", path: "/en/blog/preview/p1" });
  });

  it("belirteç yoksa ve içerik yoksa 404 (notFound)", async () => {
    goTo("/en/blog/preview/p1");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <NotFoundBoundary>
        <BlogPreviewTokenBootstrap postId="p1" hasContent={false} />
      </NotFoundBoundary>
    );
    expect(await screen.findByTestId("not-found")).toBeInTheDocument();
    expect(mocks.notFound).toHaveBeenCalled();
    spy.mockRestore();
  });

  function previewRequest(body: unknown, origin: string | null = "http://siteadi.localhost:3100", proto = "http") {
    const headers: Record<string, string> = { "content-type": "application/json", host: "siteadi.localhost:3100", "x-forwarded-proto": proto };
    if (origin) headers.origin = origin;
    return new NextRequest("http://siteadi.localhost:3100/api/blog-preview-token", { method: "POST", headers, body: JSON.stringify(body) });
  }

  it("uç: çerez HttpOnly + SameSite=Strict, yalnızca o önizleme yoluna; yanıt gövdesinde belirteç yok", async () => {
    const res = await previewTokenPost(previewRequest({ postId: "p1", token: "s_share", path: "/en/blog/preview/p1" }, undefined, "https"));
    expect(res.status).toBe(204);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^blog_preview_p1=s_share;/);
    expect(cookie).toMatch(/Path=\/en\/blog\/preview\/p1/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=strict/i);
    expect(cookie).toMatch(/Secure/i);
    expect(await res.text()).toBe("");
  });

  it("uç: başka origin 403; yol/yazı uyuşmazlığı ve aşırı uzun belirteç 400", async () => {
    expect((await previewTokenPost(previewRequest({ postId: "p1", token: "x", path: "/blog/preview/p1" }, "https://evil.example"))).status).toBe(403);
    expect((await previewTokenPost(previewRequest({ postId: "p1", token: "x", path: "/blog/preview/p1" }, null))).status).toBe(403);
    expect((await previewTokenPost(previewRequest({ postId: "p1", token: "x", path: "/blog/preview/OTHER" }))).status).toBe(400);
    expect((await previewTokenPost(previewRequest({ postId: "p1", token: "x", path: "/admin" }))).status).toBe(400);
    expect((await previewTokenPost(previewRequest({ postId: "p1", token: "x".repeat(401), path: "/blog/preview/p1" }))).status).toBe(400);
    expect((await previewTokenPost(previewRequest({ postId: "p1", token: "s", path: "/blog/preview/p1" }))).headers.get("set-cookie")).not.toMatch(/Secure/i);
  });
});
