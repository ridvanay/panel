"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ProductTabsProps {
  /** Sunucuda render edilmiş `<RichContentWithShortcodes/>` — bu dosya `"use client"` olduğu için
   * o (async/sunucu) bileşen BURADAN import EDİLEMEZ, çağıran sunucu bileşeni `children` olarak geçirir. */
  descriptionContent: ReactNode;
  /** `null` = "Teknik Dökümanlar" sekmesi HİÇ render edilmez (architect §4.2 — boş sekme gösterilmez). */
  documentsContent: ReactNode | null;
  returnsContent: ReactNode;
}

/**
 * `.claude/design-notes-products-catalog.md` §4.4 — mevcut `Tabs`/`TabsList`/`TabsTrigger`/
 * `TabsContent` (`variant="line"`), YENİ bir sekme tasarımı İCAT EDİLMEZ. `keepMounted` —
 * architect §4.2 bağlayıcı kuralı: gizlenen panel DOM'dan KALDIRILMAZ (`hidden` ile gizlenir),
 * arama motoru/`Ctrl+F` içeriği bulabilsin.
 */
export function ProductTabs({ descriptionContent, documentsContent, returnsContent }: ProductTabsProps) {
  return (
    <Tabs defaultValue="description" className="mt-12">
      <TabsList variant="line" className="border-b border-border">
        <TabsTrigger value="description">Açıklama & Özellikler</TabsTrigger>
        {documentsContent && <TabsTrigger value="documents">Teknik Dökümanlar</TabsTrigger>}
        <TabsTrigger value="returns">İade & Garanti</TabsTrigger>
      </TabsList>
      <TabsContent value="description" keepMounted className="mt-6 text-sm leading-relaxed text-foreground/80">
        {descriptionContent}
      </TabsContent>
      {documentsContent && (
        <TabsContent value="documents" keepMounted className="mt-6">
          {documentsContent}
        </TabsContent>
      )}
      <TabsContent value="returns" keepMounted className="mt-6 text-sm text-foreground/80">
        {returnsContent}
      </TabsContent>
    </Tabs>
  );
}
