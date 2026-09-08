# ui-designer: Navigasyon Derin İç-İçe Geçme — Tasarım Spesifikasyonu

Kapsam: `.claude/architect-scope-navigation-deep-nesting.md` §3 (BAĞLAYICI, çelişkide bu karar geçerli). Kod yazılmadı — frontend-agent'ın doğrudan uygulayacağı token/kurallar aşağıdadır. Referans dosyalar okundu: `nav-tree-utils.ts`, `nav-tree-row.tsx`, `nav-tree-editor.tsx` (satır 173: `ml-3 border-l border-dashed border-border/60 pl-5`), `site-header.tsx`, `components/ui/dropdown-menu.tsx` (Base UI `@base-ui/react/menu` tabanlı), `components/ui/sheet.tsx`, `components/ui/accordion.tsx`.

## (a) Admin ağaç editörü — girinti + rehber çizgisi

- `INDENTATION_WIDTH`: **32 → 20px** (`nav-tree-utils.ts`). Adım SABİT kalmalı — `computeProjection`'ın `offsetX / INDENTATION_WIDTH` formülü derinlikle azalan bir adımla çalışmaz; bu yüzden "azalan adım" değil "küçültülmüş sabit adım" seçildi.
- 4 seviye (depth 0-3) kümülatif girinti: **0 / 20 / 40 / 60px**. `nav-tree-editor.tsx`'teki çocuk konteyneri (`ml-3 pl-5` = 12+20 = 32px) özyinelemeli hale gelince `ml-2 pl-3` (8+12 = 20px, Tailwind'in 4-ölçeğine uygun) olarak güncellenir.
- Rehber çizgisi `border-l border-dashed` kalır, kalınlık sabit (1px) — 4 paralel çizgide kalınlık artışı gürültü yaratır. Derinlik ayrımı **opaklık kademesiyle** yapılır: depth1 `border-border/60` (mevcut), depth2 `border-border/40`, depth3 `border-border/25` — en derin seviye en soluk, dikkat köke kalır.
- Seviye ayrımı renk-kodlaması (ör. her derinliğe ayrı renk) KULLANILMAZ — tema/kontrast karmaşası riski. "L2/L3" gibi metinsel rozet de EKLENMEZ (gürültü); indent/outdent butonlarının `disabled` durumu zaten sınırı gösterir.
- İkon boyutları tüm seviyelerde SABİT (`h-3.5 w-3.5` ok/chevron, `h-4 w-4` diğer); satır arka planı/border (`border-border/60 bg-surface`) değişmez — sadece konteyner girintisi ve guide-line opaklığı kademelenir.

## (b) Storefront flyout (nested dropdown)

- Mevcut `DropdownMenuSub` / `SubTrigger` / `SubContent` (Base UI Menu) DOĞRUDAN kullanılır, yeni primitif YOK.
- Yön: `side="right"`, `alignOffset={-3}`, `sideOffset={0}` — `DropdownMenuSubContent` varsayılanlarıyla AYNI, değiştirilmez.
- Kenar taşması: Base UI `Positioner` Floating-UI tabanlı otomatik `flip` uygular (Radix `avoidCollisions` karşılığı) — ek kod gerekmez. `collisionPadding={8}` eklenerek ekran kenarına 8px boşluk garanti edilir.
- Hover-intent gecikmesi: açılışta **150ms**, kapanışta **300ms** (kapanış daha uzun — imleç kaçarsa aniden kapanmasın). Primitif destek vermiyorsa frontend-agent `onPointerEnter/Leave` + `setTimeout` fallback yazar.
- z-index: mevcut `z-50` (Content/SubContent) korunur — sticky header'ın `z-30`'undan yüksek, ek işlem gerekmez.
- Chevron: `ChevronRightIcon`, mevcut `ml-auto`, boyut `size-4` (global `[&_svg:not([class*='size-'])]:size-4` kuralı uygular) — tüm seviyelerde SABİT.
- Görsel kalıp değişmez: `rounded-lg shadow-lg ring-1 ring-foreground/10 bg-popover p-1`, item padding `px-1.5 py-1` sabit. Light/dark için yeni token gerekmez — `bg-popover`/`text-popover-foreground`/`ring-foreground/10` zaten iki temayı kapsar.
- 4 seviyeye kadar `DropdownMenuSub` zincirlenir; stil FARKLILAŞMAZ, sadece konum sağa kayar — derinlik yatay konumdan anlaşılır, ekstra vurgu gerekmez.

## (c) Dar ekran (mobil) davranışı — BAĞLAYICI KARAR

`site-header.tsx`'te şu an ayrı bir mobil/hamburger menü YOK (nav `flex-wrap` ile tek düzen). Bu görev kapsamında YENİ eklenecek:

- Desen: **`Sheet` (mevcut `components/ui/sheet.tsx`, `side="left"`, `w-3/4 sm:max-w-sm`) içinde özyinelemeli `Accordion`** (mevcut `components/ui/accordion.tsx`, Base UI tabanlı, height-transition dahili). **`framer-motion`/`AnimatePresence` ile yeni bir akordeon YAZILMAZ** — mevcut primitif zaten CSS ile animasyonlu, ek bağımlılık gereksiz.
- Breakpoint: **`md:hidden`** (768px) altı hamburger tetikleyici; masaüstü nav `md:flex` ile mobilde gizlenir.
- `Accordion type="multiple"` — kullanıcı 2. ve 3. seviyeyi aynı anda açık tutabilsin (derin ağaçta her tıklamada üst seviyenin kapanması kötü UX).
- Çocuğu olan öğe = `AccordionItem` + `AccordionTrigger` (mevcut `ChevronDown size-4`, `rotate-180` deseni); yaprak öğe = düz `Link` (`px-3 py-2.5 text-sm`).
- İç içe girinti: her `AccordionPanel` içeriği `pl-4` (16px) ek sol boşluk — admin'den farklı, dokunmatik alan önceliklidir; 4 seviyede kümülatif 48px, hâlâ kullanılabilir.
- Dokunmatik hedef: satır başına min `h-11` (44px, WCAG/Apple önerisi).
- Sheet açılış/kapanış MEVCUT `data-starting-style/data-ending-style` (200ms) korunur.
- Renk: Sheet + Accordion `bg-popover`/`border-border/60` kullanır — `--site-header-*` değişkenleriyle KARIŞTIRILMAZ (onlar sadece header linkleri için).
