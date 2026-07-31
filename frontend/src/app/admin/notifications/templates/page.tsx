"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, Mail } from "lucide-react";
import * as emailTemplatesApi from "@/lib/api/email-templates";
import type { EmailTemplate } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/link-button";
import { PageHeading } from "@/components/admin/page-heading";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

export default function EmailTemplatesListPage() {
  const [templates, setTemplates] = useState<EmailTemplate[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const items = await emailTemplatesApi.listTemplates();
      setTemplates(items);
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

  return (
    <div className="space-y-6">
      <PageHeading
        icon={Mail}
        title="Bildirimler"
        description="Sistem tarafından gönderilen e-posta şablonlarını yönetin."
      />

      {loadError && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {loadError}
          </span>
        </Alert>
      )}

      {!loadError && !loaded && (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      )}

      {!loadError && loaded && templates && templates.length === 0 && (
        <EmptyState icon={Mail} title="Henüz şablon yok" description="Sistemde tanımlı e-posta şablonu bulunamadı." />
      )}

      {!loadError && loaded && templates && templates.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {templates.map((template) => (
            <Card key={template.id} interactive className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">{template.name}</h2>
                <Badge tone="primary">{template.key}</Badge>
              </div>
              <p className="line-clamp-2 text-sm text-foreground/60">{template.subject}</p>
              <div className="mt-auto pt-2">
                <LinkButton href={`/admin/notifications/templates/${template.key}`} variant="outline" size="sm">
                  Düzenle
                </LinkButton>
              </div>
            </Card>
          ))}
        </motion.div>
      )}
    </div>
  );
}
