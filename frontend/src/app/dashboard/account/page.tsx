"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/context/auth-context";
import * as usersApi from "@/lib/api/users";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

export default function AccountPage() {
  const { user, refreshSession } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    setSaving(true);
    try {
      await usersApi.updateMe({ name, avatarUrl: avatarUrl || undefined });
      await refreshSession();
      setSuccess(true);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!user) return null;

  return (
    <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold text-foreground">Hesap ayarları</h1>

      <Card className="mt-6">
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          {error && <Alert variant="error">{error}</Alert>}
          {success && <Alert variant="success">Bilgileriniz güncellendi.</Alert>}

          <Field id="name" label="Ad Soyad" required>
            {(inputProps) => (
              <Input {...inputProps} required value={name} onChange={(e) => setName(e.target.value)} />
            )}
          </Field>

          <Field id="avatarUrl" label="Avatar URL" hint="Boş bırakabilirsiniz.">
            {(inputProps) => (
              <Input {...inputProps} type="url" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
            )}
          </Field>

          <p className="text-sm text-foreground/60">E-posta: {user.email}</p>

          <Button type="submit" loading={saving}>
            Kaydet
          </Button>
        </form>
      </Card>
    </div>
  );
}
