"use client";

import { useState } from "react";
import { Ban, Clock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocalizePath } from "@/context/locale-alternates-context";
import type { AppointmentBooking } from "@/lib/api/types";
import { SITE_ORIGIN } from "@/lib/doctor-host";
import { EARLY_JOIN_WARNING_THRESHOLD_MINUTES, formatDayLabel, formatTime } from "@/lib/telehealth-format";
import { cn } from "@/lib/utils";

/**
 * `.claude/design-notes-telehealth.md` §12.5.3 — "Toplantıya Katıl" CTA, aktif/pasif durumları.
 * `disabled` bir `<a>`/`<button>` fare/klavye odağını ALMADIĞI için Tooltip tetiklenmez; bu
 * yüzden devre dışıyken bir `<span tabIndex={0}>` sarmalayıcı kullanılır (mevcut Tooltip
 * primitifinin önerdiği desen).
 *
 * Grid görevi (2026-09-14) Görev 2 madde 3 — `mergeRemainingTime` OPSİYONEL modu eklendi: doktor
 * konsolu hasta kartında (`doctor-console-patient-card.tsx`) AYRI bir `RemainingTimeBadge` +
 * bu buton İKİ AYRI elemandı (gereksiz tekrar) — bu modda "kalan süre" mantığı (eski
 * `RemainingTimeBadge`'in BİREBİR aynı eşikleri: -15dk/-0dk/pencere içi/pencere sonrası) BU
 * bileşene taşındı.
 *
 * Bug-fix turu (2026-09-15) — backend-agent doktoru `POST .../meeting-token`teki katılım penceresi
 * kontrolünden TAMAMEN muaf tuttu (doktor HER ZAMAN token alabilir, odayı önceden test edebilir).
 * Önceki davranış (`mergeRemainingTime` modunda pencere kapalıyken buton yerine düz `<span>`/
 * `<Badge>` render etmek) doktor konsolunda "Odaya Katıl" butonunun NEREDEYSE HİÇ görünmemesine
 * yol açıyordu. Artık `mergeRemainingTime` modunda HER ZAMAN gerçek, tıklanabilir bir `<a>`
 * render edilir — zaman durumuna göre YALNIZCA görsel varyant/yanındaki rozet değişir:
 *   1) pencere henüz açılmadıysa: `variant="outline"` (soluk) buton + "X dk içinde" uyarı rozeti,
 *   2) pencere açıksa: `activeVariant` (yeşil) buton, rozet yok,
 *   3) pencere kapandıysa: `activeVariant` buton + "Süresi Geçti" nötr rozet (doktor geç kalan bir
 *      görüşmeye de girebilmeli — backend zaten izin veriyor, buton disabled/gizli OLMAZ).
 * Ödeme eksik/randevu yok durumları (nadir görülür) mevcut disabled-tooltip desenine DÜŞER.
 *
 * Varsayılan (`mergeRemainingTime` verilmezse) davranış DEĞİŞMEDİ —`booking-list-view.tsx`/
 * `booking-summary-card.tsx` mevcut disabled-tooltip desenini AYNEN KORUR (qa-agent'ın
 * `telehealth-multi-slot-booking.spec.ts` "madde 24" testi aktif "Toplantıya Katıl" link adına
 * bağımlı, KIRILMAZ).
 *
 * `.claude/architect-scope-support-desk-and-reminders.md` §1.3 — erken katılım güvenlik onay
 * modalı. Bu bileşen projedeki TEK katılım girişidir (`booking-list-view.tsx`,
 * `booking-summary-card.tsx`, `patient-hero-panel.tsx`, `doctor-console-patient-card.tsx` — hasta
 * VE doktor portalları dahil, hepsi bu bileşeni çağırır), bu yüzden modal YALNIZCA burada, tek bir
 * yerde eklenir; çağıran dosyaların hiçbiri değişmez. Davranış: randevu saatine
 * `EARLY_JOIN_WARNING_THRESHOLD_MINUTES`'ten (10dk) FAZLA erken kalınmışsa tıklama
 * `preventDefault` ile durdurulup `ConfirmDialog` (`tone="warning"`) açılır; 10dk VEYA daha az
 * kalmışsa (ya da pencere zaten açıksa/geçmişse) davranış BUGÜNKÜYLE BİREBİR AYNIDIR (doğrudan
 * navigasyon) — regresyon YOK. Aynı randevu için bir kez onaylanınca `sessionStorage` (KESİNLİKLE
 * `localStorage` DEĞİL — paylaşılan cihazda randevu id'si kalıcı iz bırakmasın) anahtarı
 * (`early-join-ack:<appointmentId>`) ile bir daha sorulmaz. Bu bir yetkilendirme sınırı DEĞİLDİR,
 * salt bilgilendirmedir — backend erken katılımı REDDETMEZ (§1.2).
 */
