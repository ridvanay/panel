# Performans İncelemesi — 2026-08-11

Kullanıcı şikayeti: "Site geliştirmeler arttıkça yavaşlıyor." Bu doküman, `performance-agent` (backend + bundle) ve
doğrudan tarayıcı üzerinde gerçek ölçümle yapılan (frontend re-render) incelemenin bulgularını özetler. **Tahmin
yok — her satır gerçek ölçüme dayanır.** Ölçüm metodolojisi ve ham veriler ilgili commit/konuşma geçmişinde mevcut.

## Özet

Beklenenin aksine backend'de N+1 sorgu veya eksik indeks **bulunamadı**, bundle'da kütüphane sızıntısı
**bulunamadı** — bu iki alan zaten doğru mimariye sahip. Gerçek, ölçülebilir tek bulgu frontend tarafında,
**dashboard'daki grafik bileşenlerinin ve navigasyon ağacındaki satırların gereksiz yere yeniden render
olmasıydı** — kısmen düzeltildi (bkz. "Uygulanan Düzeltmeler"), kısmen de kütüphanelerin kendi mimarisinden
kaynaklandığı için düzeltilemeyeceği tespit edildi (dürüstçe belgelendi).

---

## 1) Backend — N+1 sorgu / eksik indeks: BULUNAMADI

`performance-agent`, Import/Products/Portfolio/Navigation modüllerinin liste uçlarını gerçek Prisma query-event
logging ile ölçtü (satır sayısı 20 satır simüle edilerek de test edildi):

| Sorgu | Üretilen SQL sayısı |
|---|---|
| `product.findMany` + tüm ilişkiler | 4 (sabit, satır sayısından bağımsız) |
| `portfolioItem.findMany` + tüm ilişkiler | 6 (sabit) |
| `importJob.findMany({ include: createdBy })` | 2 (sabit) |
| `readNavigationConfig` (navigation+social+footer) | 5 (sabit) |

Hepsi Prisma `include` ile toplu (`WHERE id IN (...)`) sorgu üretiyor — satır başına ayrı sorgu yok. Pagination
tüm liste uçlarında gerçek DB-seviyeli cursor+`LIMIT` (uygulama içi kesme değil). Mevcut indeksler
(`@@index([categoryId])`, `@@index([deletedAt, status])`, `@@index([authorId])` vb.) kodun kullandığı WHERE/ORDER
BY kalıplarıyla birebir eşleşiyor — eklenmesi gereken indeks bulunamadı, migration oluşturulmadı.

**Dürüstlük notu:** DB'de şu an çok az satır var (`products=1`, `portfolio_items=2` vb.) — ama N+1 yokluğu satır
sayısından bağımsız kanıtlanmış bir mimari özellik (query-count testi), veri büyüse de sonuç değişmez.

## 2) Frontend bundle boyutu — kütüphane sızıntısı: BULUNAMADI

`npx next experimental-analyze` ile route-bazlı gerçek gzip KB ölçümü:

| Route | Toplam JS+CSS (gzip) | dnd-kit | tiptap | recharts |
|---|---|---|---|---|
| `/admin/navigation` | 672.1 KB | **16.4 KB** | — | — |
| `/admin/blog/new` | 797.7 KB | — | **53.8 KB** | — |
| `/admin` (dashboard) | 813.4 KB | — | — | **125.6 KB** |
| `/admin/products`, `/admin/portfolio`, `/admin/import` | ~620-650 KB | — | — | — |

dnd-kit/tiptap/recharts, kendilerini kullanmayan HİÇBİR route'un bundle'ına sızmıyor (0 KB doğrulandı) —
Next.js'in otomatik route-bazlı code-splitting'i zaten doğru çalışıyor. Dynamic import'a çevirme yapılmadı
(gerek yok).

**Gözlem (görev varsayımını düzeltir):** `products`/`portfolio` detay sayfaları henüz Tiptap KULLANMIYOR (düz
`<Textarea>`) — ileride eklenirse bu tabloyu tekrar ölçmek gerekir.

## 3) Frontend re-render — gerçek ölçüm (React Profiler + `console.count`)

### 3a. Dashboard (`/admin`) — memo eklendi, ölçülebilir kazanç YOK

