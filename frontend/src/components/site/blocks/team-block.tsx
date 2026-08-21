import { cn } from "@/lib/utils";
import { SOCIAL_PLATFORM_ICONS, SOCIAL_PLATFORM_LABELS } from "@/lib/social-platform-icons";
import type { BlockChrome, TeamBlock } from "@/lib/page-builder/types";

/** `testimonial`in avatarsız-fallback deseniyle AYNI — baş harf rozeti, yeni ağ isteği açmaz. */
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function gridColsClass(count: number): string {
  if (count === 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1 sm:grid-cols-2";
  if (count === 3) return "grid-cols-1 sm:grid-cols-3";
  return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";
}

export function TeamBlockView({ block, chrome }: { block: TeamBlock; chrome: BlockChrome }) {
  const members = block.data.members;

  return (
    <section className={cn(chrome === "page" && "px-4 py-12 sm:px-6")}>
      <div className={cn("mx-auto grid max-w-5xl gap-6", gridColsClass(members.length))}>
        {members.map((member) => (
          <div key={member.id} className="flex flex-col items-center gap-3 rounded-lg border border-border p-6 text-center">
            {member.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- image-block.tsx ile AYNI gerekçe
              <img src={member.photoUrl} alt="" className="h-20 w-20 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-semibold text-primary">
                {initials(member.name)}
              </span>
            )}
            <div>
              <p className="text-base font-semibold text-foreground">{member.name}</p>
              {member.role && <p className="text-sm text-foreground/60">{member.role}</p>}
            </div>
            {member.bio && <p className="text-sm text-foreground/70">{member.bio}</p>}
            {member.socialLinks.length > 0 && (
              <div className="flex items-center gap-2">
                {member.socialLinks.map((link) => {
                  const Icon = SOCIAL_PLATFORM_ICONS[link.platform];
                  return (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={SOCIAL_PLATFORM_LABELS[link.platform]}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-foreground/60 transition-colors hover:border-primary hover:text-primary"
                    >
                      <Icon className="h-4 w-4" />
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
