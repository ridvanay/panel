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

  // Regresyon testi: `post-editor.tsx`'teki `useEditor` çağrısına `shouldRerenderOnTransaction:
  // true` eklenmeden önce (qa-agent bulgusu) toolbar düğmelerinin `aria-pressed`/`active` durumu
  // ve `editor?.isActive("table")`'a bağlı bağlamsal butonlar kullanıcı etkileşiminden sonra HİÇ
  // güncellenmiyordu. Orkestratör tarafından düzeltildi — bu test artık gerçek davranışı doğruluyor.
  it("tablo içindeyken satır/sütun ekle-sil düğmeleri görünür hale gelir", async () => {
    const user = userEvent.setup();
    render(<PostEditor content="<p>merhaba</p>" onChange={() => {}} />);

    await user.click(screen.getByLabelText("Tablo ekle"));

    await waitFor(() => {
      expect(screen.getByLabelText("Satır ekle")).toBeInTheDocument();
    });
  });
});
