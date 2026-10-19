import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Paket I (2026-10-19) — dinleyici uyarısının dili bileşenin kendi içinde `useActiveLocaleCode()` ile
 * belirlenir: `en` ile başlıyorsa İngilizce, diğer her durumda Türkçe. Bağlam (provider) yokken de
 * Türkçe görünür; uyarı hiçbir koşulda kaybolmaz. `mockLocale` tanımsızken GERÇEK hook çalışır.
 */
let mockLocale: (() => string) | null = null;
vi.mock("@/context/locale-alternates-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/context/locale-alternates-context")>();
  return { ...actual, useActiveLocaleCode: () => (mockLocale ? mockLocale() : actual.useActiveLocaleCode()) };
});
vi.mock("@livekit/components-react", () => ({ useParticipants: () => [] }));

import {
  QA_LISTENER_DISPLAY_NAME,
  QA_LISTENER_NOTICE_TEXT,
  QaListenerBanner,
  resolveQaListenerNoticeCopy,
} from "@/components/site/telehealth/qa-listener-notice";

const TR_NOTICE = "Kalite kontrol amacıyla yetkili bir WM Health personeli bu görüşmeyi dinliyor.";
const TR_PARTICIPANT = "Katılımcı: WM Health – Kalite Kontrol";
const EN_NOTICE = "An authorised WM Health staff member is listening to this consultation for quality control purposes.";
const EN_PARTICIPANT = "Participant: WM Health – Quality Control";

afterEach(() => {
  mockLocale = null;
});

function expectBanner(notice: string, participant: string) {
  const status = screen.getByRole("status");
  expect(status).toHaveTextContent(notice);
  expect(screen.getByText(participant)).toBeInTheDocument();
  expect(status.querySelector("button")).toBeNull();
}

describe("QaListenerBanner — dil", () => {
  it("TR locale → hukuk onaylı Türkçe metin", () => {
    mockLocale = () => "tr";
    render(<QaListenerBanner />);
    expectBanner(TR_NOTICE, TR_PARTICIPANT);
  });

  it.each(["en", "en-GB", "EN"])("%s locale → hukuk onaylı İngilizce metin", (code) => {
    mockLocale = () => code;
    render(<QaListenerBanner />);
    expectBanner(EN_NOTICE, EN_PARTICIPANT);
    expect(screen.queryByText(TR_NOTICE)).not.toBeInTheDocument();
  });

  it("bağlam (provider) yokken Türkçe görünür", () => {
    render(<QaListenerBanner />);
    expectBanner(TR_NOTICE, TR_PARTICIPANT);
  });

  it("beklenmeyen/boş locale → Türkçe (uyarı kaybolmaz)", () => {
    for (const code of ["", "de", "ar", "  "]) {
      expect(resolveQaListenerNoticeCopy(code).notice).toBe(TR_NOTICE);
    }
    expect(resolveQaListenerNoticeCopy(undefined).notice).toBe(TR_NOTICE);
    expect(resolveQaListenerNoticeCopy(null).participant).toBe(TR_PARTICIPANT);
  });

  it("dışa açık TR sabitleri değişmedi", () => {
    expect(QA_LISTENER_NOTICE_TEXT).toBe(TR_NOTICE);
    expect(QA_LISTENER_DISPLAY_NAME).toBe("WM Health – Kalite Kontrol");
  });
});