interface JoinMeetingButtonProps {
  booking: Pick<AppointmentBooking, "paymentStatus" | "joinableFrom" | "joinableUntil" | "appointments">;
  /** Hasta için magic-link token'ı — doktor/oturum bağlamında verilmez. */
  accessToken?: string;
  size?: "sm" | "lg";
  /** Doktor konsolu (2026-09-14) — eski `RemainingTimeBadge` mantığını devreye alır. */
  mergeRemainingTime?: boolean;
  /** `mergeRemainingTime` bekleme etiketinin tarih/saat biçimlendirmesi için — verilmezse tarayıcı dilimi. */
  timeZone?: string;
  /** Kalibre edilmiş "şu an" (ms) — verilmezse `Date.now()`. */
  nowMs?: number;
  /** Aktif (katılınabilir) durumdaki buton etiketi. */
  activeLabel?: string;
  /** Aktif durumda `success` (yeşil) mi yoksa varsayılan marka rengi mi kullanılacağı. */
  activeVariant?: "default" | "success";
}

function earlyJoinAckKey(appointmentId: string): string {
  return `early-join-ack:${appointmentId}`;
}

export function JoinMeetingButton({
  booking,
  accessToken,
  size = "sm",
  mergeRemainingTime = false,
  timeZone,
  nowMs,
  activeLabel = "Toplantıya Katıl",
  activeVariant = "default",
}: JoinMeetingButtonProps) {
  const localize = useLocalizePath();
  const firstAppointment = booking.appointments[0];
  // eslint-disable-next-line react-hooks/purity -- `availability-calendar.tsx` İLE AYNI gerekçe: katılım penceresi durumunu "şu an" ile karşılaştırmak GEREKİR, saniyede bir tick atan bir sayaç GEREKMEZ, yalnızca render anındaki an yeterlidir
  const now = nowMs ?? Date.now();
  const [earlyJoinDialogOpen, setEarlyJoinDialogOpen] = useState(false);

  const relativeHref = firstAppointment
    ? localize(`/consultation/${firstAppointment.id}${accessToken ? `?t=${encodeURIComponent(accessToken)}` : ""}`)
    : "#";
  // Doktor konsolu (`mergeRemainingTime=true`) doktor-subdomain izolasyonu açıkken kendi origin'inde
  // (`doktor.siteadi.localhost`) render edilir; `/consultation/...` ise ana site origin'inde yaşar
  // (bkz. `app/[lang]/(site)/consultation/[id]/page.tsx`) ve `doctor-portal-route-guard.tsx`'in
  // `isDoctorPortalRoute()` deseniyle EŞLEŞMEZ — göreceli bir href ile tıklanırsa guard bunu "portal
  // dışı" sanıp anında `/doctor`'a geri yönlendirir (doktor konsültasyon odasına asla ulaşamaz).
  // Bu yüzden bu modda href'i `SITE_ORIGIN` ile MUTLAK yapıyoruz — tarayıcı gerçek bir cross-origin
  // navigasyon yapar, guard hiç devreye girmez. `SITE_ORIGIN` subdomain modu kapalıyken de (tek host)
  // zaten geçerli tek origin olduğu için zararsızdır — `isSubdomainModeEnabled()` kontrolüne gerek yok.
  // Hasta/misafir tarafı (`mergeRemainingTime=false`) zaten ana site origin'inde olduğundan eski
  // göreceli davranışı KORUR.
  const href = mergeRemainingTime && firstAppointment ? `${SITE_ORIGIN}${relativeHref}` : relativeHref;
  const activeButtonClassName = cn(
    buttonVariants({ size, variant: activeVariant === "success" ? "success" : "default" }),
    "rounded-[var(--site-radius)]"
  );

  const isEarlyJoin = Boolean(
    firstAppointment && new Date(firstAppointment.startsAt).getTime() - now > EARLY_JOIN_WARNING_THRESHOLD_MINUTES * 60_000
  );

  function hasAcknowledgedEarlyJoin(): boolean {
    if (!firstAppointment || typeof window === "undefined") return false;
    return window.sessionStorage.getItem(earlyJoinAckKey(firstAppointment.id)) === "1";
  }

  function handleJoinClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (isEarlyJoin && !hasAcknowledgedEarlyJoin()) {
      e.preventDefault();
      setEarlyJoinDialogOpen(true);
    }
  }

  function handleConfirmEarlyJoin() {
    if (firstAppointment && typeof window !== "undefined") {
      window.sessionStorage.setItem(earlyJoinAckKey(firstAppointment.id), "1");
    }
    setEarlyJoinDialogOpen(false);
    window.location.assign(href);
  }

  const earlyJoinDialog = (
    <ConfirmDialog
      open={earlyJoinDialogOpen}
      onOpenChange={setEarlyJoinDialogOpen}
      tone="warning"
      title="Erken Katılım"
      description="Dikkat: Randevu saatinizden erken katılıyorsunuz. Görüşmeyi erken başlatıp sonlandırmanız durumunda, asıl randevu saatinizde odaya yeniden giriş yapılamayabilir. Devam etmek istiyor musunuz?"
      cancelText="Vazgeç"
      confirmText="Anladım, Odaya Katıl"
      onConfirm={handleConfirmEarlyJoin}
    />
  );

  // §mergeRemainingTime — ödeme tamamsa VE katılım penceresi bilgisi mevcutsa, buton HER DURUMDA
  // (pencere açılmamış/açık/kapanmış fark etmeksizin) gerçek, tıklanabilir bir `<a>` olarak render
  // edilir — backend doktoru zaman kısıtlamasından muaf tuttuğu için tıklamak her zaman çalışır
  // (bkz. dosya başı yorum). Zaman durumuna göre YALNIZCA görsel varyant/yanındaki bilgi rozeti
  // değişir; buton asla kaybolmaz.
  if (mergeRemainingTime && firstAppointment && booking.paymentStatus === "PAID" && booking.joinableFrom && booking.joinableUntil) {
    const fromMs = new Date(booking.joinableFrom).getTime();
    const untilMs = new Date(booking.joinableUntil).getTime();
    const resolvedTimeZone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const outlineButtonClassName = cn(buttonVariants({ size, variant: "outline" }), "rounded-[var(--site-radius)]");

    if (now < fromMs - 15 * 60_000) {
      return (
        <>
          <div className="flex flex-col items-end gap-1">
            <a href={href} onClick={handleJoinClick} className={outlineButtonClassName}>
              {activeLabel}
            </a>
            <span className="text-xs text-foreground/60">
              {formatDayLabel(booking.joinableFrom, resolvedTimeZone)} · {formatTime(booking.joinableFrom, resolvedTimeZone)}
            </span>
          </div>
          {earlyJoinDialog}
        </>
      );
    }
    if (now < fromMs) {
      const minutesLeft = Math.max(1, Math.ceil((fromMs - now) / 60_000));
      return (
        <>
          <div className="flex flex-col items-end gap-1">
            <a href={href} onClick={handleJoinClick} className={outlineButtonClassName}>
              {activeLabel}
            </a>
            <Badge tone="warning" solid size="sm" className="gap-1">
              <Clock className="h-3 w-3" aria-hidden="true" />
              {minutesLeft} dk içinde
            </Badge>
          </div>
          {earlyJoinDialog}
        </>
      );
    }
    if (now > untilMs) {
      return (
        <>
          <div className="flex flex-col items-end gap-1">
            <a href={href} onClick={handleJoinClick} className={activeButtonClassName}>
              {activeLabel}
            </a>
            <Badge tone="neutral" size="sm" className="gap-1">
              <Ban className="h-3 w-3" aria-hidden="true" />
              Süresi Geçti
            </Badge>
          </div>
          {earlyJoinDialog}
        </>
      );
    }
    // Pencere şu an AÇIK — sade aktif buton, ek rozet yok.
    return (
      <>
        <a href={href} onClick={handleJoinClick} className={activeButtonClassName}>
          {activeLabel}
        </a>
        {earlyJoinDialog}
      </>
    );
  }

  // Bug-fix turu (2026-09-15, frontend-agent) — backend `POST .../meeting-token`de booking'e bağlı
  // bir randevu için TEK şart `paymentStatus === "PAID"` (zaman penceresi backend'de TAMAMEN
  // kalktı, hem doktor hem hasta için). Bu client-side kontrolün eskiden `joinableFrom`/
  // `joinableUntil`e bakan kısmı backend'den DAHA SIKI davranıp butonu erken/gereksiz yere
  // devre dışı bırakıyordu — TEK kalan kısıt artık ödeme durumu.
  let disabled = true;
  let disabledReason = "Görüşme bilgisi bulunamadı.";

  if (booking.paymentStatus !== "PAID") {
    disabledReason = "Görüşmeye katılmak için önce ödeme tamamlanmalıdır.";
  } else {
    disabled = false;
  }

  if (!firstAppointment) disabled = true;

  if (!disabled) {
    return (
      <>
        <a href={href} onClick={handleJoinClick} className={activeButtonClassName}>
          {activeLabel}
        </a>
        {earlyJoinDialog}
      </>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="button"
            aria-disabled="true"
            tabIndex={0}
            className={cn(buttonVariants({ size }), "rounded-[var(--site-radius)] pointer-events-none aria-disabled:opacity-50")}
          />
        }
      >
        {activeLabel}
      </TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}
