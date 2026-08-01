import "@testing-library/jest-dom/vitest";

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
