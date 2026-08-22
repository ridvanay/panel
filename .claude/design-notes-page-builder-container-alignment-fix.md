# Tasarım Notları: Page-Builder Konteyner — Hizalama Bug Fix (2 nokta)

Ajan: **ui-designer** · Durum: **karar verildi, implementasyon frontend-agent'ta bekliyor**
Kapsam: `frontend/src/components/site/blocks/container-block.tsx` (render) + `frontend/src/components/admin/page-builder/container-settings-panel.tsx` (panel UI). Bu doküman kod implementasyonu İÇERMEZ — kararları ve panel metinlerini tanımlar.

Girdi: orkestratörün doğruladığı iki teknik bulgu (Bug 1: inline `margin` stilinin `mx-auto` class'ını her zaman ezmesi; Bug 2: `justifyContent`/`alignItems` class'larının doğru uygulanması ama bazı senaryolarda görsel etkisinin olmaması). Aşağıda yalnızca bu iki nokta için tasarım kararı var — büyük bir yeniden tasarım değil.

---

## 1) Bug 1 — Boxed konteynerde `mx-auto` vs. inline `margin` çakışması

### Karar: **Seçenek A** — Boxed modda yatay margin her zaman otomatik ortalanır; panelde Sol/Sağ inputları bu modda **devre dışı** gösterilir.

**Gerekçe:**
- "Kutulu" (`layout: "boxed"`) bir konteynerin bütün amacı, sayfanın ortasında sabit genişlikte bir içerik kuyusu oluşturmaktır. Kullanıcının bu kuyuyu elle sola/sağa kaydırabilmesi (Margin Sol/Sağ ile) ürün beklentisiyle çelişir — Elementor/Webflow gibi referans araçlarda boxed/container bölümleri her zaman yatayda ortalanır, kullanıcıya "sola kaydır" seçeneği verilmez.
- Seçenek B ("0'dan farklı girilirse override et") ek bir gizli-durum kuralı yaratır: kullanıcı "varsayılana dön" için 0 girdiğinde davranış sessizce değişir, bu kafa karıştırıcıdır ve QA açısından test edilmesi gereken ekstra bir dallanma ekler. Basit ve öngörülebilir olan Seçenek A tercih edilir.
- Dikey margin (top/bottom) bu kısıtlamaya tabi değildir — kullanıcı konteynerin üstüne/altına boşluk eklemeye devam edebilmelidir (bu, sayfa akışında komşu bloklarla mesafe ayarlamak için gerekli ve zararsızdır).
- `full-width` modda ise **hiçbir kısıtlama yok** — Sol/Sağ margin dahil 4 kenar da tam olarak kullanıcının girdiği gibi uygulanır (zaten `mx-auto` çakışması `boxed`'a özgü, `full-width`'te `layoutClass` sadece `w-full`).

### Panel UI değişikliği (container-settings-panel.tsx → `SpacingBoxControl` çağrısı, satır ~840)

`SpacingBoxControl`'e yeni bir opsiyonel prop eklenmeli: `disabledSides?: (keyof ContainerSpacing)[]`. Margin çağrısında `settings.layout === "boxed"` iken `["left", "right"]` geçilir:

```
<SpacingBoxControl
  label="Dış Boşluk (Margin)"
  value={settings.margin}
  onChange={(margin) => onChange({ margin })}
  disabledSides={settings.layout === "boxed" ? ["left", "right"] : undefined}
/>
```

Disabled bir "Sol"/"Sağ" hücresinin görsel durumu:
- `InputGroupInput`: `disabled` attribute, `opacity-50 cursor-not-allowed` (mevcut disabled input tonuyla tutarlı — projede zaten kullanılan `disabled:opacity-50` deseni izlenir).
- Input'un altına/yerine, o iki hücrenin **bulunduğu satırın** altında tek satırlık gri ipucu metni (label rengiyle aynı `text-[11px] text-foreground/50`, mevcut `SIDE_LABEL` etiketiyle aynı boyut):

  **Türkçe ipucu metni (birebir):**
  > "Kutulu düzende yatay boşluk otomatik ortalanır; Sol/Sağ değerleri bu modda pasif."

Bu metin yalnızca `settings.layout === "boxed"` iken render edilir (yani `SpacingBoxControl`'ün kendisi `layout`'tan habersiz kalmalı — metni panel tarafı, `disabledSides` boşsa değil doluysa göstersin; en temiz yol: `SpacingBoxControl`'e `hintForDisabled?: string` prop'u da geçmek, component bunu `disabledSides.length > 0` olduğunda basar).

Değer davranışı: kullanıcı "Kutulu"dan "Tam Genişlik"e geçerse Sol/Sağ inputları tekrar aktif olur ve önceden girilmiş olan sayısal değer (varsa) korunur/silinmez — sadece görsel/etkileşim kısıtı kaldırılır. State'te margin.left/right hiçbir zaman zorla 0'a veya "auto"ya YAZILMAZ; sadece render motorunda (`container-block.tsx`) boxed modda yatay margin CSS `auto` olarak **görsel olarak** override edilir, kullanıcının girdiği sayısal değer veride saklı kalır (moddan moda geçişte veri kaybı olmasın diye). Bu satır frontend-agent'a implementasyon notu olarak taşınmalı.

---

## 2) Bug 2 — `justifyContent`/`alignItems` varsayılanları ve "görsel etkisiz kalma" senaryosu

### Karar A — Varsayılanlar: **`justifyContent: "start"` ve `alignItems: "stretch"` KORUNSUN, değiştirilmesin.**

