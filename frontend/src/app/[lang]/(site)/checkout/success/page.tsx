"use client";

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { useLocalizePath } from "@/context/locale-alternates-context";

export default function CheckoutSuccessPage() {
  const localize = useLocalizePath();
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-20 text-center sm:px-6">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success">
        <CheckCircle2 className="h-7 w-7" />
      </span>
      <h1 className="text-2xl font-semibold text-foreground">Ödemeniz alındı, teşekkürler!</h1>
      <p className="text-sm text-foreground/60">
        Siparişiniz başarıyla oluşturuldu. Sipariş detaylarını e-posta adresinize gönderdik.
      </p>
      <Link href={localize("/products")} className="mt-2 text-sm font-medium text-primary hover:underline">
        Alışverişe devam et
      </Link>
    </div>
  );
}
