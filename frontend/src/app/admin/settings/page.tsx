"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ComponentType, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LucideProps } from "lucide-react";
import * as settingsApi from "@/lib/api/settings";
import * as pagesApi from "@/lib/api/pages";
import * as mediaApi from "@/lib/api/media";
import type { SitePage } from "@/lib/api/types";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { AlertCircle, CheckCircle2, ChevronDown, Globe, ImageIcon, Settings2, UploadCloud } from "lucide-react";

const gridVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
} as const;

function DarkField({
  id,
  label,
  hint,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-white/80">
        {label}
        {required && (
          <span className="ml-0.5 text-fuchsia-400" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {hint && <p className="text-xs text-white/40">{hint}</p>}
    </div>
  );
}

function BentoCard({
  title,
  description,
  icon: Icon,
  className,
  children,
}: {
  title: string;
  description: string;
  icon: ComponentType<LucideProps>;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.section
      variants={cardVariants}
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl transition-colors hover:border-white/20",
        className
      )}
    >
      <div className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-br from-indigo-500/0 to-fuchsia-500/0 opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-hover:from-indigo-500/10 group-hover:to-fuchsia-500/10" />
      <div className="relative flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-indigo-300 ring-1 ring-white/10">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <p className="mt-0.5 text-xs text-white/45">{description}</p>
        </div>
      </div>
      <div className="relative mt-5 space-y-4">{children}</div>
    </motion.section>
  );
}

export default function AdminSettingsPage() {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const [siteName, setSiteName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [homePageId, setHomePageId] = useState("");
  const [publishedPages, setPublishedPages] = useState<SitePage[]>([]);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [settings, pages] = await Promise.all([settingsApi.getSettings(), pagesApi.listPages()]);
      setSiteName(settings.siteName);
      setLogoUrl(settings.logoUrl ?? "");
      setHomePageId(settings.homePageId ?? "");
      setPublishedPages(pages.items.filter((page) => page.status === "PUBLISHED"));
      setLoaded(true);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function handleSave() {
    setSaveError(null);
    setSaved(false);
    setSaving(true);
    try {
      await settingsApi.updateSettings({ siteName, logoUrl: logoUrl || null, homePageId: homePageId || null });
      setSaved(true);
    } catch (err) {
      setSaveError(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploadError(null);
    setUploading(true);
    try {
      const media = await mediaApi.uploadMedia(file);
      setLogoUrl(media.url);
    } catch (err) {
      setUploadError(friendlyErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  if (loadError) {
    return (
      <div className="-m-6 flex min-h-[calc(100vh-4rem)] items-center justify-center bg-[#05050a] p-6">
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {loadError}
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="-m-6 flex min-h-[calc(100vh-4rem)] items-center justify-center bg-[#05050a]">
        <Spinner className="h-6 w-6 text-indigo-400" />
      </div>
    );
  }

  return (
    <div className="relative -m-6 min-h-[calc(100vh-4rem)] overflow-hidden bg-[#05050a] p-6 sm:p-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(99,102,241,0.16),transparent_45%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_90%_100%,rgba(217,70,239,0.12),transparent_50%)]" />

      <div className="relative mx-auto max-w-5xl space-y-8 pb-24">
        <div className="flex items-start gap-3 border-b border-white/10 pb-6">
          <motion.span
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-white shadow-[0_0_25px_rgba(129,140,248,0.55)]"
          >
            <Settings2 className="h-5 w-5" />
          </motion.span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Ayarlar</h1>
            <p className="mt-1 text-sm text-white/50">
              Sitenin adı, logosu ve ana sayfası gibi genel ayarlarını buradan yönet.
            </p>
          </div>
        </div>

        <AnimatePresence>
          {(saveError || saved) && (
            <motion.div
              key="settings-status"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-3"
            >
              {saveError && (
                <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {saveError}
                </div>
              )}
              {saved && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Ayarlar kaydedildi.
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          variants={gridVariants}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 gap-4 lg:grid-cols-3"
        >
          <BentoCard
            title="Genel"
            description="Sitenizin adı ve genel kimliği."
            icon={Globe}
            className="lg:col-span-2"
          >
            <DarkField id="siteName" label="Site adı" required>
              <input
                id="siteName"
                required
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-indigo-400/50 focus:ring-2 focus:ring-indigo-500/30"
              />
            </DarkField>
          </BentoCard>

          <BentoCard
            title="Sayfa Ayarları"
            description="Ziyaretçilerin karşılaşacağı ana sayfayı seçin."
            icon={Settings2}
            className="lg:col-span-1"
          >
            <DarkField id="homePageId" label="Ana sayfa" hint="Seçilmezse varsayılan tanıtım sayfası gösterilir.">
              <div className="relative">
                <select
                  id="homePageId"
                  value={homePageId}
                  onChange={(e) => setHomePageId(e.target.value)}
                  className="h-9 w-full appearance-none rounded-lg border border-white/10 bg-white/5 px-3 pr-9 text-sm text-white outline-none transition focus:border-indigo-400/50 focus:ring-2 focus:ring-indigo-500/30"
                >
                  <option value="" style={{ backgroundColor: "#0a0a12", color: "#fff" }}>
                    Varsayılan (tanıtım sayfası)
                  </option>
                  {publishedPages.map((page) => (
                    <option key={page.id} value={page.id} style={{ backgroundColor: "#0a0a12", color: "#fff" }}>
                      {page.title}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-white/40" />
              </div>
            </DarkField>
          </BentoCard>

          <BentoCard
            title="Görünüm"
            description="Sitenizin logosu ve marka görseli."
            icon={ImageIcon}
            className="lg:col-span-3"
          >
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-[240px_1fr]">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- yüklenen/harici görsel URL'si, next/image remotePatterns henüz tanımlı değil
                <img
                  src={logoUrl}
                  alt="Site logosu"
                  className="h-32 w-full rounded-xl border border-white/10 bg-white/5 object-contain sm:h-full"
                />
              ) : (
                <div className="flex h-32 w-full items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/[0.02] text-xs text-white/30 sm:h-full">
                  Logo yok
                </div>
              )}

              <div className="flex flex-col justify-center gap-3">
                <DarkField id="logoUrl" label="Logo URL">
                  <input
                    id="logoUrl"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://…"
                    className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-indigo-400/50 focus:ring-2 focus:ring-indigo-500/30"
                  />
                </DarkField>

                <div>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {uploading ? <Spinner className="h-4 w-4" /> : <UploadCloud className="h-4 w-4" />}
                    Yükle
                  </motion.button>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFile} />
                </div>

                {uploadError && <p className="text-xs text-red-300">{uploadError}</p>}
              </div>
            </div>
          </BentoCard>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.4 }}
        className="sticky bottom-6 z-10 flex justify-end"
      >
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          {saving && <span className="text-xs text-white/50">Kaydediliyor…</span>}
          <motion.button
            type="button"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            disabled={saving}
            onClick={handleSave}
            className="relative inline-flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 text-sm font-medium text-white shadow-[0_0_24px_rgba(129,140,248,0.55)] transition-shadow hover:shadow-[0_0_34px_rgba(129,140,248,0.75)] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
          >
            {saving && <Spinner className="h-4 w-4" />}
            Kaydet
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}
