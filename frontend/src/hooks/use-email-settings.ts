import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as settingsApi from "@/lib/api/settings";
import type { UpdateEmailSettingsRequest } from "@/lib/api/types";

export const emailSettingsKeys = {
  all: ["admin-email-settings"] as const,
};

/**
 * `GET /admin/settings/email` — yalnızca ADMIN. Satır hiç oluşturulmamışsa backend `DEFAULTS`
 * ile doldurulmuş bir DTO döner (`enabled: false`), `422` DEĞİL — bu yüzden ekranın "boş"
 * durumu ayrıca ele alınmaz (`.claude/architect-scope-smtp-settings.md` §5).
 */
export function useEmailSettings() {
  return useQuery({
    queryKey: emailSettingsKeys.all,
    queryFn: () => settingsApi.getEmailSettings(),
  });
}

/**
 * `PATCH /admin/settings/email` — upsert. `smtpPassword` üç durumlu semantiği çağıran
 * bileşenin sorumluluğundadır (bkz. `email-settings-section.tsx`): dokunulmadıysa alan HİÇ
 * gönderilmez, temizlemek için `null` gönderilir.
 */
export function useUpdateEmailSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateEmailSettingsRequest) => settingsApi.updateEmailSettings(input),
    onSuccess: (data) => {
      queryClient.setQueryData(emailSettingsKeys.all, data);
    },
  });
}

/**
 * `POST /admin/settings/email/test` — yalnızca KAYDEDİLMİŞ satırı test eder, gövde kabul
 * etmez. Sonuç `lastTestedAt`/`lastTestSucceeded`/`lastTestError` alanlarına yazıldığı için
 * başarı/başarısızlık farketmeksizin `GET` önbelleğini geçersiz kılıyoruz.
 */
export function useTestEmailSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => settingsApi.testEmailSettings(),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: emailSettingsKeys.all });
    },
  });
}
