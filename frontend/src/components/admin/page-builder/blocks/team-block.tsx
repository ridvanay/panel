import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import { SOCIAL_PLATFORM_LABELS } from "@/lib/social-platform-icons";
import { newId } from "@/lib/page-builder/registry";
import { TEAM_MAX_MEMBERS, TEAM_MAX_SOCIAL_LINKS_PER_MEMBER, type TeamBlock, type TeamMember, type TeamMemberSocialLink } from "@/lib/page-builder/types";
import type { SocialPlatform } from "@/lib/api/types";

const SOCIAL_PLATFORM_OPTIONS = Object.keys(SOCIAL_PLATFORM_LABELS) as SocialPlatform[];

function newMember(): TeamMember {
  return { id: newId(), name: "Ad Soyad", role: "Unvan", socialLinks: [] };
}

export function TeamBlockEditor({ block, onChange }: { block: TeamBlock; onChange: (block: TeamBlock) => void }) {
  const members = block.data.members;

  function updateMember(id: string, patch: Partial<TeamMember>) {
    onChange({ ...block, data: { ...block.data, members: members.map((m) => (m.id === id ? { ...m, ...patch } : m)) } });
  }

  function removeMember(id: string) {
    onChange({ ...block, data: { ...block.data, members: members.filter((m) => m.id !== id) } });
  }

  function moveMember(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= members.length) return;
    const next = [...members];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange({ ...block, data: { ...block.data, members: next } });
  }

  function addMember() {
    if (members.length >= TEAM_MAX_MEMBERS) return;
    onChange({ ...block, data: { ...block.data, members: [...members, newMember()] } });
  }

  function updateSocialLink(memberId: string, linkId: string, patch: Partial<TeamMemberSocialLink>) {
    const member = members.find((m) => m.id === memberId);
    if (!member) return;
    updateMember(memberId, { socialLinks: member.socialLinks.map((l) => (l.id === linkId ? { ...l, ...patch } : l)) });
  }

  function removeSocialLink(memberId: string, linkId: string) {
    const member = members.find((m) => m.id === memberId);
    if (!member) return;
    updateMember(memberId, { socialLinks: member.socialLinks.filter((l) => l.id !== linkId) });
  }

  function addSocialLink(memberId: string) {
    const member = members.find((m) => m.id === memberId);
    if (!member || member.socialLinks.length >= TEAM_MAX_SOCIAL_LINKS_PER_MEMBER) return;
    updateMember(memberId, { socialLinks: [...member.socialLinks, { id: newId(), platform: "OTHER", url: "https://" }] });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3">
        {members.map((member, index) => (
          <div key={member.id} className="space-y-2 rounded-lg border border-border/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground/50">Üye {index + 1}</span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Yukarı taşı"
                  onClick={() => moveMember(index, -1)}
                  disabled={index === 0}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Aşağı taşı"
                  onClick={() => moveMember(index, 1)}
                  disabled={index === members.length - 1}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Üyeyi sil"
                  onClick={() => removeMember(member.id)}
                  disabled={members.length <= 1}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <ImageUploadField
              id={`${member.id}-photo`}
              label="Fotoğraf (opsiyonel)"
              value={member.photoUrl ?? ""}
              onChange={(photoUrl) => updateMember(member.id, { photoUrl: photoUrl || undefined })}
              previewShape="circle"
            />
            <div className="grid grid-cols-2 gap-2">
              <Field id={`${member.id}-name`} label="Ad Soyad" required>
                {(p) => <Input {...p} value={member.name} onChange={(e) => updateMember(member.id, { name: e.target.value })} />}
              </Field>
              <Field id={`${member.id}-role`} label="Unvan (opsiyonel)">
                {(p) => (
                  <Input {...p} value={member.role ?? ""} onChange={(e) => updateMember(member.id, { role: e.target.value || undefined })} />
                )}
              </Field>
            </div>
            <Field id={`${member.id}-bio`} label="Kısa biyografi (opsiyonel)">
              {(p) => (
                <Textarea {...p} rows={2} value={member.bio ?? ""} onChange={(e) => updateMember(member.id, { bio: e.target.value || undefined })} />
              )}
            </Field>

            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">Sosyal medya bağlantıları</p>
              <div className="space-y-1.5">
                {member.socialLinks.map((link) => (
                  <div key={link.id} className="flex items-center gap-1.5">
                    <Select
                      aria-label="Platform"
                      className="w-36 shrink-0"
                      value={link.platform}
                      onChange={(e) => updateSocialLink(member.id, link.id, { platform: e.target.value as SocialPlatform })}
                    >
                      {SOCIAL_PLATFORM_OPTIONS.map((platform) => (
                        <option key={platform} value={platform}>
                          {SOCIAL_PLATFORM_LABELS[platform]}
                        </option>
                      ))}
                    </Select>
                    <Input
                      aria-label="Bağlantı URL'i"
                      value={link.url}
                      onChange={(e) => updateSocialLink(member.id, link.id, { url: e.target.value })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Bağlantıyı sil"
                      onClick={() => removeSocialLink(member.id, link.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => addSocialLink(member.id)}
                disabled={member.socialLinks.length >= TEAM_MAX_SOCIAL_LINKS_PER_MEMBER}
              >
                <Plus className="h-4 w-4" />
                Bağlantı Ekle
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={addMember} disabled={members.length >= TEAM_MAX_MEMBERS}>
        <Plus className="h-4 w-4" />
        Üye Ekle
      </Button>
    </div>
  );
}
