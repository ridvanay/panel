"use client"

import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

/**
 * `.claude/design-notes-products-catalog.md` §1.3 — TEK yeni primitif bu turda. `@base-ui/react/slider`
 * zaten proje bağımlılığı; `Switch`/`Checkbox` ile AYNI "primitife ince sarmalayıcı" deseni.
 * Ray/dolgu `h-2 rounded-full bg-muted` — DNS §5 ücretsiz kargo çubuğuyla BİREBİR aynı token'lar.
 */
function Slider({ className, ...props }: SliderPrimitive.Root.Props) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("relative flex w-full items-center py-2", className)}
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full items-center">
        <SliderPrimitive.Track className="h-2 w-full rounded-full bg-muted">
          <SliderPrimitive.Indicator className="h-full rounded-full bg-[var(--site-primary)]" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border-2 border-primary bg-surface shadow-sm outline-none transition-transform duration-150 hover:scale-110 focus-visible:ring-3 focus-visible:ring-ring/50 data-dragging:scale-110" />
        <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border-2 border-primary bg-surface shadow-sm outline-none transition-transform duration-150 hover:scale-110 focus-visible:ring-3 focus-visible:ring-ring/50 data-dragging:scale-110" />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
