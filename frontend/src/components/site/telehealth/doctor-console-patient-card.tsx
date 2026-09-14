"use client";

import { Ban, CalendarX2, IdCard, NotebookPen, Paperclip } from "lucide-react";
import type { AppointmentBooking } from "@/lib/api/types";
import { formatFullDayLabel, formatTime } from "@/lib/telehealth-format";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AppointmentStatusBadge } from "@/components/site/telehealth/appointment-status-badge";
import { JoinMeetingButton } from "@/components/site/telehealth/join-meeting-button";

/**
 * `.claude/design-notes-doctor-portfolio-console.md` §3.4 — doktor konsolu hasta kartı anatomisi.
 * [TDN] §12.5'in kart/tablo iskeletini genişletmek yerine (kimlik rozetleri/yaklaşık yaş/kalan
 * süre rozeti/üç aksiyonluk yeni bileşim [TDN]'in dar tablo sütunlarına SIĞMADIĞI için) TEK,
 * responsive bir kart düzeni kullanılır — mobil/masaüstü AYNI bileşen, yalnızca `sm:` ile
 * yatay hizalanır (bilinçli basitleştirme, frontend-agent kararı).
 *
 * Grid görevi (2026-09-14) Görev 3 — kart üç bölgeye ayrıldı: Sol (saat/tarih + durum rozeti),
 * Orta (`Avatar` + isim/yaş/kimlik/belge rozetleri), Sağ (birincil `JoinMeetingButton` + ikincil
 * "Konsültasyon Notu Ekle"). Mobilde (`sm:` altı) `flex-col` ile ÜÇ bölge dikey istiflenir — aynı
 * desen, sadece bölge sayısı ikiden üçe çıktı. Yeni bir "Detaylar" aksiyonu EKLENMEDİ: booking'in
 * detaylarına dair anlamlı, GERÇEK bir hedef (mevcut `BookingDocumentsDialog`'dan FARKLI) yok —
 * icat edilmiş bir no-op buton yerine mevcut iki aksiyon (Not Ekle + Katıl) yeni düzene taşındı.
 *
 * ui-designer inceltme turu (2026-09-14) — kurumsal EHR hissi için sol saat bloğu `bg-surface-muted`
 * (mevcut token, YENİ RENK YOK) ile hafifçe zeminlendirildi ve saat tipografisi büyütüldü/kalınlaştırıldı
 * (EHR'lerde randevu saati en belirgin öğedir); kart geneline `shadow-sm` eklendi (ana alanın
 * `doctor-console-overview-cards.tsx` ile AYNI derinlik dili — `portfolio-card.tsx`'teki mevcut
 * `shadow-sm` kullanım hassasiyetiyle tutarlı).
 */

interface DoctorConsolePatientCardProps {
  booking: AppointmentBooking;
  /** `overview.generatedAt` + istemci saatiyle kalibre edilmiş "şu an" (ms) — [DPI] §3.1. */
  calibratedNowMs: number;
  /** Doktorun `DoctorProfile.timeZone`'u — randevu saati/gün etiketleri bu dilimde gösterilir. */
  timeZone: string;
  onOpenDocuments: () => void;
  onOpenNoteEditor: () => void;
}

function ApproxAgeLabel({ birthYear }: { birthYear: number }) {
  const currentYear = new Date().getUTCFullYear();
  const approxAge = currentYear - birthYear;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="shrink-0 text-xs text-foreground/50" />}>~{approxAge} yaş</TooltipTrigger>
      <TooltipContent>Yalnızca doğum yılından hesaplanan yaklaşık yaş</TooltipContent>
    </Tooltip>
  );
}

/**
 * [DPI] §2.7 — `identity` iki AYRI durumu ifade eder (yetki yetersiz VEYA hiç alınmamış); UI
 * ikisini AYIRT ETMEZ. Grid görevi (2026-09-14) Görev 2 madde 2 — etiket "Doğrulanmamış" olarak
 * DEĞİŞTİRİLDİ (eski "Kimlik bilgisi alınmadı" fazla teknikti), zaten soluk `border-dashed`
 * stili bir ton daha soluklaştırıldı (`border-border/70` → `/50`, `text-foreground/40` → `/35`).
 */
