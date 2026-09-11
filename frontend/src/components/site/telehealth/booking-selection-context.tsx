"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AvailabilitySlot } from "@/lib/api/types";

/**
 * `.claude/design-notes-telehealth.md` §2.4 — "Hizmet Özeti" paneli artık `AvailabilityCalendar`
 * (sol sütun) ile AYNI "seçilen randevu" bilgisini (§2.4.4, sağ sütun) göstermek zorunda. İkisi
 * `doctors/[slug]/page.tsx`'te KARDEŞ Server Component ağaçlarının İÇİNDE render edildiği için
 * (grid'in sol/sağ sütunları) prop drilling ile paylaşılamaz — bu yüzden ikisini de saran TEK bir
 * Client Context sağlayıcısı (`state yönetimi için Context` — frontend-agent scope) `selectedSlot`
 * VE saat-dilimi-duyarlı `displayTimeZone`'u TEK bir doğruluk kaynağında tutar.
 *
 * Mimari §4.2 bağlayıcı — hidrasyon uyuşmazlığı: `visitorTimeZone` YALNIZCA mount SONRASI
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` ile okunur; mount öncesi/SSR sırasında
 * sunucudan gelen (dolayısıyla SSR/istemç arasında AYNI) `doctorTimeZone` fallback'i kullanılır
 * (`availability-calendar.tsx`'in ÖNCEKİ sürümündeki AYNI kök-neden düzeltmesi, artık BURADA
 * merkezi).
 *
 * ÖNEMLİ — randevu oluşturma payload'ı: bu context SADECE UI/durum GÖSTERİMİ içindir
 * (`selectedSlot` state'inin KENDİSİ). `POST /appointments`'e giden `startsAt` değeri hâlâ
 * `AvailabilityCalendar::onSubmit`'in doğrudan `selectedSlot.startsAt`'ı okumasıyla (context
 * üzerinden AYNI referans) üretilir — biçim/anlam DEĞİŞMEDİ, yalnızca state'in SAHİPLİĞİ bu
 * sağlayıcıya taşındı.
 */
interface BookingSelectionContextValue {
  selectedSlot: AvailabilitySlot | null;
  setSelectedSlot: (slot: AvailabilitySlot | null) => void;
  /** Ziyaretçi dilimi bilinmiyorsa (mount öncesi) `doctorTimeZone`'a düşer — §4.2. */
  displayTimeZone: string;
  visitorTimeZone: string | undefined;
  doctorTimeZone: string;
}

const BookingSelectionContext = createContext<BookingSelectionContextValue | null>(null);

export function BookingSelectionProvider({ doctorTimeZone, children }: { doctorTimeZone: string; children: ReactNode }) {
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  const [visitorTimeZone, setVisitorTimeZone] = useState<string | undefined>(undefined);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ziyaretçi dilimi yalnızca istemcide okunabilir (Intl), bu değeri React dışı bir kaynaktan React state'ine SENKRONİZE etmenin tek yolu budur (§4.2)
    setVisitorTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  const displayTimeZone = visitorTimeZone ?? doctorTimeZone;

  return (
    <BookingSelectionContext.Provider value={{ selectedSlot, setSelectedSlot, displayTimeZone, visitorTimeZone, doctorTimeZone }}>
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
