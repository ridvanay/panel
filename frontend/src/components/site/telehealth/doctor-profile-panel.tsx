"use client";

import { ShieldCheck } from "lucide-react";
import { useDoctorPortalProfile } from "@/components/site/telehealth/doctor-portal-shell";
import { formatPriceFromCents } from "@/lib/format-price";
import { Badge } from "@/components/ui/badge";

/** `.claude/architect-scope-telehealth-template.md` §9.7.7 — `/doctor/profile`, salt-okunur özet. */
export function DoctorProfilePanel() {
  const profile = useDoctorPortalProfile();
  const { doctorProfile } = profile;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Profilim</h1>
        <p className="mt-1 text-sm text-foreground/60">Doktor profiliniz ve hesap güvenlik durumunuz.</p>
      </div>

      <div className="rounded-[var(--site-radius)] border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {doctorProfile.title} {doctorProfile.fullName}
            </p>
            <p className="text-xs text-foreground/60">{doctorProfile.specialty?.name ?? "Genel Danışmanlık"}</p>
          </div>
          {profile.twoFactorEnabled && (
            <Badge tone="success" solid size="sm" className="gap-1">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              2FA Etkin
            </Badge>
          )}
        </div>

        <div className="my-4 border-t border-border" />

        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-foreground/50">E-posta</dt>
            <dd className="text-foreground">{profile.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/50">Seans süresi</dt>
            <dd className="text-foreground">{doctorProfile.sessionDurationMin} dakika</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/50">Seans ücreti</dt>
            <dd className="text-foreground">{formatPriceFromCents(doctorProfile.sessionPriceCents, doctorProfile.currency)}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/50">Saat dilimi</dt>
            <dd className="text-foreground">{doctorProfile.timeZone}</dd>
          </div>
        </dl>
      </div>

      <p className="text-xs text-foreground/50">
        Profil bilgilerinizi (unvan, uzmanlık, fiyat, müsaitlik) güncellemek için yönetici ile iletişime geçin.
      </p>
    </div>
  );
}
