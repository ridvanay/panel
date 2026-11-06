"use client";

import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { takeTokenFromLocation } from "@/lib/access-token-url";
import { reloadPage } from "@/lib/page-reload";

/**
 * Paket AP — önizleme belirtecini `#t=` parçasından (eski `?t=` geçiş süresince) alır, adresten siler ve
 * `POST /preview-token` ile o önizleme yoluna kapsanan HttpOnly çereze yazdırır (bkz.
 * `lib/blog/preview-cookie.ts`). İçerik henüz yoksa sayfayı TAM yeniler (adres artık token'sız): sunucu belirteci
 * çerezden okur; belirteç geçersizse yenilenen sayfada `#` parçası olmadığı için 404 verilir. Yumuşak yenileme
 * (`router.refresh`) aynı bileşeni yeniden bağlamadığından geçersiz belirteçte sonsuz bekleme olurdu.
 * Belirteç yoksa ya da geçersizse önceki davranışla aynı: 404.
 */
export function BlogPreviewTokenBootstrap({ postId, hasContent }: { postId: string; hasContent: boolean }) {
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const token = takeTokenFromLocation({ hashKey: "t", legacyQueryKey: "t" });
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- `#` parçası yalnızca tarayıcıda okunabilir; mount'ta bir kez
      if (!hasContent) setMissing(true);
      return;
    }
    fetch("/preview-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ postId, token, path: window.location.pathname }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        if (!hasContent) reloadPage();
      })
      .catch(() => {
        if (!hasContent) setMissing(true);
      });
  }, [postId, hasContent]);

  if (missing) notFound();
  if (hasContent) return null;
  return (
    <div className="flex justify-center py-24">
      <Spinner className="h-6 w-6 text-primary" />
    </div>
  );
}
