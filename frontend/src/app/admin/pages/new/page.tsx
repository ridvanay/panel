"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { AlertCircle, ChevronDown, ChevronLeft, FileText, Search } from "lucide-react";
import * as pagesApi from "@/lib/api/pages";
import type { ContentStatus } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Alert } from "@/components/ui/alert";
import { PageHeading } from "@/components/admin/page-heading";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { cn } from "@/lib/cn";

/** Backend'deki `slugify` (bkz. `backend/src/lib/slug.ts`) ile eşdeğer, sadece istemci tarafı önizlemesi içindir. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/ç/g, "c")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ı/g, "i")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Durum seçimi için segmented toggle — Badge'in `warning`/`success` tonlarıyla birebir aynı renkler. */
function StatusToggle({ status, onChange }: { status: ContentStatus; onChange: (status: ContentStatus) => void }) {
  return (
    <div role="group" aria-label="Durum" className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-muted p-1">
      <button
        type="button"
        aria-pressed={status === "DRAFT"}
        onClick={() => onChange("DRAFT")}
        className={cn(
          "inline-flex h-7 items-center rounded-md px-3 text-xs font-medium transition-colors",
          status === "DRAFT" ? "bg-warning/10 text-warning" : "text-foreground/60 hover:text-foreground hover:bg-surface"
        )}
      >
        Taslak
      </button>
      <button
        type="button"
        aria-pressed={status === "PUBLISHED"}
        onClick={() => onChange("PUBLISHED")}
        className={cn(
          "inline-flex h-7 items-center rounded-md px-3 text-xs font-medium transition-colors",
          status === "PUBLISHED" ? "bg-success/10 text-success" : "text-foreground/60 hover:text-foreground hover:bg-surface"
        )}
      >
        Yayında
      </button>
    </div>
  );
}

const GOOGLE_TITLE_LIMIT = 60;
const GOOGLE_DESCRIPTION_LIMIT = 155;

export default function NewPagePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [status, setStatus] = useState<ContentStatus>("DRAFT");
  const [seoOpen, setSeoOpen] = useState(false);
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [ogImageUrl, setOgImageUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleTitleChange(value: string) {
    setTitle(value);
    if (!slugManuallyEdited) {
      setSlug(slugify(value));
    }
  }

  function handleSlugChange(value: string) {
    setSlugManuallyEdited(true);
    setSlug(value);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const page = await pagesApi.createPage({
        title,
        slug: slug || undefined,
        status,
        seoTitle: seoTitle || undefined,
        seoDescription: seoDescription || undefined,
        ogImageUrl: ogImageUrl || undefined,
      });
      toast.success("Sayfa oluşturuldu.");
      router.push(`/admin/pages/${page.id}`);
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setError(message);
      toast.error(message);
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link
        href="/admin/pages"
        className="inline-flex items-center gap-1 text-sm text-foreground/60 transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Sayfalar
      </Link>

      <PageHeading
        icon={FileText}
        title="Yeni Sayfa"
        description="Başlığı girin, ardından içerik ve blokları düzenleme ekranında ekleyin."
      />

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <Card>
          {error && (
            <Alert variant="error" className="mb-4">
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </span>
            </Alert>
          )}
          <form className="space-y-4" onSubmit={handleSubmit} noValidate>
            <Field id="title" label="Başlık" required>
              {(inputProps) => (
                <Input
                  {...inputProps}
                  required
                  value={title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  autoFocus
                />
              )}
            </Field>

            <Field id="slug" label="Slug (URL)" required hint="Boş bırakılırsa başlıktan otomatik oluşturulur.">
              {(inputProps) => (
                <InputGroup>
                  <InputGroupAddon>
                    <InputGroupText>/</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    {...inputProps}
                    value={slug}
                    onChange={(e) => handleSlugChange(e.target.value)}
                    placeholder="ornek-sayfa-slug"
                  />
                </InputGroup>
              )}
            </Field>

            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">Durum</p>
              <StatusToggle status={status} onChange={setStatus} />
            </div>

            <div className="border-t border-border pt-4">
              <button
                type="button"
                onClick={() => setSeoOpen((v) => !v)}
                aria-expanded={seoOpen}
                className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-sm font-medium text-foreground transition-colors hover:text-primary"
              >
                <span className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-foreground/50" />
                  SEO ayarları (opsiyonel)
                </span>
                <ChevronDown
                  className={cn("h-4 w-4 text-foreground/50 transition-transform duration-200", seoOpen && "rotate-180")}
                />
              </button>
              <AnimatePresence initial={false}>
                {seoOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-4 pt-4">
                      <Field id="seoTitle" label="SEO başlığı" hint={`${seoTitle.length}/${GOOGLE_TITLE_LIMIT} karakter`}>
                        {(inputProps) => (
                          <Input {...inputProps} value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} />
                        )}
                      </Field>
                      <Field
                        id="seoDescription"
                        label="SEO açıklaması"
                        hint={`${seoDescription.length}/${GOOGLE_DESCRIPTION_LIMIT} karakter`}
                      >
                        {(inputProps) => (
                          <Textarea
                            {...inputProps}
                            rows={2}
                            value={seoDescription}
                            onChange={(e) => setSeoDescription(e.target.value)}
                          />
                        )}
                      </Field>
                      <ImageUploadField
                        id="ogImageUrl"
                        label="Sosyal medya (OG) görseli"
                        value={ogImageUrl}
                        onChange={setOgImageUrl}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <Button type="submit" loading={creating} disabled={!title.trim()}>
              Oluştur ve devam et
            </Button>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
