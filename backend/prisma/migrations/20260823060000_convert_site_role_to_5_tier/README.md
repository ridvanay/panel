# Migration notu — `SiteRole` 3-tier → 5-tier

Bağlayıcı karar dokümanı: `.claude/architect-scope-rbac-5-tier.md` (§1, §2). Bu migration
**izole** gönderilir; başka hiçbir şema değişikliğiyle karıştırılmaz.

## Ne değişiyor

- `SiteRole` enum'ı `ADMIN, EDITOR, VIEWER` → `ADMIN, MANAGER, EDITOR, CUSTOMER, USER` olur.
- Veri eşlemesi: `ADMIN→ADMIN`, `EDITOR→EDITOR`, `VIEWER→USER` (bilinçli yetki
  DARALTMASI — `VIEWER→EDITOR` veya `VIEWER→MANAGER` YAPILMAZ, bkz. §2.2 gerekçesi).
- `users.role` varsayılanı `VIEWER` → `USER`.
- `users.advancedBuilderEnabled` kolonu **kaldırılır** (geri alınamaz veri kaybı, kabul
  edilir — §2.4 kural 3). `canUseAdvancedBuilder` artık saf rol türevi (`role === "ADMIN"`).
- **İndeks eklenmiyor** — bilinçli karar (§2.4 kural 4).

## devops-agent için ZORUNLU operasyonel adımlar (§2.2, §2.3)

### 1) Migration'dan ÖNCE — etkilenen hesapları raporla ve deploy notuna ekle

```sql
-- Eski VIEWER hesapları: migration sonrası panele HİÇ giremeyecek (panel erişimini
-- tamamen kaybediyor). Otomatik terfi YAPILMAZ.
SELECT id, email, name FROM users WHERE role = 'VIEWER' AND status <> 'DELETED';

-- Eski EDITOR hesapları: migration sonrası kapsamı DARALIYOR — products, portfolio,
-- contact/submissions ve stats (içerik analitiği) uçlarında artık 403 alacaklar.
-- Bu bir regresyon değil, istenen davranıştır (bkz. §2.3).
SELECT id, email, name FROM users WHERE role = 'EDITOR' AND status <> 'DELETED';
```

Bu iki listeyi deploy notuna ekle (kim, kaç kayıt, e-postalar).

### 2) Migration'dan SONRA

- Otomatik terfi YOKTUR. Yukarıdaki listelerden panele/ek kapsama gerçekten ihtiyacı olan
  hesaplar **ADMIN tarafından elle** `PATCH /admin/users/{id}/role` ile `MANAGER` veya
  `EDITOR`'e yükseltilir.
- documentation-agent bu daralmayı CHANGELOG'da **BREAKING** olarak işaretler.

## Geri alma (rollback)

Bu klasördeki `down.sql` dosyası tersine SQL'i içerir. Prisma otomatik down-migration
desteklemediği için elle çalıştırılır. **Round-trip garantisi yalnızca forward migration'dan
beri hiç değişmemiş satırlar için tamdır** (`ADMIN↔ADMIN`, `EDITOR↔EDITOR`,
`VIEWER→USER→VIEWER`). Forward migration'dan SONRA üretilen `MANAGER`/`CUSTOMER` değerleri
eski 3-tier enum'da temsil edilemez; `down.sql` içindeki best-effort eşlemeye ve
uyarı notlarına bakın.

## Prisma uygulama şekli

Bu migration, `prisma/schema.prisma`'daki `enum SiteRole` ve `User.role`/
`User.advancedBuilderEnabled` değişiklikleriyle birlikte gelir. Uygulamak için:

```
npx prisma migrate deploy   # prod
# veya geliştirmede:
npx prisma migrate dev
```

ardından:

```
npx prisma generate
```
