import Link from "next/link";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BlogPost } from "@/lib/api/types";

interface PostTableProps {
  posts: BlogPost[];
  deletingId: string | null;
  onDelete: (postId: string) => void;
  selectedIds: Set<string>;
  onToggleSelect: (postId: string) => void;
  onToggleSelectAll: () => void;
  allSelected: boolean;
}

export function PostTable({
  posts,
  deletingId,
  onDelete,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  allSelected,
}: PostTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              aria-label="Tümünü seç"
              checked={allSelected}
              indeterminate={selectedIds.size > 0 && !allSelected}
              onCheckedChange={onToggleSelectAll}
            />
          </TableHead>
          <TableHead className="w-auto">Başlık</TableHead>
          <TableHead className="w-40">Kategori</TableHead>
          <TableHead className="w-28">Durum</TableHead>
          <TableHead className="w-32 text-right">Görüntülenme</TableHead>
          <TableHead className="w-24 text-right">İşlemler</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {posts.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="text-center text-foreground/50">
              Henüz yazı yok
            </TableCell>
          </TableRow>
        )}
        {posts.map((post) => (
          <TableRow key={post.id}>
            <TableCell className="w-10">
              <Checkbox
                aria-label={`${post.title} yazısını seç`}
                checked={selectedIds.has(post.id)}
                onCheckedChange={() => onToggleSelect(post.id)}
              />
            </TableCell>
            <TableCell className="w-auto">
              <Link href={`/admin/blog/${post.id}`} className="font-medium text-foreground hover:text-primary">
                {post.title}
              </Link>
            </TableCell>
            <TableCell className="w-40 text-foreground/60">{post.category?.name ?? "—"}</TableCell>
            <TableCell className="w-28">
              <Badge tone={post.status === "PUBLISHED" ? "success" : "warning"}>
                {post.status === "PUBLISHED" ? "Yayında" : "Taslak"}
              </Badge>
            </TableCell>
            <TableCell className="w-32 text-right text-foreground/60">
              {post.viewCount.toLocaleString("tr-TR")}
            </TableCell>
            <TableCell className="w-24 text-right">
              <div className="flex items-center justify-end gap-1">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <LinkButton
                        href={`/admin/blog/${post.id}`}
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Düzenle"
                      />
                    }
                  >
                    <Pencil className="h-4 w-4" />
                  </TooltipTrigger>
                  <TooltipContent>Düzenle</TooltipContent>
                </Tooltip>

                {post.status === "PUBLISHED" && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <LinkButton
                          href={`/blog/${post.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Görüntüle"
                        />
                      }
                    >
                      <Eye className="h-4 w-4" />
                    </TooltipTrigger>
                    <TooltipContent>Görüntüle</TooltipContent>
                  </Tooltip>
                )}

                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Sil"
                        loading={deletingId === post.id}
                        onClick={() => onDelete(post.id)}
                      />
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </TooltipTrigger>
                  <TooltipContent>Sil</TooltipContent>
                </Tooltip>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
