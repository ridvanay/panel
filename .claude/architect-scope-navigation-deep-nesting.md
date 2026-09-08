# architect-scope: Navigasyon — çok seviyeli (4 katman) menü + nested flyout

Statü: **BAĞLAYICI**. Çelişki hâlinde `docs/architecture/openapi.yaml` kazanır.
Kontrat ve ARCHITECTURE.md §10.10.1 / §10.10.3 / §10.10.3.1 bu kapsamla birlikte
GÜNCELLENDİ. Ajanlar tahmin yürütmez.

## 0. Karar özeti

| Konu | Karar |
|---|---|
| Derinlik | **4 seviye** (Ana Menü → Kategori → Alt Kategori → Ürün Grubu) |
| Normatif sabit | `NAVIGATION_MAX_DEPTH = 3` — **0-tabanlı derinlik indeksi = ata sayısı** (kök = 0) |
| `depth` kolonu | **EKLENMEZ** — `parentId` zincirinden türetilir |
| Prisma şeması | **DEĞİŞMEZ** → db-agent'a görev YOK, migration YOK |
| PUT semantiği | **Tam-replace KORUNUR** (incremental/PATCH reddedildi) |
| Öğe limiti | `.max(20)` → **`.max(100)`** (`NAVIGATION_MAX_ITEMS`) |
| Döngü koruması | Payload içi 3-renkli iteratif DFS, O(n) — §10.10.3.1 |
| Insert sırası | roots/children ikili bölme → **seviye-sıralı kararlı topolojik sort** |

Gerekçeler ARCHITECTURE.md §10.10.1'de. Kısaca: derinlik bir **ürün politikasıdır**,
yapısal sınır değil — tüm katmanlar derinlikten bağımsız/özyinelemeli yazılır, sınır
tek bir sabitten okunur. 6 seviyeye çıkmak = sabiti değiştir + QA'yı koştur, kod
değişikliği yok. `NAVIGATION_MAX_DEPTH` dışında hiçbir yerde derinlik sayısı hardcode
edilmez.

**Sabitin yeri:** proje npm workspace monorepo'su değil (bağımsız derlenen `backend/`
ve `frontend/`, ortak `paths` alias'ı yok) → gerçek `shared/` paketi build+Docker
değişikliği gerektirir, orantısız. Değer **openapi.yaml'da normatiftir**, TAM iki
dosyada aynalanır:
- `backend/src/modules/navigation/navigation.constants.ts`
- `frontend/src/lib/navigation-constants.ts`

Her ikisi de `NAVIGATION_MAX_DEPTH = 3` + `NAVIGATION_MAX_ITEMS = 100` export eder ve
yorumda diğerine + kontrata atıf verir. qa-agent iki değerin eşitliğini test eder.

## 1. backend-agent

**`navigation.constants.ts` (YENİ)** — yukarıdaki iki sabit.

**`navigation.schemas.ts`:**
- satır 28 yorumu: "Maksimum derinlik 2" ifadesi kaldırılır.
- satır 60: `.max(20)` → `.max(NAVIGATION_MAX_ITEMS)`.
- satır 50-57 JSDoc: kural listesi §10.10.3.1'in 5 adımına göre yeniden yazılır.
- satır 106-113 (**derinlik-2 kuralı**) TAMAMEN SİLİNİR; yerine `superRefine` sonuna
  §10.10.3.1'deki **cycle pass** (4) ve **depth pass** (5) eklenir.
- Kural sırası zorunludur: id benzersizliği → self-reference → çözülebilirlik → cycle →
  depth. Yanlış sıra yanlış hata mesajı üretir (döngülü payload "derinlik aşıldı" demez).
- Hata `path`'i öğe bazlı kalır: `[index, "parentId"]`. Hepsi 422 `VALIDATION_ERROR`.
- Cycle/depth hesabı `superRefine` içinde memoize edilir; toplam O(n).

**`navigation.routes.ts` satır 77-83:** roots/children ikili bölme SİLİNİR; yerine
`depthMemo` ile kararlı `sort((a,b) => depthOf(a) - depthOf(b))` sonrası tek
`createMany`. `readNavigationConfig` sorgusu (satır 21-23) **DEĞİŞMEZ**; ama satır 19-20
yorumu düzeltilir — "tüketici tek geçişte ağacı kurabilir" ifadesi ARTIK YANLIŞTIR.

**`demo-templates/importer.ts` satır 392 — ATLAMA:** aynı roots/children deseninin
ikinci kopyası burada. Aynı topolojik sıralamaya geçirilmeli; sıralama yardımcısı
`navigation` modülünden export edilip paylaşılır (kod kopyalanmaz).

Birim testler: 4 seviyeli geçerli ağaç kabul; 5 seviye 422; 2'li ve 3'lü döngü 422
("döngü" mesajıyla, "derinlik" değil); orphan `parentId` 422; 101 öğe 422; insert
sırasının FK ihlali üretmediği (derin ağaç + karışık dizi sırası).

## 2. frontend-agent — admin editör

`nav-tree-utils.ts` (saf mantık, önce burası; tüm fonksiyonlar derinlikten bağımsız):
- satır 13 `MAX_DEPTH = 1` SİLİNİR → `navigation-constants.ts`'ten import.
- `getDepth` → `0 | 1` tipi yerine `number`; `parentId` zincirini yürüyerek hesaplar
  (imzası `(items, id)` olur).
