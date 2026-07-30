import Link from "next/link";
import type { ComponentProps } from "react";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

interface LinkButtonProps extends ComponentProps<typeof Link>, VariantProps<typeof buttonVariants> {}

/**
 * `Button` ile aynı görünüm, ama `<a>` (Next `Link`) render eder. `<Link><Button/></Link>`
 * gibi bir anchor içine interaktif `<button>` gömmek geçersiz HTML'dir — gezinme amaçlı
 * "buton görünümlü" öğeler için bunun yerine bu bileşeni kullanın. `button.tsx`'teki
 * `buttonVariants` üzerinden türetilir, böylece `Button` ile birebir aynı variant/size/stil setini paylaşır.
 */
export function LinkButton({ className, variant, size, ...props }: LinkButtonProps) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
