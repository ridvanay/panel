"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/context/auth-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: ReactNode }) {
  return (
    // `attribute="class"` next-themes'in <html>'e `class="dark"` eklemesini/kaldırmasını sağlar
    // (globals.css'teki `.dark` class'ı ve Tailwind v4'ün `@custom-variant dark (&:is(.dark *))`
    // tanımıyla eşleşir). `disableTransitionOnChange` bilinçli olarak KULLANILMIYOR — tema
    // değişimini devre dışı bırakmak yerine ThemeToggle içinde kendi yumuşak geçişimizi
    // yönetiyoruz (bkz. components/admin/theme-toggle.tsx).
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <AuthProvider>
        <TooltipProvider>
          {children}
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
