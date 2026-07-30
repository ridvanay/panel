"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { Block } from "@/lib/page-builder/types";

interface PageBuilderContextValue {
  blocks: Block[];
  setBlocks: (blocks: Block[]) => void;
  selectedBlockId: string | null;
  selectBlock: (id: string | null) => void;
}

const PageBuilderContext = createContext<PageBuilderContextValue | null>(null);

export function PageBuilderProvider({ children, initialBlocks = [] }: { children: ReactNode; initialBlocks?: Block[] }) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [selectedBlockId, selectBlock] = useState<string | null>(null);

  return (
    <PageBuilderContext.Provider value={{ blocks, setBlocks, selectedBlockId, selectBlock }}>
      {children}
    </PageBuilderContext.Provider>
  );
}

export function usePageBuilder() {
  const ctx = useContext(PageBuilderContext);
  if (!ctx) throw new Error("usePageBuilder, PageBuilderProvider içinde kullanılmalı");
  return ctx;
}
