"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { BlockChrome, TabsBlock } from "@/lib/page-builder/types";

export function TabsBlockView({ block, chrome }: { block: TabsBlock; chrome: BlockChrome }) {
  const items = block.data.items.filter((item) => item.label.trim());
  if (items.length === 0) return null;

  return (
    <section className={cn(chrome === "page" && "px-4 py-8 sm:px-6")}>
      <div className="mx-auto max-w-3xl">
        <Tabs defaultValue={items[0]!.id} orientation={block.data.orientation}>
          <TabsList>
            {items.map((item) => (
              <TabsTrigger key={item.id} value={item.id}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {items.map((item) => (
            <TabsContent key={item.id} value={item.id} className="space-y-2 py-2">
              {item.content
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line, lineIndex) => (
                  <p key={lineIndex} className="text-foreground/70">
                    {line}
                  </p>
                ))}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}
