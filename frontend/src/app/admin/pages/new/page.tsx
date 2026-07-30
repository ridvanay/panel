"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AlertCircle, ChevronLeft, FileText } from "lucide-react";
import * as pagesApi from "@/lib/api/pages";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { PageHeading } from "@/components/admin/page-heading";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

export default function NewPagePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const page = await pagesApi.createPage({ title });
      router.push(`/admin/pages/${page.id}`);
    } catch (err) {
      setError(friendlyErrorMessage(err));
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
                <Input {...inputProps} required value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
              )}
            </Field>
            <Button type="submit" loading={creating}>
              Oluştur ve devam et
            </Button>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