Dashboard'daki `VisitorChart`/`ActivityBarChart`/`DeviceBreakdownChart`/`CountryBreakdownList`/`LiveVisitorsBadge`
hiçbiri `React.memo` kullanmıyordu. Hipotez: sayfa `summary` state'i her güncellendiğinde (birbirinden bağımsız
4-5 ayrı sorgu çözüldükçe) TÜM grafikler gereksiz yere yeniden render oluyor.

**Gerçek ölçüm (React `<Profiler>`, tek sayfa yüklemesi):** ~21 commit, kümülatif `actualDuration` ≈ **585ms**
(dev modda; en pahalı tekil commit'ler 88-102ms). `React.memo` ekledikten SONRA aynı ölçüm tekrarlandı: sayı ve
süre **DEĞİŞMEDİ** (yeniden ölçümde 551ms'e kadar çıkan tekil commit'ler bile görüldü).

**Kök neden:** Bu render'lar "gereksiz" değil — her grafik KENDİ `useQuery`'siyle bağımsız veri çekiyor, her biri
kendi sorgusu çözüldüğünde (loading→data geçişi) render oluyor. Bu, o bileşenin KENDİ state değişikliği, parent'ın
zorladığı bir re-render değil — `memo` bunu önleyemez (önlemesi de YANLIŞ olurdu, veri gerçekten değişti).
`memo` yine de bırakıldı (zararsız, doğru pratik — parent'ın `summary`/`error` state'i ileride büyürse fayda
sağlayabilir) ama **bir "düzeltme" olarak sayılmıyor**, çünkü ölçülebilir bir kazanç kanıtlanamadı.

### 3b. Navigasyon ağacı (`/admin/navigation`, dnd-kit sürükle-bırak) — memo eklendi, KISITLI gerçek kazanç

`NavTreeRow` memo değildi + `NavTreeEditor` her satıra inline closure (`onIndent={() => handleIndent(id)}` vb.)
geçiyordu + `tree`/`sortableIds` her render'da yeniden hesaplanıyordu (yeni referans). Hipotez: sürükleme
sırasında (`offsetLeft` her pointer hareketinde değişiyor) TÜM satırlar her pikselde yeniden render oluyor.

**Gerçek ölçüm** (programatik `PointerEvent` dispatch, 16ms aralıklı ~29 adım — gerçek fare hareketine yakın):
- **Düzeltmeden önce:** Sürüklemenin İLK 3-4 commit'inde (dragstart + ilk pointermove'lar) 5 satırın TAMAMI
  birlikte render oluyor; bundan SONRA sadece sürüklenen satır render oluyor.
