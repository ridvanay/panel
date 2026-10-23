"use client";

import { Suspense } from "react";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { AuthLink } from "@/components/auth/auth-link";
import { LoginForm } from "@/components/auth/login-form";
import { Spinner } from "@/components/ui/spinner";
import { useAuthStrings } from "@/lib/i18n/use-auth-strings";

export default function LoginPage() {
  const t = useAuthStrings().login;
  return (
    <AuthPageShell
      title={t.title}
      subtitle={t.subtitle}
      footer={
        <>
          {t.noAccount}{" "}
          <AuthLink href="/register" className="font-medium text-primary hover:underline">
            {t.registerLink}
          </AuthLink>
        </>
      }
    >
      <Suspense fallback={<Spinner className="h-5 w-5 text-primary" />}>
        <LoginForm />
      </Suspense>
    </AuthPageShell>
  );
}
