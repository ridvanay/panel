"use client";

import Link from "next/link";
import { Stethoscope } from "lucide-react";
import type { TelehealthOverview } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPriceFromCents } from "@/lib/format-price";

interface TelehealthDoctorBreakdownTableProps {
  data: TelehealthOverview;
}

/** En fazla 20 doktor satırı, `netCents DESC` (backend sıralaması korunur, burada yeniden sıralanmaz). */
export function TelehealthDoctorBreakdownTable({ data }: TelehealthDoctorBreakdownTableProps) {
  const { doctors, currency } = data;

  return (
    <Card>
      <h2 className="text-sm font-medium text-foreground">Doktor Bazlı Kırılım</h2>
      <p className="text-xs text-foreground/60">Net gelire göre sıralı, en fazla 20 doktor.</p>

      {doctors.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={Stethoscope}
            title="Henüz veri yok"
            description="Seçili aralıkta hiçbir doktor için tamamlanmış/iptal edilmiş seans bulunmuyor."
          />
        </div>
      ) : (
        <div className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Doktor</TableHead>
                <TableHead className="text-right">Tamamlanan</TableHead>
                <TableHead className="text-right">İptal</TableHead>
                <TableHead className="text-right">Brüt</TableHead>
                <TableHead className="text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {doctors.map((doctor) => (
                <TableRow key={doctor.doctorId}>
                  <TableCell className="font-medium text-foreground">
                    <Link
                      href={`/admin/telehealth/doctors/${doctor.doctorId}`}
                      className="transition-colors hover:text-primary hover:underline"
                    >
                      {doctor.title} {doctor.fullName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">{doctor.completedCount.toLocaleString("tr-TR")}</TableCell>
                  <TableCell className="text-right">{doctor.cancelledCount.toLocaleString("tr-TR")}</TableCell>
                  <TableCell className="text-right">{formatPriceFromCents(doctor.grossCents, currency)}</TableCell>
                  <TableCell className="text-right">{formatPriceFromCents(doctor.netCents, currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
