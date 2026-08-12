-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "isLegalDocument" BOOLEAN NOT NULL DEFAULT false;

-- ============================================================================
-- §2.3.1 (compliance-agent itirazı sonrası eklendi, bkz.
-- .claude/architect-scope-i18n.md §2.3.1 ve §13 revizyon geçmişi) — takip
-- migration'ı. Geri doldurma GEREKMEZ: tüm mevcut sayfalar doğru şekilde
-- `false` ile başlar (kolonun DEFAULT'u). Aşağıdaki adım SADECE mevcut
-- gizlilik politikası sayfasını (varsa) `true` işaretlemeye çalışan, TEK
-- ANLAMLI ADAY bulunduğunda uygulanan bir best-effort sezgiseldir. İDEMPOTENT:
-- tekrar çalıştırıldığında aynı sonucu üretir (zaten true olanı tekrar true
-- yapar), veri bozmaz.
-- ============================================================================
DO $$
DECLARE
  v_candidate_id TEXT;
  v_candidate_count INT;
BEGIN
  -- Slug/başlık üzerinden gizlilik politikası / KVKK aydınlatma metni sezgiseli.
  -- Bilinçli olarak DAR tutuldu: yanlış pozitif (alakasız bir sayfayı hukuki
  -- belge işaretlemek) yanlış negatiften (elle işaretleme ihtiyacını
  -- bildirmek) daha kötü bir sonuçtur.
  SELECT count(*), min(id) INTO v_candidate_count, v_candidate_id
  FROM "pages"
  WHERE "deletedAt" IS NULL
    AND (
      lower("slug") IN (
        'gizlilik-politikasi', 'gizlilik-politikası', 'gizlilik', 'privacy-policy', 'privacy',
        'kvkk-aydinlatma-metni', 'kvkk-aydınlatma-metni', 'kvkk', 'kisisel-verilerin-korunmasi'
      )
      OR lower("title") LIKE '%gizlilik politik%'
      OR lower("title") LIKE '%kvkk%'
      OR lower("title") LIKE '%kişisel veri%'
      OR lower("title") LIKE '%privacy policy%'
    );

  IF v_candidate_count = 1 THEN
    UPDATE "pages" SET "isLegalDocument" = true WHERE id = v_candidate_id;
    RAISE NOTICE 'i18n legal-doc migration: gizlilik politikasi/KVKK sayfasi OTOMATIK isaretlendi (isLegalDocument=true), pageId=%', v_candidate_id;
  ELSIF v_candidate_count = 0 THEN
    RAISE NOTICE 'i18n legal-doc migration: heuristik eslesen aday sayfa bulunamadi - varsa gizlilik politikasi sayfasi admin panelden ELLE isaretlenmelidir.';
  ELSE
    RAISE NOTICE 'i18n legal-doc migration: % aday sayfa eslesti, belirsizlik nedeniyle OTOMATIK ISARETLENMEDI - dogru sayfa admin panelden ELLE isaretlenmelidir.', v_candidate_count;
  END IF;
END;
$$;
