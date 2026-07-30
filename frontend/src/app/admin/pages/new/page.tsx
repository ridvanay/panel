"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import * as pagesApi from "@/lib/api/pages";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
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
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold text-foreground">Yeni Sayfa</h1>
      <p className="mt-1 text-sm text-foreground/60">Başlığı girin, ardından içerik ve blokları düzenleme ekranında ekleyin.</p>

      <Card className="mt-6">
        {error && (
          <Alert variant="error" className="mb-4">
            {error}
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
    </div>
  );
}