- **`removeItemCascade` (satır 37-39) BOZUK** — yalnızca doğrudan çocukları siliyor;
  3+ seviyede torunlar orphan kalır ve PUT'u 422'ye düşürür. Tüm alt ağacı silecek
  şekilde özyinelemeli yazılmalı.
- **`moveItem`/`computeMoveContext` (satır 233) BOZUK** — `removeChildrenOf` yalnızca
  doğrudan çocukları çıkarıyor; TÜM alt ağaç çıkarılmalı (dnd-kit sortable-tree deseni).
- `canIndent`/`canOutdent`: "çocuğu varsa indent yasak" kuralı KALKAR. Yeni kural:
  `hedefDerinlik + subtreeHeight(item) <= NAVIGATION_MAX_DEPTH`. `subtreeHeight`
  yardımcısı eklenir.
- `computeProjection` (satır 175): `activeHasChildren ? 0 : ...` hack'i kalkar →
  `maxAllowed = min(previousDepth + 1, NAVIGATION_MAX_DEPTH - subtreeHeight(active))`.
- `NavTreeNode.children` → `NavTreeNode[]` (özyinelemeli); `buildTree` iki geçişli
  `parentId -> children[]` haritası (O(n), orphan atlanır); `flattenDepthFirst` ve
  `toNavigationItemsPayload` özyinelemeli (order her seviyede kardeş-kapsamlı kalır).

`nav-tree-editor.tsx` satır 155-196: sabit iki seviyelik JSX SİLİNİR → tek bir
özyinelemeli `<NavTreeBranch nodes depth />` bileşeni (kendini `node.children` ile
çağırır). `NavTreeRow` imzası değişmez, girinti `depth` prop'undan gelir.

## 3. ui-designer

Kod yazma; token/kural tanımla: (a) admin ağacında seviye başına girinti ve rehber
çizgisi ölçeği (mevcut `ml-3 + pl-5` 4 seviyede taşar — derinlikle azalan veya sabit
küçük bir adım); (b) storefront flyout: submenu açılma yönü (sağ, viewport kenarında
sola dönme), hover-intent gecikmesi, z-index katmanı, alt menü tetikleyicisindeki
chevron; (c) dar ekran davranışı — flyout mu, özyinelemeli akordeon mu (bağlayıcı
karar senin). Mevcut `components/ui/dropdown-menu.tsx` `DropdownMenuSub`/`SubTrigger`/
`SubContent` primitiflerini ZATEN export ediyor — yeni primitif gerekmez.

## 4. frontend-agent — storefront

`site-header.tsx`:
- `NavNode` (satır 65-70) → `children: NavNode[]` (özyinelemeli).
- `buildNavTree` (satır 77-88) → iki geçişli harita; ebeveyni bulunamayan öğe ATLANIR
  (tüm ağaç düşürülmez); her seviyede `order`'a göre sıralama.
- `hasActiveChild` (satır 249) → özyinelemeli `hasActiveDescendant`.
- Render (satır 246-290): kök = `DropdownMenu`; çocuğu OLAN alt öğe =
  `DropdownMenuSub` + `SubTrigger` + `SubContent`; yaprak = `DropdownMenuItem`.
  Özyinelemeli bir `NavMenuItems` bileşeni ile.
- **Savunma:** render özyinelemesine `NAVIGATION_MAX_DEPTH` sert kesme konur — bozuk
  DB verisi (elle SQL/kısmi restore) sunucu tarafı render'ı sonsuz döngüye sokmasın.

## 5. qa-agent

E2E: 4 seviyeli menü kurma (indent/outdent + sürükle-bırak), kaydetme, storefront'ta
nested flyout ile 4. seviyeye tıklayıp doğru sayfaya gitme; 5. seviyeye indent'in UI'da
engellendiği; alt ağacı olan bir düğümü taşırken derinlik taşmasının engellendiği; ata
öğe silindiğinde tüm alt ağacın gitmesi. Ayrıca iki sabit dosyasının değer eşitliği testi.
Not: revalidation kaynaklı 60 sn eventual consistency beklenir — storefront doğrulaması
poll (toPass + reload) ile yapılır.

## 6. Kapsam dışı / görev DÜŞMEYEN ajanlar

- **db-agent**: şema değişikliği yok.
- **integration-agent, seo-agent, notification-agent, compliance-agent**: bu iş
  kişisel veri, ödeme, bildirim veya meta veri içermiyor.
- **security-agent**: yeni endpoint yok, RBAC değişmiyor; tek denetim noktası
  `HrefSchema`'nın (open-redirect koruması) DEĞİŞMEDEN kalması — hafif inceleme yeterli.
- **MediaFolder** (§10.11.1) derinlik-2 kuralı **KASITLI OLARAK DEĞİŞMEZ**; artık
  navigasyon kuralıyla aynı değildir.

## 7. Git

Branş: `feature/navigation-deep-nesting`. Commit'ler Conventional Commits.
Önerilen sıra: `feat(navigation): ...` (backend kontrat+doğrulama) → `feat(navigation):
...` (admin editör özyineleme) → `feat(navigation): ...` (storefront flyout) →
`test(navigation): ...`. Sıra/bağımlılık planı gerekirse release-coordinator devralır.
