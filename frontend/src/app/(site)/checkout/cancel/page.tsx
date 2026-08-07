import Link from "next/link";
import { XCircle } from "lucide-react";

export default function CheckoutCancelPage() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-20 text-center sm:px-6">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-danger">
        <XCircle className="h-7 w-7" />
      </span>
      <h1 className="text-2xl font-semibold text-foreground">Ödeme iptal edildi</h1>
      <p className="text-sm text-foreground/60">Sepetiniz korunuyor, dilediğiniz zaman tekrar deneyebilirsiniz.</p>
      <Link href="/cart" className="mt-2 text-sm font-medium text-primary hover:underline">
        Sepete dön
      </Link>
    </div>
  );
}
