"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { AnimatePresence, motion } from "framer-motion";
import { Sun, Moon, Monitor, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ThemeValue = "light" | "dark" | "system";

const THEME_OPTIONS: { value: ThemeValue; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Açık", icon: Sun },
  { value: "dark", label: "Koyu", icon: Moon },
  { value: "system", label: "Sistem", icon: Monitor },
];

/**
 * Tema değişiminde ani bir "flash" olmaması için, değişim anında TÜM elemanlara
 * (renk/arka plan/border) kısa süreli bir geçiş efekti tanımlayan geçici bir
 * <style> etiketi ekliyoruz ve tema değiştikten hemen sonra kaldırıyoruz.
 *
 * next-themes'in `disableTransitionOnChange` bayrağını BİLİNÇLİ OLARAK kullanmıyoruz —
 * amaç geçişi devre dışı bırakmak değil, tam tersine yumuşatmaktır. View Transitions
 * API'ye ihtiyaç yok, düz bir CSS transition yeterli.
 */
function withSmoothThemeTransition(apply: () => void) {
  if (typeof document === "undefined") {
    apply();
    return;
  }

  const style = document.createElement("style");
  style.setAttribute("data-theme-transition", "");
  style.textContent =
    "*,*::before,*::after{transition-property:background-color,border-color,color,fill,stroke,box-shadow !important;transition-duration:300ms !important;transition-timing-function:ease !important;}";
  document.head.appendChild(style);

  apply();

  window.setTimeout(() => {
    style.remove();
  }, 320);
}

interface ThemeToggleProps {
  /**
   * `sidebar`: Sidebar kalıcı olarak koyu/cam temalı olduğu için (bkz. sidebar.tsx) buton ve
   * açılan menü de her zaman o paletle (beyaz metin, hover:bg-white/10) uyumlu render edilir —
   * uygulamanın aktif light/dark temasından ETKİLENMEZ.
   * `default`: Topbar gibi temaya duyarlı alanlarda, aktif temanın normal token'larını kullanır.
   */
  variant?: "default" | "sidebar";
  className?: string;
}

export function ThemeToggle({ variant = "default", className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  // next-themes sunucuda `theme` değerini bilemez (localStorage istemciye özeldir), bu yüzden
  // ilk render'da temaya bağlı hiçbir şey göstermiyoruz — hydration mismatch riskini önlemek için
  // standart next-themes deseni.
  React.useEffect(() => {
    // Kaçınılmaz next-themes hydration deseni: sunucu/istemci uyuşmazlığını önlemek için
    // ilk client render'dan sonra bir kez senkron olarak "mounted" işaretlenir.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const current = (mounted ? (theme as ThemeValue | undefined) : undefined) ?? "system";
  const ActiveIcon = THEME_OPTIONS.find((option) => option.value === current)?.icon ?? Monitor;
  const isSidebar = variant === "sidebar";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Temayı değiştir"
            className={cn(
              "overflow-hidden",
              isSidebar
                ? "text-white/55 hover:bg-white/10 hover:text-white"
                : "text-muted-foreground hover:text-foreground",
              className
            )}
          />
        }
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={mounted ? current : "placeholder"}
            initial={{ opacity: 0, rotate: -90, scale: 0.5 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 90, scale: 0.5 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex"
          >
            <ActiveIcon className="h-4 w-4" aria-hidden="true" />
          </motion.span>
        </AnimatePresence>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className={cn(
          isSidebar &&
            "border border-white/10 bg-[#14141d] text-white shadow-[0_10px_40px_rgba(0,0,0,0.5)] ring-white/10"
        )}
      >
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => withSmoothThemeTransition(() => setTheme(value))}
            className={cn(
              current === value && "font-medium",
              isSidebar && "text-white/70 focus:bg-white/10 focus:text-white"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
