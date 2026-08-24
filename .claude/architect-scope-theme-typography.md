# architect-scope: Global Tema & Tipografi Yöneticisi → `SiteAppearance` genişletmesi

**Not:** Architect ajanı bu turda tekrar eden `529 Overloaded` (Anthropic API) hatası
yüzünden başlatılamadı; bu analiz orkestratör tarafından architect'in sorumluluğu
kapsamında, aynı okuma disiplinizle (schema.prisma, ARCHITECTURE.md §10.12, mevcut
appearance modülü/paneli, layout.tsx render sözleşmesi) yapılmıştır. Karar bağlayıcıdır;
sıradaki ajanlar (db-agent, backend-agent, ui-designer, frontend-agent, qa-agent) burayı
referans alır.

## Karar: GENİŞLETME, yeni sistem YOK

Kullanıcının istediği "Global Tema & Tipografi Yöneticisi" **zaten var olan
`SiteAppearance` sisteminin bir genişlemesidir** — yeni tablo, yeni route
(`/admin/settings/theme`), yeni endpoint grubu **açılmayacak**. Gerekçe:

- `SiteAppearance` (bkz. `docs/architecture/ARCHITECTURE.md` §10.12, tamamı) zaten
  site-geneli renk (`primaryColor`, `secondaryColor`, `buttonColor`, `buttonTextColor`,
  `linkColor`), tipografi (`headingFont`, `bodyFont`, `baseFontSize`) ve ön ayar
  (`presetKey` → `lib/appearance-presets.ts`) sistemini barındırıyor.
- §10.12.1 tablosu net: "Site nasıl görünür?" sorusunun TEK sahibi `/admin/appearance`.
  Yeni bir `/admin/settings/theme` açmak, dokümanın açıkça yasakladığı "bir alan iki
  ekranda düzenlenir" durumunu yaratır.
- §10.12.2, alan-başına farklı RBAC eşiğini "anti-patern" olarak reddediyor ve
  `SiteSettings`'e (genel `/admin/settings`) yeni kolon eklenmesini de reddediyor —
  kullanıcının "SiteSetting tablosuna ekle" talimatı bu nedenle **uygulanmayacak**.
- Kullanıcının istediği alanların çoğu zaten birebir karşılığa sahip; eksik olanlar
  (`accentColor`, `backgroundColor`, `surfaceColor`, `textColor`, `mutedTextColor`,
  `borderRadius`, `buttonStyle`) mevcut modele **tipli kolon** olarak eklenecek (§10.12.2
  kuralı: JSON blob YOK).

Bu, orkestratörün kullanıcıya önceden sorduğu "architect kararına güven" seçeneğinin
sonucudur — kullanıcı bunu onayladı.

## RBAC sapması — kullanıcıya bildirilmeli

Kullanıcı "sadece ADMIN rolü güncelleyebilsin" dedi. Mevcut `PATCH /admin/appearance` /
`POST /admin/appearance/reset` bugün **ADMIN + MANAGER** (`ROLES_ADMIN_MANAGER`,
`appearance.routes.ts`) eşiğinde. §10.12.2 gerekçe #1 alan-başına RBAC'ı açıkça anti-
patern ilan ettiği için yeni renk/tipografi/bileşen alanları **aynı uca** eklenecek ve
**aynı ADMIN+MANAGER eşiğini** miras alacak — sadece yeni alanlar için ADMIN-only bir
istisna açılmayacak. Bu, kullanıcının lafzından bilinçli bir sapmadır; orkestratör
kullanıcıyı bilgilendirecektir. (Yalnızca `PUT /custom-code/*` zaten ADMIN-only kalır,
bu görevin kapsamı dışında.)

## Şema değişiklikleri — `backend/prisma/schema.prisma`

