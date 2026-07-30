"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Copy, UserPlus } from "lucide-react";
import * as usersAdminApi from "@/lib/api/users-admin";
import type { AdminUser, SiteRole } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

interface NewUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (user: AdminUser) => void;
}

/**
 * "Yeni Kullanıcı Ekle" formu. Backend henüz gerçek e-posta göndermediği için
 * yanıtta gelebilecek `setPasswordUrl` (dev-only) kopyalanabilir bir link olarak gösterilir.
 */
export function NewUserDialog({ open, onOpenChange, onCreated }: NewUserDialogProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<SiteRole>("EDITOR");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setPasswordUrl, setSetPasswordUrl] = useState<string | null>(null);

  function resetForm() {
    setName("");
    setEmail("");
    setRole("EDITOR");
    setError(null);
    setSetPasswordUrl(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm();
    onOpenChange(next);
  }

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await usersAdminApi.createAdminUser({ name, email, role });
      toast.success("Kullanıcı oluşturuldu.");
      onCreated(result.user);
      if (result.setPasswordUrl) {
        setSetPasswordUrl(result.setPasswordUrl);
      } else {
        handleOpenChange(false);
      }
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopyLink() {
    if (!setPasswordUrl) return;
    await navigator.clipboard.writeText(setPasswordUrl);
    toast.success("Link kopyalandı.");
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UserPlus className="h-4 w-4" />
            </span>
            <div>
              <DialogTitle>Yeni Kullanıcı Ekle</DialogTitle>
              <DialogDescription className="mt-1">
                Ekibinize yeni bir üye ekleyin ve rolünü belirleyin.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {error && (
          <Alert variant="error">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </span>
          </Alert>
        )}

        {setPasswordUrl ? (
          <div className="space-y-3">
            <Alert variant="success">Kullanıcı başarıyla oluşturuldu.</Alert>
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">
                Şifre belirleme linki (geliştirme ortamı)
              </p>
              <div className="flex items-center gap-2">
                <Input readOnly value={setPasswordUrl} className="text-xs" />
                <Button type="button" variant="outline" size="icon" onClick={handleCopyLink} aria-label="Linki kopyala">
                  <Copy />
                </Button>
              </div>
              <p className="text-xs text-foreground/60">
                Backend henüz gerçek e-posta göndermiyor; bu linki kullanıcıyla siz paylaşın.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Field id="new-user-name" label="Ad Soyad" required>
              {(inputProps) => (
                <Input {...inputProps} required value={name} onChange={(e) => setName(e.target.value)} />
              )}
            </Field>
            <Field id="new-user-email" label="E-posta" required>
              {(inputProps) => (
                <Input
                  {...inputProps}
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            <Field id="new-user-role" label="Rol">
              {(inputProps) => (
                <Select {...inputProps} value={role} onChange={(e) => setRole(e.target.value as SiteRole)}>
                  <option value="ADMIN">Admin</option>
                  <option value="EDITOR">Editor</option>
                  <option value="VIEWER">Viewer</option>
                </Select>
              )}
            </Field>
          </div>
        )}

        <DialogFooter>
          {setPasswordUrl ? (
            <Button type="button" onClick={() => handleOpenChange(false)}>
              Kapat
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Vazgeç
              </Button>
              <Button type="button" loading={submitting} disabled={!name || !email} onClick={handleSubmit}>
                Oluştur
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
