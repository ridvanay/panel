import type { ReactNode } from "react";

// TODO: Site ayarlarından (menü/logo) beslenen gerçek bir header/footer ile değiştirilecek.
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1">{children}</main>
    </div>
  );
}
