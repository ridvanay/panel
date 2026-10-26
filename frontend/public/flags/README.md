# Bayraklar

Kaynak: [lipis/flag-icons](https://github.com/lipis/flag-icons), sürüm **v7.5.0**, `flags/4x3/` klasörü.
Dosyalar (`tr`, `gb`, `sa`, `ru`, `es`, `de`, `fr`) değiştirilmeden kopyalanmıştır; npm paketi olarak eklenmemiştir.

Lisans: MIT — Copyright (c) 2013 Panayiotis Lipiridis. Tam metin: [`LICENSE`](./LICENSE).

Dil kodu → bayrak eşlemesi tek yerde: `frontend/src/lib/i18n/locale-flags.ts`.

## Paket R (2026-10-26) — ülke bayrakları

Saat dilimi seçicisi ve saat bandı için IANA `zone.tab`'daki tüm ülkelerin (247) bayrakları aynı kaynaktan
(**flag-icons v7.5.0**, `flags/4x3/`, MIT) değiştirilmeden eklendi. Toplam ~2 MB; sayfaya yalnızca görünen
bayraklar `<img loading="lazy">` ile yüklenir (paket/bundle boyutuna etkisi yok). Ülke kodu → dosya eşlemesi:
`frontend/src/lib/country-display.ts::countryFlagSrc`. Bayrak dosyası olmayan ülkede ülke kodu rozeti gösterilir.

