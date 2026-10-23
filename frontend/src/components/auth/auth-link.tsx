"use client";

import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { isSafeInternalPath } from "@/lib/safe-redirect";

/**
 * Paket O — giriş / kayıt / şifre ekranları arasındaki bağlantılar güvenli `next` parametresini
 * taşır; böylece kullanıcı ekranlar arasında geçerken hem giriş sonrası hedef hem de ekran dili
 * (proxy `next` önekinden okur) korunur. Güvenli olmayan `next` hiç taşınmaz.
 */
function LinkWithNext({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const next = useSearchParams().get("next");
  const target = isSafeInternalPath(next) ? `${href}${href.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}` : href;
  return (
    <Link href={target} className={className}>
      {children}
    </Link>
  );
}

export function AuthLink(props: { href: string; className?: string; children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <Link href={props.href} className={props.className}>
          {props.children}
        </Link>
      }
    >
      <LinkWithNext {...props} />
    </Suspense>
  );
}