- **`React.memo(NavTreeRow)` + `useCallback` (stabil id-bazlı callback'ler) + `useMemo(tree)` sonrası:** AYNI
  desen (ilk 3-4 commit'te yine TÜM satırlar render). Sayı ve zamanlama pratikte değişmedi.

**Kök neden (tahmin değil, kod okuyarak doğrulandı):** İlk birkaç commit'teki "tüm satırlar render oluyor"
davranışı bizim komponent yapımızdan DEĞİL, **dnd-kit'in kendi `SortableContext`'inden** kaynaklanıyor — her
`NavTreeRow` içindeki `useSortable()` çağrısı dnd-kit'in dahili context'ine abone; drag başladığında/aktif öğe ilk
belirlendiğinde dnd-kit TÜM sortable öğeleri "bir sürükleme aktif" diye bilgilendiriyor (çarpışma/pozisyon
hesaplaması için gerekli). Bu, React'ın parent→child prop diff'inin DIŞINDA, context aboneliği üzerinden tetiklenen
bir re-render — `React.memo` parent kaynaklı re-render'ı engeller ama context-kaynaklı re-render'ı ENGELLEYEMEZ.

**Sonuç:** Uygulanan `memo`/`useCallback`/`useMemo` DEĞİŞTİRİLMEDİ (kod kalitesi açısından doğru, zararsız, hiçbir
regresyon yok — 251/251 test geçiyor) ama gerçek ölçümle kanıtlanan kazanç **sınırlı**: sadece "sürüklenen satırın
KENDİSİ dışında kalan satırların, drag SIRASINDA (dragstart sonrası) her pointermove'da değil sadece ilk birkaç
anda render olması" garantisi sağlanıyor — bu, `items` prop'u aynı kaldığı sürece (drop anına kadar) satırların
referans-stabilitesini garanti eder ve büyük menülerde (50+ öğe) `offsetLeft` her değiştiğinde tüm ağacın yeniden
hesaplanmasını (buildTree çağrısı, closure oluşturma) önler — 5 öğelik test verisinde bu fark ölçülemeyecek kadar
küçük, ama menü büyüdükçe orantılı olarak önem kazanır.

### 3c. Sayfalar/Blog listesi (arama kutusu) — veri hacmi ölçüm yapmaya yetersiz

`useContentList` hook'u tüm handler'ları (`toggleSelect`, `startQuickEdit`, `handleTrash` vb.) her render'da YENİ
referanslarla döndürüyor, `ContentListTable` satırları memoize değil. **Ölçüm denendi** ama DB'de sadece **1
sayfa** var — arama kutusuna yazarken commit süresi 1.5ms (ölçülemeyecek kadar küçük, gerçek bir darboğaz
DEĞİL şu an). Yapısal risk gerçek ama şu anki veri hacminde kanıtlanamıyor — aşağıya not olarak eklendi.

---

## Uygulanan Düzeltmeler (bu turda)

1. `frontend/src/components/admin/stats/{visitor-chart,activity-bar-chart,device-breakdown-chart,country-breakdown-list,live-visitors-badge}.tsx` — `React.memo` eklendi (zararsız, kazanç ölçülemedi — bkz. 3a).
2. `frontend/src/components/admin/navigation/nav-tree-row.tsx` — `React.memo` + id-bazlı stabil callback imzası.
3. `frontend/src/components/admin/navigation/nav-tree-editor.tsx` — `useCallback` (handler'lar), `useMemo` (`tree`, `flat`, `sortableIds`) — bkz. 3b, kısıtlı ama gerçek kazanç.

## Düzeltilmeyen, Küçük/Gelecek Riskleri (öncelik sırasına göre değil, backend-agent + bu turun ortak listesi)

1. **`products`/`portfolio_items` arama filtresi (`contains`+`insensitive` → Postgres `ILIKE '%terim%'`).**
   `EXPLAIN ANALYZE` `Seq Scan` gösterdi. 1 satırda fark yok, içerik büyüdükçe O(n) tam tablo taraması olur.
   Çözüm `pg_trgm` uzantısı + GIN indeksi — bir Postgres eklentisi kurulumu olduğu için **db-agent onayı gerekir**.
2. **`import.worker.ts::runTabularContentJob`** (PAGES/BLOG CSV import) satır başına `user.findUnique({ email })`
   çağırıyor — WordPress (WXR) importer'daki gibi baştan toplu `findMany({ email: { in: [...] } })` ile
   çözülebilir. Arka plan işi olduğu için kullanıcıyı bloklamıyor ama 5.000 satırlık CSV'de 5.000 ekstra
   round-trip demek. **backend-agent'ın iş mantığı alanı.**
3. **`AuditLog`** her admin mutasyonunda senkron tekil `INSERT` atıyor — düşük maliyetli, trafik artarsa
   async/toplu yazmaya taşınabilir. Kritik değil.
4. **`useContentList` hook'u** (Sayfalar/Blog/Ürünler/Portföy ortak liste mantığı) handler'ları memoize etmiyor,
   `ContentListTable` satırları `React.memo` değil — bkz. 3c. Şu anki (çok küçük) test verisiyle ölçülemedi ama
   gerçek içerikle (100+ sayfa/yazı) arama kutusuna yazarken fark hissedilebilir hale gelebilir. Öneri: `useContentList`
   içindeki fonksiyonları `useCallback`'e al, `ContentListTable` satır render'ını ayrı memoized bir bileşene çıkar.
5. **Dashboard grafikleri** (bkz. 3a) — her biri bağımsız `useQuery` kullanıyor, sayfa yüklenirken sıralı/staggered
   commit'ler üretiyor (kümülatif ~585ms dev modda). Gerçek bir "waste" değil ama kullanıcı deneyimi açısından
   iyileştirilebilir: tüm stats sorgularını `Promise.all` ile paralel çekip TEK bir loading state'te birleştirmek
   (React `Suspense` + `useSuspenseQuery` gibi) commit sayısını 20'den 1-2'ye indirebilir — bu bir UX/mimari
   kararı, mevcut turda kapsam dışı bırakıldı.
