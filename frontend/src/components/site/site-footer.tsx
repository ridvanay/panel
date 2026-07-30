interface SiteFooterProps {
  siteName: string;
}

export function SiteFooter({ siteName }: SiteFooterProps) {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-foreground/50 sm:px-6">
        © {new Date().getFullYear()} {siteName}
      </div>
    </footer>
  );
}