**Gerekçe:**
- `alignItems: "stretch"`, kart-tabanlı/container-tabanlı sayfa oluşturucularda (Elementor, Webflow, Framer) endüstri standardı varsayılandır: çocuk bloklar (metin, görsel, kart) çapraz eksende **tam genişlik/yükseklik** doldurmalı — bu, iç içe konteynerlerin (row içindeki column'lar) birbirine eşit yükseklikte görünmesini sağlayan davranıştır. `alignItems: "center"` varsayılan olursa, `widthFr` atanmış row-children `shrink-to-fit` olur, kart arka planları/border'lar içeriğin boyuna daralır — bu tam olarak "ucuz/tutarsız görünüm" sorunudur, düzeltmek yerine yaratır. Bu nedenle görevde önerilen "varsayılan olarak `items-center`" fikri **reddedilir**.
- `justifyContent: "start"` da doğru varsayılandır: `direction: "row"` konteynerlerde çocuklar genelde `widthFr` ile genişliği paylaşır (satırı zaten doldururlar), `direction: "column"`'da ise (en yaygın kullanım) ana eksen dikeydir ve `start` en öngörülebilir davranıştır (içerik yukarıdan başlar — kullanıcı beklentisiyle örtüşür). `justify-center` varsayılanı, `minHeight` verilmemiş bir konteynerde hiçbir görünür fark yaratmaz (konteyner içeriğe sarılır), verildiğinde ise içeriği dikeyde ortalar — bu bazı kullanım senaryolarında (ör. üstten hizalı bir form) istenmeyen bir varsayılan olur. `start` daha az sürpriz yaratan, "sıfır durum" (empty/default state) olarak daha güvenli seçimdir.
- Özetle: bu bir varsayılan-değer bug'ı değil, CSS'in doğal davranışı (auto-height konteynerde ana eksende boşluk olmaması) — **kod değişikliği gerektirmiyor**, kullanıcı eğitimi/ipucu ile çözülüyor (aşağıya bakınız).

### Karar B — Panelde ipucu/uyarı metni: **EVET, eklenmeli** (sessizce bırakılmasın).

**Gerekçe:** Kullanıcı "hizalamayı değiştirdim ama hiçbir şey olmadı" deneyimini yaşadığında bunu bug sanır (nitekim bu görev tam olarak buradan doğdu). Sessiz bırakmak yerine, koşullu ve kısa bir bilgi notu göstermek hem güven hem şeffaflık sağlar. Bunu bir **hata/uyarı** (kırmızı/sarı, dikkat çekici) değil, nötr bir **bilgi ipucu** (mevcut `text-foreground/50` tonunda, diğer alan ipuçlarıyla — ör. "Yatay konteynerler mobilde otomatik olarak alt alta dizilir." — aynı görsel dilde) olarak ele al; kullanıcıyı alarma geçirmemeli.

**Gösterim koşulu (frontend-agent implemente eder, burada tasarım/metin kararı verilir):**
- "Ana eksen hizalama" alanının altına, YALNIZCA şu ikisinden biri doğruysa ipucu satırı eklenir:
  - `settings.direction === "column"` VE `settings.minHeight` tanımsız/boş (yani konteyner auto-height).
  - `settings.direction === "row"` VE `settings.justifyContent !== "start"` (çocuklar `widthFr` ile satırı zaten dolduruyorsa fark etmeyeceği için, satırın dolu olup olmadığını panel bilemez — bu yüzden `row` durumunda ipucu her zaman "olabilir" tonunda, kesin değil).

**Türkçe ipucu metni — dikey (column) konteyner için (birebir):**
> "Bu ayarın görünür olması için konteynere bir Minimum Yükseklik değeri verin; aksi halde konteyner içeriğe göre daralır ve dikey boşluk oluşmaz."

**Türkçe ipucu metni — yatay (row) konteyner için (birebir):**
> "Öğeler satırı zaten dolduruyorsa bu ayarın görsel bir etkisi olmayabilir."

Bu iki metin, "Ana eksen hizalama" `SettingsSection` bloğunun (satır ~798-807, container-settings-panel.tsx) hemen altına, `IconToggleGroup`'tan sonra `<p className="text-xs text-foreground/50">…</p>` olarak eklenir — komşu "Yön" alanındaki ipucu satırıyla (satır 795) birebir aynı stil sınıfı kullanılmalı (tutarlılık).

"Çapraz eksen hizalama" (`alignItems`) alanı için ayrı bir ipucu **gerekmiyor** — `stretch` varsayılanı zaten çoğu durumda görünür bir etkisi olan bir davranıştır (çocukları genişletir), "etkisiz kalma" riski `justifyContent` kadar yaygın değil; ek metin gürültü yaratır, eklenmemeli.

---

## Özet — frontend-agent'a devredilecek implementasyon maddeleri

1. `container-block.tsx`: `layout === "boxed"` iken inline `style.marginLeft`/`style.marginRight` değerlerini `"auto"` olarak set et (top/bottom hâlâ `settings.margin.top/bottom` px değerlerinden gelir); `full-width`'te davranış değişmez.
2. `container-settings-panel.tsx`: `SpacingBoxControl`'e `disabledSides` (+ opsiyonel `hintForDisabled` metni) prop'u ekle; Margin çağrısında boxed modda `["left","right"]` geç, ipucu metnini yukarıdaki Türkçe metinle bas.
3. `container-settings-panel.tsx`: "Ana eksen hizalama" bloğunun altına, yukarıdaki iki koşullu Türkçe ipucu satırından ilgilisini ekle.
4. `types.ts` / `DEFAULT_CONTAINER_SETTINGS`: **değişiklik yok** — `justifyContent: "start"`, `alignItems: "stretch"` aynen korunur.
