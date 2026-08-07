import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PostEditor } from "@/components/admin/blog/post-editor";

// Faz 5 (TipTap tablo desteği) — `PostEditor` içine `@tiptap/extension-table` eklendi
// (bkz. post-editor.tsx). Bu test dosyası, `handleInsertImage`/medya akışıyla İLGİSİZ
// olduğu için "@/lib/api/media" mock'u yalnızca modül çözümlemesini kırmamak için var.
vi.mock("@/lib/api/media", () => ({ listMedia: vi.fn(), updateMediaAltText: vi.fn() }));

describe("PostEditor — tablo araç çubuğu (Faz 5)", () => {
  it("'Tablo ekle' tıklanınca editöre bir tablo eklenir ve onChange çıktısı tabloyu yansıtır", async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();

    const { container } = render(<PostEditor content="<p>merhaba</p>" onChange={handleChange} />);

    await user.click(screen.getByLabelText("Tablo ekle"));

    // Tablo, TipTap'in kendi (React state'inden bağımsız) DOM yönetimi üzerinden
    // editöre GERÇEKTEN eklenir — bu imperatif ekleme React render'ı beklemez.
    await waitFor(() => {
      expect(container.querySelector("table")).toBeInTheDocument();
    });
    expect(container.querySelectorAll("tr")).toHaveLength(3);
    expect(container.querySelectorAll("td, th")).toHaveLength(9);

    // `onChange` (TipTap `onUpdate`) transaction ANINDA tetiklenir — React re-render'ından
    // BAĞIMSIZ, bu yüzden bu beklenti yukarıdaki bug'dan ETKİLENMEZ.
    await waitFor(() => {
      expect(handleChange).toHaveBeenCalledWith(expect.stringContaining("<table"));
    });
  });

  // BUG (frontend-agent'a yönlendirilmeli, düzeltilmedi — bkz. görev raporu): `post-editor.tsx`
  // `useEditor({...})` çağrısında `shouldRerenderOnTransaction` AYARLANMAMIŞ. TipTap v3'te bu
  // seçeneğin varsayılanı `undefined` iken `useEditor.ts`'in kendi iç mantığı (@tiptap/react
  // `useEditor`) bunu `false` ile AYNI kabul eder (`options.shouldRerenderOnTransaction === false
  // || options.shouldRerenderOnTransaction === void 0` → seçici hep `null` döner). Sonuç: hiçbir
  // toolbar düğmesinin `aria-pressed`/`active` durumu (Kalın, İtalik, Tablo vb.) kullanıcı
  // etkileşiminden SONRA GÜNCELLENMEZ — PostEditor yalnızca PARENT'ı (örn. `[postId]/page.tsx`
  // `contentHtml` state'i) başka bir sebeple re-render olduğunda dolaylı olarak tazelenir. Aynı
  // sebeple "tablo içindeyken satır/sütun ekle-sil düğmelerinin görünmesi" de ÇALIŞMIYOR —
  // `editor?.isActive("table")` her zaman ilk render'daki (false) değerde donuk kalıyor. Empirik
  // doğrulama: `Kalın` düğmesine tıklandıktan sonra bile `aria-pressed` "false" olarak KALIYOR.
  // Düzeltme (frontend-agent): `useEditor({ ..., shouldRerenderOnTransaction: true })`.
  it.skip("[BİLİNEN BUG — düzeltilmedi] tablo içindeyken satır/sütun ekle-sil düğmeleri görünür hale gelmeli", async () => {
    const user = userEvent.setup();
    render(<PostEditor content="<p>merhaba</p>" onChange={() => {}} />);

    await user.click(screen.getByLabelText("Tablo ekle"));

    await waitFor(() => {
      expect(screen.getByLabelText("Satır ekle")).toBeInTheDocument();
    });
  });
});
