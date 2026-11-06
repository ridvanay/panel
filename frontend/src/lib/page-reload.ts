/** Tam sayfa yenileme — testlerde taklit edilebilsin diye ayrı modülde (jsdom `location.reload` desteklemez). */
export function reloadPage(): void {
  window.location.reload();
}
