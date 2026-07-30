"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAccent } from "@/context/accent-context";
import { ACCENT_COLORS, type AccentColorKey } from "@/lib/accent-colors";

interface AccentColorPickerProps {
  /**
   * `sidebar`: Sidebar kalıcı olarak koyu/cam temalı olduğu için (bkz. sidebar.tsx) buton ve
   * açılan menü de her zaman o paletle (beyaz metin, hover:bg-white/10) uyumlu render edilir.
   * `default`: Topbar gibi temaya duyarlı alanlarda, aktif temanın normal token'larını kullanır.
   */
  variant?: "default" | "sidebar";
  className?: string;
}

export function AccentColorPicker({ variant = "default", className }: AccentColorPickerProps) {
  const { accent, setAccent, palette } = useAccent();
  const isSidebar = variant === "sidebar";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Vurgu rengini değiştir"
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
        <span
          className="h-4 w-4 rounded-full ring-1 ring-white/20"
          style={{ backgroundColor: palette[500] }}
          aria-hidden="true"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className={cn(
          isSidebar &&
            "border border-white/10 bg-[#14141d] text-white shadow-[0_10px_40px_rgba(0,0,0,0.5)] ring-white/10"
        )}
      >
        {(Object.entries(ACCENT_COLORS) as [AccentColorKey, (typeof ACCENT_COLORS)[AccentColorKey]][]).map(
          ([key, option]) => (
            <DropdownMenuItem
              key={key}
              onClick={() => setAccent(key)}
              className={cn(
                accent === key && "font-medium",
                isSidebar && "text-white/70 focus:bg-white/10 focus:text-white"
              )}
            >
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-white/20"
                style={{ backgroundColor: option[500] }}
                aria-hidden="true"
              />
              {option.label}
              {accent === key && <Check className="ml-auto h-4 w-4" />}
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
