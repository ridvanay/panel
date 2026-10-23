"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as crmApi from "@/lib/api/crm";
import type { CrmHeatmap } from "@/lib/api/crm";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CrmDateRange, DataTable, KpiCard, defaultRange, type DateRangeValue } from "@/components/admin/crm/crm-ui";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const FRAME_WIDTH = { desktop: 1280, mobile: 390 } as const;

/**
 * Paket N3 — Isı haritası. Sayfa admin içinde `sandbox="allow-same-origin"` (script YOK) bir iframe'de
 * açılır: sitenin JavaScript'i — dolayısıyla takip modülü ve çerez bandı — hiç çalışmaz, bu açılış takip
 * EDİLMEZ. Noktalar önce öğe seçicisi + öğe içi yüzde ile (farklı ekran genişliklerinde doğru yer), öğe
 * bulunamazsa viewport/belge yüzdesiyle konumlanır. Mobil ve masaüstü ayrı; tıklama ısısı ve kaydırma
 * haritası; öfkeli tıklama, ölü tıklama ve "tıklanabilir sanılan" öğeler.
 */
export default function CrmHeatmapPage() {
  const [range, setRange] = useState<DateRangeValue>(defaultRange("30"));
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [view, setView] = useState<"clicks" | "scroll">("clicks");
  const [path, setPath] = useState("");
  const pages = useQuery({ queryKey: ["crm-heatmap-pages", range.from, range.to], queryFn: () => crmApi.getCrmHeatmapPages(range) });
  const selectedPath = path || pages.data?.[0]?.path || "";
  const data = useQuery({
    queryKey: ["crm-heatmap", range.from, range.to, selectedPath, device],
    queryFn: () => crmApi.getCrmHeatmap({ ...range, path: selectedPath, device }),
    enabled: Boolean(selectedPath),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <CrmDateRange value={range} onChange={setRange} />
        <Select aria-label="Sayfa" value={selectedPath} onChange={(e) => setPath(e.target.value)} className="w-auto max-w-sm" dir="ltr">
          {(pages.data ?? []).map((p) => (
            <option key={p.path} value={p.path}>
              {p.path} ({p.pageviews})
            </option>
          ))}
        </Select>
        <Toggle
          label="Cihaz"
          value={device}
          onChange={setDevice}
          options={[
            { value: "desktop", label: "Masaüstü" },
            { value: "mobile", label: "Mobil" },
          ]}
        />
        <Toggle
          label="Görünüm"
          value={view}
          onChange={setView}
          options={[
            { value: "clicks", label: "Tıklama ısısı" },
            { value: "scroll", label: "Kaydırma haritası" },
          ]}
        />
      </div>

      {pages.isError ? (
        <Alert variant="error">{friendlyErrorMessage(pages.error)}</Alert>
      ) : !selectedPath ? (
        pages.isPending ? <Skeleton className="h-96 w-full" /> : <p className="text-sm text-foreground/60">Bu aralıkta ölçülen sayfa yok.</p>
      ) : data.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : data.isError ? (
        <Alert variant="error">{friendlyErrorMessage(data.error)}</Alert>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Sayfa görüntüleme" value={data.data.pageviews} />
            <KpiCard label="Tıklama" value={data.data.clickCount} />
            <KpiCard label="Öfkeli tıklama" value={data.data.rageClicks} hint="1 sn içinde aynı noktaya 3+ tıklama" />
            <KpiCard label="Boş alana tıklama" value={data.data.deadClicks} hint="Link/buton olmayan yere" />
          </div>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Card className="overflow-hidden p-0">
              <HeatmapFrame path={selectedPath} device={device} view={view} data={data.data} />
            </Card>
            <div className="space-y-6">
              <Card className="space-y-2">
                <h2 className="text-sm font-medium">Tıklanabilir sanılan yerler</h2>
                <p className="text-xs text-foreground/60">Link/buton olmadığı hâlde en az iki kez tıklanan öğeler.</p>
                <DataTable
                  caption="Tıklanabilir sanılan yerler"
                  columns={[
                    { key: "sel", label: "Öğe" },
                    { key: "count", label: "Tıklama", numeric: true },
                  ]}
                  rows={data.data.likelyClickable.map((d) => ({
                    id: d.selector,
                    cells: { sel: <code className="break-all text-xs" dir="ltr">{d.selector}</code>, count: d.count },
                  }))}
                  empty="Yok."
                />
              </Card>
              <Card className="space-y-2">
                <h2 className="text-sm font-medium">Öfkeli tıklamalar</h2>
                <DataTable
                  caption="Öfkeli tıklamalar"
                  columns={[
                    { key: "sel", label: "Öğe" },
                    { key: "count", label: "Adet", numeric: true },
                  ]}
                  rows={data.data.rageTargets.map((d) => ({
                    id: d.selector,
                    cells: { sel: <code className="break-all text-xs" dir="ltr">{d.text ?? d.selector}</code>, count: d.count },
                  }))}
                  empty="Yok."
                />
              </Card>
              <Card className="space-y-2">
                <h2 className="text-sm font-medium">Kaydırma derinliği</h2>
                <ul className="space-y-1 text-sm">
                  {data.data.scrollReach.map((b) => (
                    <li key={b.depth} className="flex items-center gap-2">
                      <span className="w-12 tabular-nums text-foreground/60">%{b.depth}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <span className="block h-full bg-primary" style={{ width: `${b.pct}%` }} />
                      </span>
                      <span className="w-10 text-end tabular-nums">%{b.pct}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-foreground/50">{data.data.scrollSamples} sayfa görüntülemesine göre; sayfanın o derinliğine ulaşan kişi oranı.</p>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Toggle<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-sm ${value === o.value ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-muted"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function HeatmapFrame({ path, device, view, data }: { path: string; device: "desktop" | "mobile"; view: "clicks" | "scroll"; data: CrmHeatmap }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = FRAME_WIDTH[device];
  const [height, setHeight] = useState(data.medianDocHeight ?? 2400);
  const [scale, setScale] = useState(1);
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / width));
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [width]);

  const points = useMemo(() => data.points, [data.points]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.("2d");
    if (!canvas || !ctx) return;
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    const doc = (() => {
      try {
        return iframeRef.current?.contentDocument ?? null;
      } catch {
        return null;
      }
    })();

    if (view === "scroll") {
      for (const band of data.scrollReach) {
        const top = ((band.depth - 10) / 100) * height;
        const alpha = 0.55 * (1 - band.pct / 100);
        ctx.fillStyle = `rgba(15, 23, 42, ${alpha})`;
        ctx.fillRect(0, top, width, height / 10);
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fillRect(8, top + 4, 150, 22);
        ctx.fillStyle = "#0f172a";
        ctx.font = "12px sans-serif";
        ctx.fillText(`%${band.depth - 10}–${band.depth}: %${band.pct} ulaştı`, 14, top + 19);
      }
      return;
    }

    for (const p of points) {
      let x = (p.x / 100) * width;
      let y = (p.y / 100) * height;
      if (doc && p.sel && p.ex !== null && p.ey !== null) {
        try {
          const target = doc.querySelector(p.sel);
          if (target) {
            const rect = target.getBoundingClientRect();
            x = rect.left + (p.ex / 100) * rect.width;
            y = rect.top + (p.ey / 100) * rect.height;
          }
        } catch {
          // geçersiz seçici — yüzde konumu kullanılır
        }
      }
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, 22);
      gradient.addColorStop(0, p.rage ? "rgba(147, 51, 234, 0.55)" : p.dead ? "rgba(245, 158, 11, 0.5)" : "rgba(239, 68, 68, 0.45)");
      gradient.addColorStop(1, "rgba(239, 68, 68, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, 22, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [points, view, width, height, data.scrollReach, loaded]);

  return (
    <div ref={containerRef} className="w-full overflow-auto bg-muted/30" style={{ maxHeight: "80vh" }}>
      <div className="relative mx-auto origin-top-left" style={{ width, height, transform: `scale(${scale})`, marginBottom: height * (scale - 1) }}>
        <iframe
          ref={iframeRef}
          title={`Isı haritası önizlemesi: ${path}`}
          src={path}
          sandbox="allow-same-origin"
          referrerPolicy="no-referrer"
          loading="lazy"
          className="pointer-events-none absolute inset-0 border-0 bg-white"
          style={{ width, height }}
          onLoad={() => {
            try {
              const h = iframeRef.current?.contentDocument?.documentElement.scrollHeight;
              if (h && h > 200) setHeight(Math.min(h, 20_000));
            } catch {
              // erişilemedi — medyan belge yüksekliği kullanılır
            }
            setLoaded((n) => n + 1);
          }}
        />
        <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ width, height }} />
      </div>
      <p className="px-3 py-2 text-xs text-foreground/60">
        Kırmızı: tıklama · Turuncu: boş alana tıklama · Mor: öfkeli tıklama. Önizlemede sitenin scriptleri çalışmaz (takip edilmez).
      </p>
    </div>
  );
}