function IdentityBadge({ maskedNumber }: { maskedNumber: string | null }) {
  if (maskedNumber) {
    return (
      <Badge tone="neutral" size="sm" className="gap-1 font-mono tabular-nums">
        <IdCard className="h-3 w-3" aria-hidden="true" />
        {maskedNumber}
      </Badge>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[var(--site-radius)] border border-dashed border-border/50 px-2 py-1 text-xs text-foreground/35">
      <Ban className="h-3 w-3" aria-hidden="true" />
      Doğrulanmamış
    </span>
  );
}

export function DoctorConsolePatientCard({ booking, calibratedNowMs, timeZone, onOpenDocuments, onOpenNoteEditor }: DoctorConsolePatientCardProps) {
  // Grid görevi (2026-09-14) Görev 2 madde 1 — SORU backend-agent'a: bazı booking'lerde
  // `appointments` BOŞ geliyor ("Randevu saati yok" dalı buradan tetikleniyordu). Bu turda
  // GÖZLEMLENEN: dev/e2e veri setinde bu duruma rastlamadım (grep ile bulunan tüm booking
  // fixture'ları en az 1 appointment içeriyordu) — kök neden ARAŞTIRILMADI (bu frontend-agent'ın
  // kapsamı DIŞINDA). Backend-agent lütfen doğrulasın: bu alan hangi akışta (iptal/taşıma/migrasyon?)
  // boş dönebiliyor, gerçekten VERİ eksikliği mi yoksa serialization/join sorgusu mu?
  const firstAppointment = booking.appointments[0];
  const status = firstAppointment?.status;
  const showRemainingBadge = status === "SCHEDULED" || status === "IN_PROGRESS";
  const showDocumentsIndicator = booking.documentCount > 0 || booking.hasIntakeNote;

  return (
    <div className="rounded-[var(--site-radius)] border border-border bg-surface p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        {/* Sol bölge: zaman & durum — kurumsal EHR'lerde en belirgin öğe, hafif zeminlendirildi */}
        <div className="flex shrink-0 flex-row items-center justify-between gap-2 rounded-[var(--site-radius)] bg-surface-muted p-3 sm:w-36 sm:flex-col sm:items-start sm:justify-center sm:gap-1.5">
          {firstAppointment ? (
            <div>
              <p className="text-base font-bold tabular-nums tracking-tight text-foreground">
                {formatTime(firstAppointment.startsAt, timeZone)} - {formatTime(firstAppointment.endsAt, timeZone)}
              </p>
              <p className="mt-0.5 text-xs font-medium text-foreground/60">{formatFullDayLabel(firstAppointment.startsAt, timeZone)}</p>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-foreground/35">
              <CalendarX2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <p className="text-xs">Randevu saati bilgisi eksik</p>
            </div>
          )}
          {status && !showRemainingBadge && <AppointmentStatusBadge status={status} size="sm" />}
        </div>

        {/* Orta bölge: hasta künyesi */}
        <div className="flex min-w-0 flex-1 items-start gap-3 border-t border-border/60 pt-3 sm:border-t-0 sm:border-l sm:border-border/60 sm:items-center sm:pt-0 sm:pl-4">
          <Avatar name={booking.patientName} size={40} />
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-baseline gap-1.5">
              <p className="truncate text-sm font-semibold text-foreground">{booking.patientName}</p>
              {booking.identity && <ApproxAgeLabel birthYear={booking.identity.birthYear} />}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <IdentityBadge maskedNumber={booking.identity?.maskedNumber ?? null} />
              {showDocumentsIndicator && (
                <button
                  type="button"
                  onClick={onOpenDocuments}
                  className="inline-flex items-center gap-1.5 rounded-[var(--site-radius)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  <Badge tone="primary" solid size="sm" className="gap-1">
                    <Paperclip className="h-3 w-3" aria-hidden="true" />
                    Tıbbi Belgeler {booking.documentCount > 0 ? `(${booking.documentCount})` : ""}
                  </Badge>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Sağ bölge: hiyerarşik aksiyonlar — birincil (Katıl) üstte/öne çıkan, ikincil (Not Ekle) altında */}
        <div className="flex shrink-0 flex-col items-stretch gap-2 border-t border-border/60 pt-3 sm:w-auto sm:items-end sm:border-t-0 sm:border-l sm:border-border/60 sm:pt-0 sm:pl-4">
          <JoinMeetingButton
            booking={booking}
            size="sm"
            mergeRemainingTime
            timeZone={timeZone}
            nowMs={calibratedNowMs}
            activeLabel="Odaya Katıl"
            activeVariant="success"
          />
          <Button type="button" variant="outline" size="sm" onClick={onOpenNoteEditor} className="gap-1.5 rounded-[var(--site-radius)]">
            <NotebookPen className="h-3.5 w-3.5" aria-hidden="true" />
            Konsültasyon Notu Ekle
          </Button>
        </div>
      </div>
    </div>
  );
}
