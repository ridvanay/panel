# Security Review: `google-map` Bloğu + Kurumsal Blok Genişletmesi

Ajan: **security-agent** · Durum: **karar verildi, bağlayıcı** · Tarih: 2026-08-31
Girdi: `.claude/architect-scope-google-map-corporate-blocks.md` (mimar kararları, §3, §0/4, §9 R2-R4)

Bu doküman mimarın §3.1/§3.2/§3.4 önerilerini **denetler**. Aşağıda her madde için
**ONAYLANDI**, **DEĞİŞTİRİLDİ** veya **SIKILAŞTIRILDI** damgası var. `.claude/CLAUDE.md`
"Çakışma Çözümü" kuralı gereği — güvenlik ile kolaylık çelişirse security-agent önceliklidir —
bu dokümandaki değişiklikler mimarın önerisinin YERİNE geçer; backend-agent VE frontend-agent
kendi başına gevşetemez/sıkılaştıramaz. Kod YAZILMAMIŞTIR; uygulama backend-agent/frontend-agent'a
aittir.

**Tehdit modeli (önemli, kararların temeli):** `Page.blocks`'u her `EDITOR` rolü yazabilir ve bu
JSON public `GET /pages/:slug` yanıtında ham döner. Yani tehdit yalnızca dış saldırgan değil, aynı
zamanda **düşük-ayrıcalıklı/ele geçirilmiş bir EDITOR hesabı**dır — bu hesap `embedUrl` alanına
diğer ADMIN/EDITOR kullanıcılarını (admin önizlemesi üzerinden) veya son ziyaretçileri (public
render üzerinden) hedef alan bir payload yerleştirmeye çalışabilir. CSP kapalı olduğu için bu
saldırı yüzeyine karşı TEK savunma katmanı bu dokümandaki kurallardır.

---

## 1) §3.1 — `apiKey` alanının reddi → **ONAYLANDI, değişiklik yok**

