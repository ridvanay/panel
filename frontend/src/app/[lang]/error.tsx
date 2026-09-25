"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { errorStrings as enErrorStrings } from "@/lib/i18n/site-dictionaries/en/errors";
import { errorStrings as trErrorStrings } from "@/lib/i18n/site-dictionaries/tr/errors";

/**
 * Sunucu tarafı veri fetch'leri 429/5xx/ağ hatasında FIRLATIR (bkz. `lib/api/server-fetch.ts`) —
 * önbellekte veri varsa eski içerik sunulur, yoksa bu ekran gösterilir (404 DEĞİL, önbelleğe
 * girmez). `[lang]` segmentinde durur ki `(site)`/`(doctor)` layout'larının kendi hataları da
 * yakalansın (bir segmentin `error.tsx`'i kendi layout'unu sarmaz). Client bileşeni olduğu için
 * sözlüğün yalnızca küçük `errors` parçası statik olarak alınır.
 */
export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const params = useParams<{ lang?: string }>();
  const strings = params?.lang === "tr" ? trErrorStrings : enErrorStrings;

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm text-center">
        <h1 className="text-xl font-semibold text-foreground">{strings.temporaryErrorTitle}</h1>
        <p className="mt-2 text-sm text-foreground/60">{strings.temporaryErrorMessage}</p>
        <Button type="button" onClick={reset} className="mt-6">
          {strings.temporaryErrorRetryLabel}
        </Button>
      </Card>
    </main>
  );
}
