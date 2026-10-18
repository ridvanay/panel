"use client";

import { Ban, CircleCheck, Clock, Undo2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { BookingPaymentStatus } from "@/lib/api/types";
import { usePortalStrings } from "@/lib/i18n/use-portal-strings";

/**
 * `.claude/design-notes-telehealth.md` §12.4 — ödeme durumu rozetleri. HER durumda ikon + metin
 * (renk-körü güvenliği, tek başına renge güvenilmez). `size="sm"` varsayılan/BAĞLAYICI (tablo/kart
 * satırında birçok rozet yan yana görünebilir); `lg` istisnası çağıran tarafın kararıdır.
 */
const CONFIG: Record<BookingPaymentStatus, { tone: "success" | "warning" | "neutral" | "danger"; solid: boolean; Icon: typeof CircleCheck }> = {
  PAID: { tone: "success", solid: true, Icon: CircleCheck },
  PENDING: { tone: "warning", solid: true, Icon: Clock },
  EXPIRED: { tone: "neutral", solid: true, Icon: Ban },
  FAILED: { tone: "danger", solid: true, Icon: XCircle },
  REFUNDED: { tone: "neutral", solid: false, Icon: Undo2 },
};

export function PaymentStatusBadge({ status, size = "sm" }: { status: BookingPaymentStatus; size?: "sm" | "lg" }) {
  const { t } = usePortalStrings();
  const { tone, solid, Icon } = CONFIG[status];
  return (
    <Badge tone={tone} solid={solid} size={size} className="gap-1">
      <Icon className="h-3 w-3" aria-hidden="true" />
      {t.paymentStatus[status]}
    </Badge>
  );
}
