"use client";

import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";

export function Navbar() {
  const { status, logout } = useAuth();

  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6" aria-label="Ana gezinme">
        <Link href="/" className="text-lg font-semibold text-foreground">
          SaaS Platform
        </Link>

        <div className="flex items-center gap-3">
          <Link href="/pricing" className="text-sm text-foreground/70 hover:text-foreground">
            Fiyatlandırma
          </Link>

          {status === "authenticated" ? (
            <>
              <LinkButton href="/dashboard" size="sm" variant="secondary">
                Panele git
              </LinkButton>
              <Button size="sm" variant="ghost" onClick={() => logout()}>
                Çıkış yap
              </Button>
            </>
          ) : status === "unauthenticated" ? (
            <>
              <Link href="/login" className="text-sm text-foreground/70 hover:text-foreground">
                Giriş yap
              </Link>
              <LinkButton href="/register" size="sm">
                Ücretsiz başla
              </LinkButton>
            </>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
