-- İletişim sayfası içeriği: yalnızca varsayılanlı (boş nesne) bir JSONB kolonu. Mevcut satır '{}' ile
-- dolar (sayfa sözlük varsayılanlarını gösterir); veri değiştirmez, varsayılan dilden bağımsızdır.
ALTER TABLE "contact_forms" ADD COLUMN "pageContent" JSONB NOT NULL DEFAULT '{}';
