-- Canlı sohbet düğmesi konumu: yalnızca yeni enum + varsayılanlı kolon. Mevcut satır sağ alt
-- (bugünkü davranış) ile doldurulur; veri değiştirmez, varsayılan dilden bağımsızdır.
CREATE TYPE "LiveChatPosition" AS ENUM ('BOTTOM_RIGHT', 'BOTTOM_LEFT');

ALTER TABLE "site_settings" ADD COLUMN "liveChatPosition" "LiveChatPosition" NOT NULL DEFAULT 'BOTTOM_RIGHT';
