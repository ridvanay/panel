"use client";

import { useState, type ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/context/auth-context";
import { I18nProvider } from "@/context/i18n-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: ReactNode }) {
  // `useState(() => new QueryClient())` — SSR-safe: her istekte/mount'ta paylaşılan tek bir
  // modül-seviyeli client OLUŞTURMAZ (sunucu tarafında istekler arası state sızıntısını önler),
  // ama client tarafında re-render'lar arasında AYNI instance korunur (bkz. TanStack Query'nin
  // Next.js App Router rehberi). `staleTime` varsayılanı 0 yerine kısa bir eşik veriyoruz ki
  // aynı ekranda birden çok bileşenin aynı query'i art arda tetiklemesi gereksiz ağ isteği
  // üretmesin (ör. stats sayfasındaki filtre değişince birden çok grafik aynı `range`'i okur).
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    // `attribute="class"` next-themes'in <html>'e `class="dark"` eklemesini/kaldırmasını sağlar
    // (globals.css'teki `.dark` class'ı ve Tailwind v4'ün `@custom-variant dark (&:is(.dark *))`
    // tanımıyla eşleşir). `disableTransitionOnChange` bilinçli olarak KULLANILMIYOR — tema
    // değişimini devre dışı bırakmak yerine ThemeToggle içinde kendi yumuşak geçişimizi
    // yönetiyoruz (bkz. components/admin/theme-toggle.tsx).
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <I18nProvider>
            <TooltipProvider>
              {children}
              <Toaster />
            </TooltipProvider>
          </I18nProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
