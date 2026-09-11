"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, Search, Stethoscope } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { DoctorProfile } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeading } from "@/components/admin/page-heading";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { ApiClientError } from "@/lib/api/error";
import { formatPriceFromCents } from "@/lib/format-price";
import { toast } from "sonner";
import Link from "next/link";

/**
 * `.claude/architect-scope-telehealth-template.md` §5.1 — doktor listesi. Ürünler listesinin
 * (`admin/products/page.tsx`) AKSİNE `useContentList` (yumuşak silme/çöp/toplu işlem)
 * KULLANILMAZ: `DoctorProfile`'da `deletedAt`/trash kavramı YOK (yalnızca `isActive` +
 * kalıcı silme, bkz. openapi.yaml `DELETE /admin/telehealth/doctors/{doctorId}`).
 */
export default function AdminTelehealthDoctorsPage() {
  const [doctors, setDoctors] = useState<DoctorProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<DoctorProfile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (search?: string) => {
    try {
      const page = await telehealthApi.listAdminDoctors({ search: search || undefined, limit: 100 });
      setDoctors(page.items);
      setError(null);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => void load(search), 250);
    return () => clearTimeout(handle);
  }, [load, search]);

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await telehealthApi.deleteDoctor(pendingDelete.id);
      toast.success("Doktor silindi.");
      setPendingDelete(null);
      await load(search);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        toast.error("Bu doktorun randevu geçmişi var; önce pasife alın.");
      } else {
        toast.error(friendlyErrorMessage(err));
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeading
        icon={Stethoscope}
        title="Doktorlar"
        description="Tele-Sağlık doktor profillerini ve haftalık müsaitliklerini yönetin."
        actions={
          <div className="flex items-center gap-2">
            <LinkButton href="/admin/telehealth/specialties" variant="outline">
              Uzmanlıklar
            </LinkButton>
            <LinkButton href="/admin/telehealth/doctors/new">Yeni Doktor</LinkButton>
          </div>
        }
      />

      {error && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load(search)}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      {doctors === null ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : (
        <>
          <InputGroup className="w-full sm:max-w-xs border-2 border-border bg-muted">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Ada veya slug'a göre ara..."
              aria-label="Doktor ara"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </InputGroup>

          {doctors.length === 0 ? (
            <EmptyState
              icon={Stethoscope}
              title={search ? "Sonuç bulunamadı" : "Henüz doktor yok"}
              description={search ? "Arama kriterlerinize uyan bir doktor yok." : "İlk doktor profilinizi oluşturarak başlayın."}
              action={!search ? <LinkButton href="/admin/telehealth/doctors/new">Yeni Doktor</LinkButton> : undefined}
            />
          ) : (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ad</TableHead>
                    <TableHead>Uzmanlık</TableHead>
                    <TableHead>Ücret</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead className="text-right">İşlemler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {doctors.map((doctor) => (
                    <TableRow key={doctor.id}>
                      <TableCell>
                        <Link href={`/admin/telehealth/doctors/${doctor.id}`} className="font-medium text-primary hover:underline">
                          {doctor.title} {doctor.fullName}
                        </Link>
                        <p className="text-xs text-foreground/50">/{doctor.slug}</p>
                      </TableCell>
                      <TableCell className="text-sm text-foreground/70">{doctor.specialty?.name ?? "—"}</TableCell>
                      <TableCell className="text-sm text-foreground/70">
                        {doctor.sessionDurationMin} dk · {formatPriceFromCents(doctor.sessionPriceCents, doctor.currency)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {doctor.isActive ? (
                            <Badge tone="success" size="sm">
                              Aktif
                            </Badge>
                          ) : (
                            <Badge tone="neutral" size="sm">
                              Pasif
                            </Badge>
                          )}
                          {doctor.isVerified && (
                            <Badge tone="primary" size="sm">
                              Doğrulanmış
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <LinkButton href={`/admin/telehealth/doctors/${doctor.id}`} variant="ghost" size="sm">
                            Düzenle
                          </LinkButton>
                          <Button variant="ghost" size="sm" onClick={() => setPendingDelete(doctor)}>
                            Sil
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </motion.div>
          )}
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Doktoru kalıcı sil"
        description={
          pendingDelete
            ? `"${pendingDelete.title} ${pendingDelete.fullName}" kalıcı olarak silinecek. Bu doktorun randevu geçmişi varsa işlem engellenir. Bu işlem geri alınamaz.`
            : undefined
        }
        confirmText="Kalıcı Sil"
        tone="danger"
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
