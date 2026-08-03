import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
import { SITE_URL } from "@/lib/env";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Relative OG image/canonical URL'lerinin doğru mutlak URL'e çözümlenmesi için gerekli.
  metadataBase: new URL(SITE_URL),
  title: {
    default: "SaaS Platform",
    template: "%s · SaaS Platform",
  },
  description: "Ekip ve organizasyon yönetimi için modern SaaS platformu.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="tr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // next-themes <html> üzerinde class="dark"/style="color-scheme" ekleyip kaldırdığı için
      // sunucu/istemci ilk render'ında kaçınılmaz bir farklılık oluşur; bu satır o beklenen
      // farkı bastırır (yalnızca bir seviye derinlikte etkilidir, başka hydration uyarılarını
      // gizlemez).
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
