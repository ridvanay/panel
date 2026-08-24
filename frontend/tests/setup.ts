import "@testing-library/jest-dom/vitest";
import { expect, vi } from "vitest";
import { toHaveNoViolations } from "jest-axe";

// jest-axe'in `toHaveNoViolations` matcher'ını global `expect`'e ekler — a11y denetim testleri
// (bkz. tests/unit/a11y-*.test.tsx) `expect(results).toHaveNoViolations()` şeklinde kullanır.
expect.extend(toHaveNoViolations);

// `next/font/google` yalnızca Next.js'in kendi derleyici (SWC/Turbopack) boru hattında GERÇEK bir
// fonksiyondur — Vitest bu dönüşümü uygulamıyor, çıplak import derleme HATASI verir ("Inter is not
// a function", bkz. lib/site-settings/site-fonts.ts, `(site)/layout.tsx` ve `/admin/appearance`
// sayfasının kullandığı font yükleyicileri). `next/jest` presetinin yaptığı gibi burada GENEL bir
// sahte (stub) uygulanır — her çağrı `variable`/`className`/`style.fontFamily` döner, gerçek font
// YÜKLEMEZ (teste hiç ihtiyaç da yok, testler görsel font render'ını değil DOM/a11y'yi doğrular).
vi.mock("next/font/google", () => {
  const mockFont = (options?: { variable?: string }) => ({
    variable: options?.variable ?? "--font-mock",
    className: "font-mock",
    style: { fontFamily: "mock-font" },
  });
  return {
    Inter: mockFont,
    Roboto: mockFont,
    Open_Sans: mockFont,
    Montserrat: mockFont,
    Poppins: mockFont,
    Lora: mockFont,
    Playfair_Display: mockFont,
    Source_Serif_4: mockFont,
    Plus_Jakarta_Sans: mockFont,
    Outfit: mockFont,
  };
});

// jsdom `ResizeObserver`'ı implemente etmez; recharts'ın `ResponsiveContainer`'ı (bkz.
// visitor-chart.tsx/activity-bar-chart.tsx/device-breakdown-chart.tsx) mount olurken bunu
// kullanır — polyfill olmadan "ResizeObserver is not defined" ile patlar.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverPolyfill as unknown as typeof ResizeObserver;
}

// jsdom, `Range`/`Element` için `getClientRects`/`getBoundingClientRect` implemente etmez.
// TipTap/ProseMirror tabanlı editörler `.focus()` çağrısında görünürlük hesaplamak için bunu
// kullanır (bkz. EditorView.scrollToSelection) — polyfill olmadan test tamamlansa bile arka
// planda unhandled exception fırlatıp Vitest'in "Unhandled Errors" uyarısına (potansiyel flaky
// test kaynağı) yol açar (bkz. tests/unit/post-editor-media-picker.test.tsx).
if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
}
if (typeof Range !== "undefined") {
  Range.prototype.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} }) as DOMRect;
}
if (typeof Element !== "undefined" && !Element.prototype.getClientRects) {
  Element.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
}
