"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AvailabilitySlot } from "@/lib/api/types";
import { MAX_BOOKING_SLOTS } from "@/lib/api/types";
import { formatDayKey } from "@/lib/telehealth-format";

/**
 * `.claude/design-notes-telehealth.md` §2.4/§12.2 — "Hizmet Özeti" paneli artık
 * `AvailabilityCalendar` (sol sütun) ile AYNI ÇOKLU slot seçimini (§12.2.4, sağ sütun)
 * göstermek zorunda. İkisi `doctors/[slug]/page.tsx`'te KARDEŞ Server Component ağaçlarının
 * İÇİNDE render edildiği için (grid'in sol/sağ sütunları) prop drilling ile paylaşılamaz —
 * bu yüzden ikisini de saran TEK bir Client Context sağlayıcısı `selectedSlots` VE
 * saat-dilimi-duyarlı `displayTimeZone`'u TEK bir doğruluk kaynağında tutar.
 *
 * [TCT] §9.7.2 (bağlayıcı) — `selectedSlot` (tekil) `selectedSlots` (1..4, AYNI güne ait)
 * olarak GENİŞLETİLDİ. Tekil-slot varsayımı KALDIRILDI — bu bilinçli bir kırılma, tek doğruluk
 * kaynağı bu context'tir (`availability-calendar.tsx`/`doctor-service-summary.tsx` İKİSİ de
 * bu genişletilmiş şekli tüketir).
 *
 * Mimari §4.2 bağlayıcı — hidrasyon uyuşmazlığı: `visitorTimeZone` YALNIZCA mount SONRASI
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` ile okunur; mount öncesi/SSR sırasında
 * sunucudan gelen (dolayısıyla SSR/istemci arasında AYNI) `doctorTimeZone` fallback'i kullanılır.
 *
 * ÖNEMLİ — randevu oluşturma payload'ı: bu context SADECE UI/durum GÖSTERİMİ içindir.
 * `POST /appointments/bookings`'e giden `slots` değeri hâlâ `AvailabilityCalendar::onSubmit`'in
 * doğrudan `selectedSlots.map(s => s.startsAt)`'ı okumasıyla üretilir; tutar (`totalCents`)
 * İSTEMCİDEN ASLA gönderilmez — yalnızca gösterim amaçlı yerel bir çarpım (§12.2.4).
 */
interface BookingSelectionContextValue {
  selectedSlots: AvailabilitySlot[];
  /**
   * §12.2.1/§12.2.3 — müsait bir slota tıklamak onu kümeye EKLER; zaten seçili bir slota
   * TEKRAR tıklamak kümeden ÇIKARIR (checkbox benzeri toggle, radio DEĞİL). Farklı bir GÜNE
   * ait bir slot seçilirse önceki seçim OTOMATİK temizlenir ve `true` döner (çağıran taraf
   * bunu bir bilgi notu göstermek için kullanır); aksi hâlde `false` döner. 4 slot doluyken
   * yeni (henüz seçilmemiş) bir slot eklenmeye çalışılırsa YOK SAYILIR (`false` döner).
   */
  toggleSlot: (slot: AvailabilitySlot, timeZone: string) => { dayChanged: boolean; limitReached: boolean };
  removeSlot: (slot: AvailabilitySlot) => void;
  clearAllSlots: () => void;
  /** Ziyaretçi dilimi bilinmiyorsa (mount öncesi) `doctorTimeZone`'a düşer — §4.2. */
  displayTimeZone: string;
  visitorTimeZone: string | undefined;
  doctorTimeZone: string;
}

const BookingSelectionContext = createContext<BookingSelectionContextValue | null>(null);

export function BookingSelectionProvider({ doctorTimeZone, children }: { doctorTimeZone: string; children: ReactNode }) {
  const [selectedSlots, setSelectedSlots] = useState<AvailabilitySlot[]>([]);
  const [visitorTimeZone, setVisitorTimeZone] = useState<string | undefined>(undefined);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ziyaretçi dilimi yalnızca istemcide okunabilir (Intl), bu değeri React dışı bir kaynaktan React state'ine SENKRONİZE etmenin tek yolu budur (§4.2)
    setVisitorTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  const displayTimeZone = visitorTimeZone ?? doctorTimeZone;

  function toggleSlot(slot: AvailabilitySlot, timeZone: string): { dayChanged: boolean; limitReached: boolean } {
    let dayChanged = false;
    let limitReached = false;

    setSelectedSlots((prev) => {
      const alreadySelected = prev.some((s) => s.startsAt === slot.startsAt);
      if (alreadySelected) {
        return prev.filter((s) => s.startsAt !== slot.startsAt);
      }

      // §12.2.3 — farklı bir takvim günü seçildiyse önceki seçim OTOMATİK temizlenir, yeni
      // slot TEK BAŞINA seçili olur (409 ÜRETİLMEZ, saf istemci-tarafı state geçişi).
      if (prev.length > 0 && formatDayKey(prev[0]!.startsAt, timeZone) !== formatDayKey(slot.startsAt, timeZone)) {
        dayChanged = true;
        return [slot];
      }

      if (prev.length >= MAX_BOOKING_SLOTS) {
        limitReached = true;
        return prev;
      }

      return [...prev, slot].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    });

    return { dayChanged, limitReached };
  }

  function removeSlot(slot: AvailabilitySlot) {
    setSelectedSlots((prev) => prev.filter((s) => s.startsAt !== slot.startsAt));
  }

  function clearAllSlots() {
    setSelectedSlots([]);
  }

  return (
    <BookingSelectionContext.Provider
      value={{ selectedSlots, toggleSlot, removeSlot, clearAllSlots, displayTimeZone, visitorTimeZone, doctorTimeZone }}
    >
      {children}
    </BookingSelectionContext.Provider>
  );
}

export function useBookingSelection(): BookingSelectionContextValue {
  const ctx = useContext(BookingSelectionContext);
  if (!ctx) {
    throw new Error("useBookingSelection() bir BookingSelectionProvider'ın İÇİNDE çağrılmalıdır.");
  }
  return ctx;
}
