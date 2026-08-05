"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AlertCircle, ShieldAlert, Upload, UploadCloud } from "lucide-react";
import * as importApi from "@/lib/api/import";
import type { ImportJobSummary } from "@/lib/api/types";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeading } from "@/components/admin/page-heading";
import { ImportJobStatusBadge } from "@/components/admin/import/import-job-status-badge";
import { ImportUploadDialog } from "@/components/admin/import/import-upload-dialog";
import { importTypeLabel } from "@/components/admin/import/import-type-config";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

function formatProgress(job: ImportJobSummary): string {
  if (job.totalCount === 0) return "—";
  return `${job.processedCount} / ${job.totalCount}`;
}

export default function AdminImportPage() {
  const { user } = useAuth();
  const router = useRouter();
  const isAdmin = user?.role === "ADMIN";

  const [jobs, setJobs] = useState<ImportJobSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = useCallback(async () => {
    setJobs(null);
    setError(null);
    try {
      const page = await importApi.listImportJobs({});
      setJobs(page.items);
      setNextCursor(page.meta.nextCursor);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      await load();
    })();
  }, [isAdmin, load]);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await importApi.listImportJobs({ cursor: nextCursor });
      setJobs((prev) => [...(prev ?? []), ...page.items]);
      setNextCursor(page.meta.nextCursor);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  function handleCreated(jobId: string) {
    router.push(`/admin/import/${jobId}`);
  }

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeading icon={Upload} title="İçe Aktar" description="Toplu içe aktarma işleri." />
        <EmptyState
          icon={ShieldAlert}
          title="Bu bölüme erişiminiz yok"
          description="İçe aktarma yalnızca Admin rolündeki kullanıcılara açıktır."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeading
        icon={Upload}
        title="İçe Aktar"
        description="Sayfa/Blog, WordPress, Kullanıcı ve Medya içeriklerini toplu olarak içe aktarın."
        actions={
          <Button onClick={() => setUploadOpen(true)}>
            <UploadCloud className="h-4 w-4" />
            Yeni İçe Aktarma
          </Button>
        }
      />

      {error && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      {jobs === null ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : jobs.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <EmptyState
            icon={Upload}
            title="Henüz içe aktarma işi yok"
            description="Bir dosya yükleyerek ilk içe aktarmanızı başlatın."
            action={
              <Button onClick={() => setUploadOpen(true)}>
                <UploadCloud className="h-4 w-4" />
                Yeni İçe Aktarma
              </Button>
            }
          />
        </motion.div>
      ) : (
        <>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <Card className="overflow-hidden p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dosya</TableHead>
                    <TableHead>Tür</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead>İlerleme</TableHead>
                    <TableHead>Oluşturan</TableHead>
                    <TableHead className="text-right">Tarih</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow
                      key={job.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/admin/import/${job.id}`)}
                    >
                      <TableCell className="max-w-[220px] truncate font-medium text-foreground">
                        <button
                          type="button"
                          className="admin-link text-left"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/admin/import/${job.id}`);
                          }}
                        >
                          {job.filename}
                        </button>
                      </TableCell>
                      <TableCell>{importTypeLabel(job.type)}</TableCell>
                      <TableCell>
                        <ImportJobStatusBadge status={job.status} />
                      </TableCell>
                      <TableCell className="text-foreground/70">{formatProgress(job)}</TableCell>
                      <TableCell className="text-foreground/60">{job.createdBy?.name ?? "—"}</TableCell>
                      <TableCell className="text-right text-foreground/60">{formatDate(job.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </motion.div>

          {nextCursor && (
            <div className="flex justify-center">
              <Button variant="outline" loading={loadingMore} onClick={handleLoadMore}>
                Daha fazla yükle
              </Button>
            </div>
          )}
        </>
      )}

      <ImportUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onCreated={handleCreated} />
    </div>
  );
}