`SiteAppearance` modeline (satır ~927-1002) eklenecek alanlar, "--- Renkler ---" bloğunun
altına (mevcut `linkColor`'dan sonra):

```prisma
accentColor     String @default("#f59e0b")
backgroundColor String @default("#ffffff")
surfaceColor    String @default("#f9fafb")
textColor       String @default("#111827")
mutedTextColor  String @default("#6b7280")
```

"--- Yazı Tipi ---" bloğundan sonra, yeni "--- Bileşen Stilleri ---" bloğu:

```prisma
borderRadius SiteBorderRadius @default(MD)
buttonStyle  SiteButtonStyle  @default(SOLID)
```

Yeni enum'lar (diğer küçük enum'ların yanına, `SiteFont`'tan önce/sonra):

```prisma
enum SiteBorderRadius {
  NONE
  SM
  MD
  LG
  FULL
}

enum SiteButtonStyle {
  SOLID
  OUTLINE
  SOFT
}
```

`SiteFont` enum'una (satır ~903-913) iki değer eklenecek: `PLUS_JAKARTA_SANS`, `OUTFIT`
(next/font/google'da her ikisi de mevcut — kapalı enum kısıtı §10.12.3 ile uyumlu).

db-agent: migration adı `add_site_appearance_theme_tokens` gibi tanımlayıcı olsun,
`prisma migrate dev` ile üret. Mevcut satır varsa (`site_appearance` tablosunda tek
satır ya hiç yok ya da `id="singleton"`) yeni kolonlar `@default` sayesinde sorunsuz
eklenir, veri kaybı riski yok.

## Backend değişiklikleri

Yeni dosya YOK — mevcut dosyalar genişletilir:

- `backend/src/schemas/entities.ts`: `HexColorSchema` yeniden kullanılarak 5 yeni renk
  alanı; yeni `SiteBorderRadiusSchema = z.enum(["NONE","SM","MD","LG","FULL"])` ve
  `SiteButtonStyleSchema = z.enum(["SOLID","OUTLINE","SOFT"])`; `SiteFontSchema`'ya
  `PLUS_JAKARTA_SANS`/`OUTFIT` eklenir. Mevcut `SiteAppearanceSchema`/DTO şemalarına
  (satır ~1150-1210 civarı, admin + public iki varyant var) yeni alanlar eklenir.
- `backend/src/modules/appearance/appearance.schemas.ts`: `UpdateSiteAppearanceRequestSchema`
  `.strict()` gövdesine 7 yeni alan (5 × `HexColorSchema.optional()`,
  `SiteBorderRadiusSchema.optional()`, `SiteButtonStyleSchema.optional()`) eklenir. Kısmi
  PATCH semantiği korunur — mevcut desenden sapma yok.
- `backend/src/modules/appearance/appearance.routes.ts`: `DEFAULTS` sabitine (mevcut
  `primaryColor: "#4f46e5"` vb. satırların yanına) yeni alanların varsayılanları eklenir
  (Prisma `@default` değerleriyle **birebir aynı** tutulmalı — DEFAULTS ile şema
  varsayılanlarının senkron kalması mevcut desenin şartı). RBAC preHandler'ları
  değişmeyecek (yukarıdaki RBAC bölümüne bkz.).
- `backend/src/lib/appearance-presets.ts`: `AppearancePresetValues` interface'ine 7 yeni
  zorunlu alan eklenir; mevcut tüm ön ayarlar (`classic` + varsa `modern`/`minimal`)
  bu yeni alanlar için değer almalı — **renk değerlerini ui-designer belirler**
  (kullanıcının istediği "Modern Mavi, Kurumsal Lacivert, Zümrüt Yeşili, Sıcak Toprak"
  isimleri burada yeni ön ayar girdileri olarak eklenebilir/mevcutların yerini
  alabilir — ui-designer karar verir, backend-agent sadece registry'ye yazar).

## Frontend değişiklikleri

- `frontend/src/lib/api/types.ts`: `PublicSiteAppearance` tipine 7 yeni alan.
- `frontend/src/lib/api/server-appearance.ts`: `DEFAULT_APPEARANCE` sabitine aynı 7
  alan, backend `DEFAULTS` ile birebir aynı değerlerle.
- `frontend/src/lib/site-settings/site-fonts.ts`: `next/font/google`'dan
  `Plus_Jakarta_Sans`, `Outfit` top-level import + `sitePlusJakartaSans`/`siteOutfit`
  const'ları (mevcut 8 fontla AYNI patern — `variable`, `display:"swap"`),
  `SITE_FONT_VARIABLES` dizisine ve `SITE_FONT_FAMILY` map'ine eklenir.
- `frontend/src/lib/site-settings/appearance.ts`: `SITE_FONT_OPTIONS`'a iki yeni giriş
  (`cssFallback` ui-designer'ın Türkçe karakter/okunabilirlik kontrolüyle belirlediği
  sistem yaklaşık fontu).
- **`tailwind.config.ts` YOK bu projede** (Tailwind v4, CSS-first config,
  `postcss.config.mjs` var) — kullanıcının "tailwind.config.ts'yi dinamikleştir" isteği
  bu nedenle **uygulanamaz/gereksizdir**; mevcut desen zaten `globals.css` içinde ham
  CSS custom property + `var()` kullanıyor, o desen genişletilecek.
- `frontend/src/app/globals.css` (satır ~448-481, `.site-scope` bloğu): yeni fallback
  değişkenler eklenir:
  ```css
  --site-accent: #f59e0b;
  --site-background: #ffffff;
  --site-surface: #f9fafb;
  --site-text: #111827;
  --site-muted-text: #6b7280;
  --site-radius: 8px;
  ```
  (`buttonStyle` bir CSS custom property DEĞİL — aşağıya bkz.) `background-color`/`color`
  kurallarının `.site-scope` üzerinde `var(--site-background)`/`var(--site-text)`
  kullanacak şekilde eklenmesi frontend-agent'ın işi; hangi alt elemanların
  (kart/yüzey → `--site-surface`, ikincil metin → `--site-muted-text`) hangi token'ı
  aldığına ui-designer karar verir.
- `frontend/src/app/[lang]/(site)/layout.tsx` (satır ~47-58, `siteScopeStyle`) VE
  `frontend/src/app/admin/appearance/page.tsx` (satır ~660-670 civarı, önizleme
  `siteScopeStyle`'ı) — **İKİSİ DE** senkron güncellenmeli (canlı önizleme ile gerçek
  site aynı sözleşmeyi kullanır, §10.12.9): 6 yeni `--site-*` girişi eklenir
  (`--site-accent`, `--site-background`, `--site-surface`, `--site-text`,
  `--site-muted-text`, `--site-radius` — `SITE_BORDER_RADIUS_PX` map'i üzerinden enum→px
  çözümlenir, ör. `NONE:"0px", SM:"4px", MD:"8px", LG:"16px", FULL:"9999px"`, bu map
  `site-fonts.ts` yanına veya yeni `site-radius.ts`'e frontend-agent tarafından eklenir).
- `buttonStyle` **render sözleşmesine CSS değişkeni olarak GİRMEZ** — bu yapısal bir
  varyanttır (solid/outline/soft farklı sınıf kombinasyonlarıdır, tek bir renk/uzunluk
  değeri değil). `.site-scope` içindeki paylaşılan CTA/buton render noktalarında
  (`SiteHeader` header CTA, ileride eklenecek diğer temalı butonlar — kapsam SADECE
  `site-scope` içindeki mevcut buton render yollarıdır, admin panelinin kendi
  butonları ETKİLENMEZ) frontend-agent üç varyantı koşullu Tailwind sınıflarıyla
  uygular:
  - `SOLID`: `bg-[var(--site-button)] text-[var(--site-button-text)]`
  - `OUTLINE`: `border-2 border-[var(--site-button)] text-[var(--site-button)] bg-transparent`
  - `SOFT`: `bg-[var(--site-button)]/10 text-[var(--site-button)]`
  Köşe yuvarlaklığı her üçünde de `rounded-[var(--site-radius)]` ile ortak.
- Admin UI: **yeni bir sol menü sekmesi/route AÇILMAZ.** Mevcut `/admin/appearance`
  sayfasındaki "Renkler" bölümüne 5 yeni renk seçici, "Tipografi" bölümüne
  `Plus Jakarta Sans`/`Outfit` seçenekleri, ve yeni bir "Bileşen Stilleri" alt-bölümüne
  (Köşe Yuvarlaklığı + Buton Stili görsel radyo butonları) eklenir — hepsi aynı sayfanın
  aynı `PATCH /admin/appearance` ucuna bağlı kalan bölüm-başına-kaydet desenini izler
  (§10.12.9). Hazır palet önerileri (Modern Mavi vb.) mevcut ön ayar (`presetKey`)
  mekanizmasının UI'ı üzerinden sunulur — ayrı bir "palet önerisi" bileşeni İCAT EDİLMEZ.

## Kontrast/erişilebilirlik

§10.12.4 gereği sunucu tarafında sert 422 YOK. Yeni renk çiftleri (`backgroundColor`/
`textColor`, `surfaceColor`/`textColor`, `accentColor`/üzerine binen metin varsa) için de
istemci tarafı **engellemeyen** WCAG AA uyarısı — eşik ve metni ui-designer tanımlar,
mevcut `primaryColor`/`buttonTextColor` kontrol deseniyle aynı bileşen yeniden kullanılır.

## Sıradaki adım

1. **db-agent**: `schema.prisma`'ya yukarıdaki alanları/enum'ları ekle, migration üret
   (`add_site_appearance_theme_tokens`). Mevcut `SiteAppearance` satırlarını bozma.
2. **backend-agent**: entities.ts + appearance.schemas.ts + appearance.routes.ts
   (DEFAULTS) + appearance-presets.ts (interface, presets ui-designer değerleriyle
   birlikte) + openapi.yaml `SiteAppearance`/`UpdateSiteAppearanceRequest` şemaları
   güncellenir. Unit test: yeni alanların PATCH ile kısmi güncellenmesi, `.strict()`
   bilinmeyen alan reddi, ADMIN+MANAGER RBAC.
3. **ui-designer** (backend-agent ile paralel olabilir): 5 yeni renk için varsayılan
   hex değerleri, yeni ön ayar paleti içerikleri (Modern Mavi/Kurumsal Lacivert/Zümrüt
   Yeşili/Sıcak Toprak → `appearance-presets.ts` girdileri), borderRadius/buttonStyle
   radyo buton görselleri, font canlı önizleme kutusu tasarımı, WCAG uyarı eşiği/metni.
4. **frontend-agent**: site-fonts.ts + appearance.ts (SITE_FONT_OPTIONS) + globals.css
   + layout.tsx + admin/appearance/page.tsx (form + önizleme + yeni bölüm) + types.ts +
   server-appearance.ts DEFAULT_APPEARANCE, hepsi yukarıdaki dosya listesine göre.
5. **qa-agent**: DB'ye kayıt, ön yüze ≤60s içinde yansıma (`revalidate: 60`), ADMIN
   dışı rollerin (VIEWER/EDITOR — MANAGER'ın YETKİLİ olduğunu unutma, "ADMIN dışı"
   testi MANAGER'ı değil VIEWER/EDITOR'ü kapsamalı) 403 alması için e2e/birim test.
