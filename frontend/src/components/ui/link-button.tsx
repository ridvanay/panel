import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { buttonBaseClasses, buttonSizeClasses, buttonVariantClasses, type ButtonSize, type ButtonVariant } from "./button-styles";

interface LinkButtonProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/**
 * `Button` ile aynı görünüm, ama `<a>` (Next `Link`) render eder. `<Link><Button/></Link>`
 * gibi bir anchor içine interaktif `<button>` gömmek geçersiz HTML'dir — gezinme amaçlı
 * "buton görünümlü" öğeler için bunun yerine bu bileşeni kullanın.
 */
export function LinkButton({ className, variant = "primary", size = "md", ...props }: LinkButtonProps) {
  return (
    <Link className={cn(buttonBaseClasses, buttonVariantClasses[variant], buttonSizeClasses[size], className)} {...props} />
  );
}
