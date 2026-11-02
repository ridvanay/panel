import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-12">
      <Card className="w-full max-w-sm text-center">
        <p className="text-sm font-medium text-primary">404</p>
        <h1 className="mt-1 text-xl font-semibold text-foreground">Page not found</h1>
        <p className="mt-2 text-sm text-foreground/60">The page you are looking for may have been moved or removed.</p>
        <LinkButton href="/" className="mt-6 justify-center">
          Back to home
        </LinkButton>
      </Card>
    </main>
  );
}
