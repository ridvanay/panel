import { toast } from "sonner";
import type { MediaUploadNotice } from "@/lib/api/media";

/** `POST /admin/media` `meta.notice` (ör. TYPE_CORRECTED: "Dosya JPEG olarak kaydedildi.") → bilgi bildirimi. */
export function showMediaNotice(notice: MediaUploadNotice): void {
  toast.info(notice.message);
}
