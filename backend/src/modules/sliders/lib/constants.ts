/**
 * Gelişmiş Slider / Hero Studio — bkz. `.claude/architect-scope-advanced-slider.md` §2.6
 * (bağlayıcı karar dokümanı). Bu sabitler ÜÇ yerde BİREBİR AYNI olmak ZORUNDADIR:
 * `frontend/src/lib/sliders/types.ts`, bu dosya, ve mimari doküman. Değer değiştirilirse
 * HER ÜÇÜ birlikte güncellenmelidir.
 */

/** Bir slider'ın taşıyabileceği en fazla slayt sayısı (`POST .../slides` bu tavanı zorlar). */
export const MAX_SLIDES_PER_SLIDER = 20;

/** Bir slaytın `layers` dizisindeki en fazla katman sayısı. */
export const MAX_SLIDE_LAYERS = 20;

/** `layers` dizisinin `JSON.stringify` sonrası en fazla byte boyutu (64 KB). */
export const MAX_SLIDE_LAYERS_BYTES = 64 * 1024;

/**
 * Katman çıkış animasyonu VERİ DEĞİL, kod sabitidir (bkz. tasarım notu §3.3). Tüm katmanlar
 * bu süre boyunca `fade` ile çıkar — render motoru (frontend) bu sabiti kullanır, backend
 * yalnızca referans/dokümantasyon amaçlı taşır.
 */
export const SLIDER_LAYER_OUT_DURATION_MS = 300;