Gerekçe doğru ve tam: `Page.blocks` public API'de ham JSON döner, `EDITOR` rolü de yazar/okur —
bu yüzeyde hiçbir sır (env değişkeni/secret manager dışında) tutulamaz. "Ayrı bir korumalı
site-ayarları katmanında saklanan, blok verisine referansla bağlanan anahtar" alternatifi
**reddedildi**: böyle bir katman (a) bu turun kapsamını bir secrets-storage özelliğine
genişletir (mimarın scope'unda yok), (b) Google Maps Embed API zaten "referrer-restricted public
key" modeliyle tasarlanmıştır — sunucu tarafında gizlenmesi gereken bir sır DEĞİLDİR, HTTP
Referrer kısıtı doğru yapılandırıldığında anahtarın açıkta olması risk taşımaz. Mimarın önerdiği
görünür admin uyarısı (*"Google Cloud Console'da anahtarı HTTP referrer kısıtı ile sınırlandırın"*)
**yeterli ve doğru kontrol**.

**Ek bağlayıcı kural:** `openapi.yaml`'daki `GoogleMapBlock.data` şemasında `apiKey` adında bir
alan **tanımlanamaz**; response örneklerinde/description'da "anahtarı embedUrl'e gömün" ifadesi
açıkça yer almalı (documentation-agent + backend-agent için not).

---

## 2) §3.2 — `embedUrl` beyaz liste regex'i → **ONAYLANDI + SIKILAŞTIRILDI**

Regex'i satır satır bypass açısından denetledim (userinfo-trick `user@host`, çift kodlama,
`\` normalizasyonu, subdomain/homograph, port ekleme, CRLF/whitespace enjeksiyonu, `javascript:`
gömme). **Mimarın orijinal regex'inde istismar edilebilir bir bypass bulamadım** — anchor'lar
(`^...$`), literal host eşleşmesi (host kısmı bir karakter sınıfı değil, sabit string olduğu için
`\s`/`@`/`:`/`\`/homograph enjeksiyonu host'u bozmadan geçemiyor) ve query'deki `[^\s"'<>]` kara
listesi birlikte sağlam. Doğrulanan spesifik senaryolar (hepsi **doğru şekilde reddediliyor**):

- `https://google.com@evil.com/maps/embed?x=1` (userinfo-trick, gerçek host `evil.com`) → reddedilir çünkü `google.com` sonrası `/maps/embed` DEĞİL `@evil.com/maps/embed` geliyor.
- `https://google.com:8080/maps/embed?x=1` (port enjeksiyonu) → aynı sebeple reddedilir.
- `https:/\google.com\maps\embed?x=1` (backslash normalizasyon denemesi) → regex literal `/` bekliyor, backslash eşleşmiyor, reddedilir (fail-closed, browser normalizasyonundan ÖNCE regex zaten reddediyor).
- `https://google.com/maps/embed%2F..%2F@evil.com` (encode edilmiş path) → `%2F` literal `/maps/embed` ile eşleşmiyor, reddedilir.
- `https://translate.google.com/...`, `https://google.com.tr/...`, `https://maps.google.com/...`, `https://goo.gl/maps/...` → hepsi reddedilir (host anchor'ı yalnızca `google.com`/`www.google.com`).
- Query içine `javascript:alert(1)` gömülmesi → zararsız, çünkü scheme zaten `^https:` ile sabitlenmiş; query'deki metin browser tarafından şema olarak yorumlanmaz.

**SIKILAŞTIRMA (defense-in-depth, davranışı DARALTIYOR ama hiçbir bilinen meşru Google embed
URL'ini KIRMAZ):** Query karakter kara listesine backtick (`` ` ``) ve backslash (`\`) eklendi.
Gerekçe: CSP tamamen kapalı olduğu bir sistemde bu string'in gelecekte başka bir tüketici
tarafından (ör. bir SSR şablonu, e-posta önizlemesi, JS template literal içine ham enterpolasyon)
kullanılma ihtimaline karşı ek bir kaçış-karakteri bariyeri; Google'ın gerçek `pb=`/`q=`
parametreleri bu karakterleri hiçbir zaman içermez (yalnızca `!`, rakam, harf, `.`, `,`, `%`
kullanır), yani meşru kullanıcı hiçbir zaman bu kısıtlamaya çarpmaz.

**NİHAİ regex (backend Zod VE frontend `map-embed.ts`'te AYNEN — tek kaynak burasıdır, mimarın
regex'i bu şekilde güncellenmiştir):**

```js
// Yalnızca www.google.com veya google.com host'u, yalnızca /maps/embed (+ 5 sabit /v1/<mod>
// yolu), yalnızca https. Query kısmında boşluk/`"`/`'`/`<`/`>`/backtick/backslash yasak
// (nitelik/HTML/JS-template kaçış yüzeyi). Case-insensitive DEĞİL — bilinçli, bkz. not.
const GOOGLE_MAP_EMBED_URL_RE =
  /^https:\/\/(?:www\.)?google\.com\/maps\/embed(?:\/v1\/(?:place|view|directions|search|streetview))?\?[^\s"'<>`\\]+$/;
```

**Not — case-sensitivity kasıtlıdır, DEĞİŞTİRİLMEMELİ:** Regex `i` bayrağı taşımaz. Google'ın
"Haritayı yerleştir" panelinden kopyalanan URL'ler her zaman küçük harf şema/host üretir. `i`
bayrağı eklemek `HTTPS://GOOGLE.COM/...` gibi girdileri de kabul eder — bu, ileride bir başka
ajanın "kullanıcı deneyimini iyileştirmek" adına regex'i "esnetmesi" durumunda sessizce genişleyen
bir saldırı yüzeyi olur. Büyük/küçük harf uyuşmazlığı nedeniyle 422 alan gerçek bir kullanıcı
olması **beklenmez**; olursa hata mesajı zaten "Google'ın verdiği bağlantıyı olduğu gibi
yapıştırın" der (mimarın 3.2 madde son fıkrası).

**Kurallar (mimarın listesine ek):**
- `SafeHrefSchema` KULLANILMAZ — onaylandı, gerekçe değişmedi.
- Doğrulama başarısız → **422** (yazma anı). Render anında (eski/bozuk kayıt ihtimaline karşı)
  regex'i geçemeyen bir `embedUrl` **sessizce `null`** döner — mimarla birebir aynı, iki katman
  farklı davranır ve bu KASITLIDIR (yazma = kullanıcıyı bilgilendir, okuma = asla patlama).

**Backend-agent için zorunlu unit test matrisi** (mimarın §7.2/4 listesine ek olarak, hepsi 422 beklenir):
`https://google.com@evil.com/maps/embed?x=1`, `https://google.com:8080/maps/embed?x=1`,
`https://www.google.com/maps/embed?x=1<script>`, `` https://www.google.com/maps/embed?x=`1` ``,
`https://www.google.com/maps/embed/v1/placeholder?x=1` (enum-prefix bypass denemesi),
`HTTPS://WWW.GOOGLE.COM/maps/embed?x=1` (case bypass denemesi — 422 kalmalı).

---

## 3) §3.3 — Mod B (adres) URL inşası → **ONAYLANDI + 1 EK KURAL**

`encodeURIComponent(address)` + sabit şablon yaklaşımı doğru; ham enjeksiyon yüzeyi yok, onaylandı.

**Ek kural (mimarın metninde tutarsızlık var, çözüldü):** §3.3 "zoom 1..20 aralığına clamp
edilir" diyor ama §5/4 "zoom: z.number().int().min(1).max(20)" diyor — bu ikisi FARKLI
davranışlardır (clamp = sessizce düzelt, Zod min/max = 422 ile reddet). **Bağlayıcı çözüm:**
- **Yazma anı (Zod, backend):** aralık dışı `zoom` **422 ile reddedilir**, clamp EDİLMEZ (§3.2'nin
  "doğrulama başarısız → 422, sessiz düşürme yok" ilkesiyle tutarlı olması için).
- **Okuma/render anı (`map-embed.ts`):** eski/bozuk kayıtlarda aralık dışı bir `zoom` görülürse
  (Zod'dan ÖNCE yazılmış veri, ya da elle DB müdahalesi) throw ETMEZ, `Math.min(20, Math.max(1,
  zoom ?? 15))` ile **savunma amaçlı clamp** eder. Bu, `video-embed.ts`'in "hiçbir zaman patlamaz"
  desenine uygundur.

**`locale`/`hl` parametresi (mimarın atlamadığı ama açıkça sınırlamadığı bir nokta):** şablondaki
`&hl=${locale}` değeri **ham route param olarak enterpole edilmez**; `locale`, uygulamanın
desteklediği kapalı locale enum'una (`[lang]` route zaten bunu kısıtlıyor) karşı doğrulanmış
olmalı, yoksa sabit bir varsayılana (`"tr"`) düşmelidir. Bugünkü Next.js routing'i bunu zaten
dolaylı olarak garanti ediyor olsa da, `map-embed.ts::getMapEmbedUrl` bunu **kendi içinde de**
(çağıranın routing katmanına güvenmeden) bir `SUPPORTED_LOCALES` kontrolüyle doğrulamalı —
savunma derinliği, `address`'in kendisi zaten `encodeURIComponent`'le güvenli olduğu için asıl risk
yok ama fonksiyonun bağımsız çağrılabilir/test edilebilir kalması için gerekli.

---

## 4) §3.4 — iframe nitelikleri → **KISMEN DEĞİŞTİRİLDİ**

### 4.1 `sandbox` → **DEĞİŞTİRİLDİ (mimarın "v1'de verilmez" kararı REDDEDİLDİ)**

Mimarın gerekçesi — "`allow-same-origin` olmadan Maps çalışmaz, onunla birlikte sandbox'ın faydası
kalmıyor" — **yalnızca framelenen içerik ÜST sayfayla AYNI origin olduğunda** geçerli bir
argümandır (o zaman `allow-scripts + allow-same-origin` birlikte, iframe içindeki scriptin kendi
sandbox niteliğini DOM üzerinden kaldırıp tam kaçış yapmasına izin verir). Burada framelenen
içerik `google.com` — bizim origin'imizle **farklı origin** — dolayısıyla `allow-same-origin`
iframe'e yalnızca KENDİ (google.com) origin'ini geri verir, bizim sayfamızın DOM'una **hiçbir
şekilde** erişim sağlamaz (Same-Origin Policy tarayıcı seviyesinde zaten ayrı). Yani klasik
"sandbox + allow-same-origin + allow-scripts = sandbox anlamsız" kaçışı **burada uygulanamaz**.

`sandbox` niteliği verilmese bile bu, sandbox'ın SAĞLADIĞI diğer korumaları (allow-same-origin'den
BAĞIMSIZ olanları) tamamen feda etmek anlamına gelir:
- **Üst pencere navigasyon kaçırma** (`allow-top-navigation` verilmediği sürece iframe içeriği
  `window.top.location`'ı DEĞİŞTİREMEZ — CSP kapalıyken bu, tüm sayfayı başka bir yere yönlendiren
  bir tıklama tuzağına karşı KALAN TEK bariyer).
- **Zorla dosya indirme** (`allow-downloads` verilmeden iframe içeriği tarayıcıya indirme
  başlatamaz).
- **İstenmeyen modal/dialog** (`allow-modals` verilmeden `alert`/`confirm`/`print` tetiklenemez).
- **Pointer lock / orientation lock** gibi ikincil API'ler.

CSP `frame-src`/`sandbox` CSP direktifinin OLMADIĞI bu projede, HTML `sandbox` niteliği elimizdeki
**tek** tarayıcı-seviyesi ikincil savunma katmanıdır. Vermemek, "zaten faydasız" değil, "elimizdeki
tek ek katmanı bilerek terk etmek" anlamına gelir. **security-agent önceliklidir** (CLAUDE.md
çakışma kuralı) — bu madde mimarın önerisinin yerine geçer.

**Bağlayıcı nihai değer:**
```
sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
```
- `allow-scripts` + `allow-same-origin`: Maps'in temel çalışması için zorunlu (mimarın tespiti doğru).
- `allow-popups` + `allow-popups-to-escape-sandbox`: "Büyük haritada görüntüle" / katman menüsü
  gibi yeni sekme açan bağlantılar için zorunlu (yoksa sessizce kırılır).
- `allow-forms`: yalnızca `/v1/search` ve `/v1/directions` modlarındaki arama kutusu için gerekli;
  diğer modlarda etkisizdir, zararı yoktur (form yalnızca google.com'a submit olur).
- **Bilinçli olarak DIŞARIDA bırakılanlar:** `allow-top-navigation` (ve `-by-user-activation`
  varyantı), `allow-downloads`, `allow-modals`, `allow-presentation`, `allow-pointer-lock`,
  `allow-orientation-lock`. Bunlardan biri ileride bir QA bulgusu ile (ör. "büyüt" linki üst
  sekmede açılmıyor) gerekli görülürse, **security-agent'a danışılmadan eklenmez**.

**Uygulama kapsamı:** Bu `sandbox` değeri hem public site render'ında (`google-map-block.tsx`) HEM
admin editör kart-içi canlı önizlemede (§4.3 mimarın "mini önizleme" kararı) **AYNEN** kullanılır.
İki ayrı kod yolu farklı bir sandbox/referrerPolicy setiyle yazılamaz — tehdit modelinde (bkz.
doküman başı) EDITOR'ün kendisi de hedef olabilir, admin önizlemesi "iç kullanım, daha az kritik"
değildir. Bu değer `MAP_IFRAME_SANDBOX` adıyla `map-embed.ts`'te TEK yerde sabitlenip her iki
render noktasından import edilmelidir (kopyalanmaz).

### 4.2 `referrerPolicy` → **DEĞİŞTİRİLDİ**

Mimarın önerdiği `"no-referrer-when-downgrade"` **2016-öncesi tarayıcı varsayılanıdır** ve
cross-origin isteklerde TAM URL'i (path + query — sayfanın slug'ı, olası query string'i) Google'a
sızdırır; yalnızca protokol düşüşünde (https→http) referrer'ı keser, cross-origin https→https'te
HİÇBİR ŞEY kesmez. Bu proje zaten §3.5'te KVKK riski olarak "ziyaretçi IP'si + çerez Google'a
gidiyor" tespitini yapmış — referrer'da tam URL sızıntısını da eklemek gereksiz bir genişleme.

**Nihai değer:** `referrerPolicy="strict-origin-when-cross-origin"` (modern tarayıcı varsayılanı;
cross-origin isteklerde yalnızca origin — `https://example.com` — gönderilir, path/query
gönderilmez; protokol düşüşünde hiçbir şey gönderilmez). Maps embed'in çalışması için page path'e
ihtiyacı yoktur, bu değişiklik fonksiyonel bir kayıp YARATMAZ.

### 4.3 Diğer nitelikler → **ONAYLANDI, değişiklik yok**

- `loading="lazy"` — onaylandı.
- `allowFullScreen` — onaylandı.
- `title={markerTitle || address || "Harita"}` — onaylandı, boş title yasağı doğru.
- `allow` niteliği verilmemesi — onaylandı (video.tsx'teki geniş `allow` listesi haritada
  gereksiz — daha az izin = daha az yüzey; sandbox zaten en gerekli izinleri kapsıyor).
- `mapStyle` → sabit 4'lü `filter` tablosu, kullanıcı girdisi CSS'e ASLA enterpole edilmez —
  onaylandı. **Ek kural:** tablo `Record<GoogleMapStyle, string>` biçiminde sabit bir obje/`className`
  eşlemesi olmalı; `mapStyle` değeri hiçbir zaman template-literal ile bir CSS string'ine
  gömülmemeli (ör. `` `filter: ${x}` `` YASAK), yalnızca anahtar-değer look-up.
- `height` → sayı + kapalı enum, yapısal olarak enjeksiyona kapalı — onaylandı.

---

## 5) `video.coverUrl` (genişletilen blok) → **ONAYLANDI, değişiklik yok**

Mimarın kararı doğru: `coverUrl`, `beforeUrl`/`afterUrl` (`BeforeAfterSliderBlockDataSchema`,
mevcut kodda `SafeHrefSchema` OLMADAN `z.string().min(1).max(2048)`) ile **aynı serbestlik
sınıfındadır** ve bu doğrudur — gerekçe şema yorumunda zaten var ("`<img>` olarak render edilir,
iframe/CSS enjeksiyon yüzeyi yok"). Teyit: `<img src>` bağlamı, `<iframe src>`/`<a href>`'in
aksine, modern tarayıcılarda `javascript:` şemasını YÜRÜTMEZ ve `<img>` ile yüklenen SVG içindeki
`<script>` etiketleri de (2011'den beri tüm büyük motorlarda) çalıştırılmaz — yani bu alan için
protokol beyaz listesi gerçek bir güvenlik faydası SAĞLAMAZ, mimarın "SafeHrefSchema gerekmez"
kararı isabetlidir. `.min(1).max(2048)` uzunluk sınırı yeterli.

**Tek ek not:** `coverUrl` yalnızca `<img src>` olarak kullanılmalı — asla bir `<a href>`, bir CSS
`background-image: url(...)` string enterpolasyonu, veya bir `<iframe>` kaynağı olarak
kullanılmamalı (bağlam değişirse bu onay geçersiz olur). frontend-agent bu sınırı ihlal ederse
(ör. lightbox tetikleyicisini `<a href={coverUrl}>` yaparsa) security-agent'a tekrar danışılmalı.

---

## 6) KVKK notu (mimarın §3.5'ine ek)

`referrerPolicy` sıkılaştırması (§4.2) KVKK riskini **azaltır** (tam URL artık Google'a gitmiyor)
ama IP adresi + Google çerezi sızıntısını ORTADAN KALDIRMAZ — bu `loading="lazy"` ile kısmen
gecikir, tam çözüm değildir. Mimarın önerisi gibi bu doküman da bunu **compliance-agent'a advisory**
olarak bırakır; bu turun teslim şartı değildir.

---

## 7) Backend-agent için kesin, uygulanabilir kural özeti

1. `pages.schemas.ts`'e §2 NİHAİ regex'i AYNEN ekle (bu dokümandaki, mimarın DEĞİL — backtick/backslash eklenmiş hali).
2. `zoom` aralık dışıysa **422** (clamp yok) — mimarın §3.3 metni yerine bu dokümanın §3'ü geçerli.
3. `apiKey` alanı hiçbir şemaya, hiçbir response örneğine EKLENMEZ.
4. Unit test matrisi: mimarın §7.2/4 listesi + bu dokümanın §2 sonundaki 5 ek test case'i.
5. `PageNodeSchema` dispatch dalının (mimar §5/6) eklendiğini doğrulayan bir regresyon testi
   YAZILMALI — bu dal unutulursa TÜM whitelist baypas edilir (mimarın R2 riski, en kritik madde).

## 8) Frontend-agent için kesin, uygulanabilir kural özeti (orkestratör yönlendirsin)

1. `map-embed.ts`'e aynı NİHAİ regex + `zoom` clamp (render-time, throw etmez) + `locale`
   whitelist kontrolü.
2. `MAP_IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"`
   sabiti TEK yerde tanımlanır, hem public `google-map-block.tsx` hem admin canlı önizleme
   bileşeni bu sabiti import eder — kopyalanmaz.
3. `referrerPolicy="strict-origin-when-cross-origin"` (mimarın `no-referrer-when-downgrade`
   önerisi yerine).
4. `mapStyle` → sabit obje look-up, asla string template ile CSS'e enterpolasyon.
5. `coverUrl` yalnızca `<img src>` bağlamında kullanılır (§5).

---

## 9) Onay/Değişiklik özet tablosu

| # | Mimar kararı | security-agent kararı |
|---|---|---|
| §3.1 `apiKey` reddi | öneri | **ONAYLANDI** |
| §3.2 regex | öneri | **ONAYLANDI + SIKILAŞTIRILDI** (backtick/backslash eklendi, case-sensitivity gerekçelendirildi) |
| §3.3 adres inşası | öneri | **ONAYLANDI** + zoom clamp/reject tutarsızlığı çözüldü + `locale` whitelist eklendi |
| §3.4 `allow` yok | öneri | **ONAYLANDI** |
| §3.4 `sandbox` yok | öneri | **REDDEDİLDİ / DEĞİŞTİRİLDİ** — zorunlu sandbox seti tanımlandı |
| §3.4 `referrerPolicy` | `no-referrer-when-downgrade` | **DEĞİŞTİRİLDİ** → `strict-origin-when-cross-origin` |
| `video.coverUrl` serbestliği | öneri | **ONAYLANDI** |
