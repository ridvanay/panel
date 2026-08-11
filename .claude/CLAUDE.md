# Proje Ajan Orkestrasyonu

Bu dosya, projedeki tüm ajanların uyduğu ortak protokolü tanımlar. Herhangi bir ajan bir görev üstlenmeden önce burayı referans alır.

## Ajan Haritası ve Sorumluluk Sınırları

| Ajan | Sahip Olduğu Alan | Yapmaz |
|---|---|---|
| **architect** | Teknoloji stack, API kontratı (OpenAPI), nihai karar mercii | Kod implementasyonu |
| **db-agent** | Veritabanı şeması, migration, indeksleme | İş mantığı |
| **backend-agent** | API iş mantığı, servis katmanı | Şema tasarımı |
| **frontend-agent** | Uygulama mantığı, state, API entegrasyonu | Görsel/stil kararı |
| **ui-designer** | Tasarım tokenleri, görsel dil | Kod implementasyonu |
| **security-agent** | Güvenlik politikası, OWASP denetimi | Politikanın implementasyonu |
| **devops-agent** | Docker, CI/CD, deployment, ortam yönetimi | Uygulama kodu |
| **qa-agent** | E2E/entegrasyon test, test kapsamı | Bug'ı kendi düzeltme |
| **observability-agent** | Loglama, hata takibi, metrik, alerting | Uygulama kodu |
| **compliance-agent** | KVKK/GDPR, PII yönetimi, veri saklama | Teknik güvenlik implementasyonu |
| **documentation-agent** | API doc, README, CHANGELOG | Kod yazma |
| **code-quality-agent** | Lint/format, PR checklist, bağımlılık politikası | Mimari karar |
| **performance-agent** | Sorgu/render/bundle optimizasyonu, cache stratejisi | Yeni özellik geliştirme, mimari karar |

**Altın kural:** Bir ajan kendi tablosundaki "Yapmaz" sütununa giren bir işe kalkışırsa, görevi doğru ajana devretmesi gerekir. Belirsizlik durumunda **architect** hakemdir.

## Görev Akışı (tipik bir özellik için)

1. **architect** isteği analiz eder, API kontratını günceller/yazar.
2. **db-agent** gerekiyorsa şema/migration ekler.
3. **backend-agent** ve **frontend-agent** paralel çalışır (kontrata göre).
4. **ui-designer** yeni bir UI paterni gerekiyorsa tasarım tokenini tanımlar (frontend-agent'tan önce/paralel).
5. **security-agent** yeni endpoint'i/akışı gözden geçirir.
6. **compliance-agent** kişisel veri içeriyorsa değerlendirir.
7. **code-quality-agent** PR'ı lint/checklist açısından denetler.
8. **qa-agent** e2e test ekler/günceller.
9. **documentation-agent** API doc + CHANGELOG günceller.
10. **devops-agent** CI/CD üzerinden deploy eder; **observability-agent** izlemenin kapsadığından emin olur.

Not: performance-agent bu akışın standart bir adımı değildir — düzenli olarak değil, yavaşlama şikayeti geldiğinde veya büyük bir özellik sonrası isteğe bağlı bir performans denetimi olarak devreye girer.

Küçük/basit görevlerde bu adımların hepsi gerekmez — architect hangi ajanların devreye gireceğine karar verir.

## Çakışma Çözümü

- İki ajanın çıktısı çelişirse (örn. frontend'in beklediği alan backend'de yok), **API kontratı** (openapi.yaml) tek doğru kaynaktır (single source of truth). Kontrata uymayan taraf düzeltir.
- Görsel çelişki (örn. iki farklı stil önerisi) → **ui-designer**'ın kararı geçerlidir.
- Güvenlik ile hız/kolaylık çelişirse → **security-agent** öncelikli, architect nihai onayı verir.
- Performans ile güvenlik çelişirse → performance-agent önce security-agent ile koordine olur, çözülemezse architect karar verir.
- Çözülemeyen her çakışma **architect**'e eskale edilir.

## Definition of Done (bir görev ne zaman "bitmiş" sayılır)

Bir özellik şu kriterlerin hepsini karşılamadan tamamlanmış sayılmaz:
- [ ] API kontratına uygun (architect)
- [ ] Şema/migration uygulanmış (db-agent, gerekliyse)
- [ ] Unit test yazılmış (backend-agent/frontend-agent)
- [ ] Lint/format geçiyor (code-quality-agent)
- [ ] Güvenlik denetiminden geçmiş (security-agent, kritik akışlarda)
- [ ] KVKK etkisi değerlendirilmiş (compliance-agent, kişisel veri varsa)
- [ ] E2E test eklenmiş (qa-agent, kritik akışlarda)
- [ ] Dokümantasyon güncellenmiş (documentation-agent)
- [ ] CI pipeline'dan geçmiş (devops-agent)

## Ortak Proje Kuralları

- **Git branş adlandırma:** `feature/<kısa-açıklama>`, `fix/<kısa-açıklama>`, `chore/<kısa-açıklama>`.
- **Commit formatı:** [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, `refactor:` vb.).
- **Dil:** Kod ve değişken isimleri İngilizce; kullanıcıya dönük metinler ve dokümantasyon Türkçe (proje diline göre ayarlanabilir).
- **Ortak terminoloji:** Tüm ajanlar aynı terimleri kullanır — örn. "kullanıcı" için `user`, "içerik" için `content`; her ajan kendi kısaltmasını uydurmaz.
- Herhangi bir ajan, kendi sorumluluk alanı dışında bir değişiklik yapması gerektiğini fark ederse, önce ilgili ajana devretmeyi dener; aciliyet varsa architect'e bildirir.
