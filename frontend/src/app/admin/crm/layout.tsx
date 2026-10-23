"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Radar, ShieldAlert } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { PageHeading } from "@/components/admin/page-heading";
import { Alert } from "@/components/ui/alert";
import { CRM_SECTIONS } from "@/components/admin/crm/crm-sections";
import { cn } from "@/lib/utils";

/**
 * Paket N — CRM bölümü kabuğu: başlık + ekranlar arası sekmeler + erişim kapısı. Sunucu her uçta ADMIN +
 * 2FA şartını AYRICA uygular (`requireCrmAccess`); buradaki kontrol yalnızca kırık ekran yerine açıklayıcı
 * bir uyarı göstermek içindir.
 */
export default function CrmLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();

  if (!user) return null;

  if (user.role !== "ADMIN") {
    return (
      <div className="space-y-6">
        <PageHeading icon={Radar} title="CRM" />
        <Alert variant="error">CRM yalnızca yöneticilere (ADMIN) açıktır.</Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeading
        icon={Radar}
        title="CRM"
        description="Ziyaretçi analitiği, talep yönetimi ve hasta yolculuğu. Veriler yalnızca analitik çerez onayı veren ziyaretçilerden toplanır."
      />
      {!user.twoFactorEnabled ? (
        <Alert variant="error">
          <span className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              CRM kişisel ve sağlıkla ilgili veri içerebileceği için yalnızca iki adımlı doğrulaması (2FA) açık yönetici
              hesaplarına açıktır.{" "}
              <Link href="/admin/settings/security" className="font-medium underline">
                2FA&apos;yı şimdi açın
              </Link>
              .
            </span>
          </span>
        </Alert>
      ) : (
        <>
          <nav aria-label="CRM ekranları" className="-mx-1 overflow-x-auto">
            <ul className="flex min-w-max gap-1 px-1">
              {CRM_SECTIONS.map((section) => {
                const active = section.href === "/admin/crm" ? pathname === "/admin/crm" : pathname.startsWith(section.href);
                return (
                  <li key={section.href}>
                    <Link
                      href={section.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors",
                        active ? "bg-primary/10 font-semibold text-primary" : "text-foreground/70 hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <section.icon className="h-4 w-4" aria-hidden="true" />
                      {section.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          {children}
        </>
      )}
    </div>
  );
}
