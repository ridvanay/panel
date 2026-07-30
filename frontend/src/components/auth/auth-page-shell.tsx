"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

/** /login, /register, /forgot-password, /reset-password için ortak kabuk: zaten
 * girişliyse /dashboard'a yönlendirir, aksi halde ortalanmış bir kart içinde formu gösterir. */
export function AuthPageShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [status, router]);

  if (status === "authenticated") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6 text-primary" />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Link href="/" className="text-lg font-semibold text-foreground">
            SaaS Platform
          </Link>
        </div>
        <Card>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-foreground/60">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </Card>
        {footer && <p className="mt-4 text-center text-sm text-foreground/60">{footer}</p>}
      </div>
    </main>
  );
}
