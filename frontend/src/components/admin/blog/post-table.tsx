import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BlogPost } from "@/lib/api/types";

interface PostTableProps {
  posts: BlogPost[];
  deletingId: string | null;
  onDelete: (postId: string) => void;
}

export function PostTable({ posts, deletingId, onDelete }: PostTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Başlık</TableHead>
          <TableHead>Kategori</TableHead>
          <TableHead>Durum</TableHead>
          <TableHead className="text-right">Görüntülenme</TableHead>
          <TableHead className="text-right">İşlemler</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {posts.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-foreground/50">
              Henüz yazı yok
            </TableCell>
          </TableRow>
        )}
        {posts.map((post) => (
          <TableRow key={post.id}>
            <TableCell>
              <Link href={`/admin/blog/${post.id}`} className="font-medium text-foreground hover:text-primary">
                {post.title}
              </Link>
            </TableCell>
            <TableCell className="text-foreground/60">{post.category?.name ?? "—"}</TableCell>
            <TableCell>
              <Badge tone={post.status === "PUBLISHED" ? "success" : "neutral"}>
                {post.status === "PUBLISHED" ? "Yayında" : "Taslak"}
              </Badge>
            </TableCell>
            <TableCell className="text-right text-foreground/60">{post.viewCount.toLocaleString("tr-TR")}</TableCell>
            <TableCell className="text-right">
              <Button variant="ghost" size="sm" loading={deletingId === post.id} onClick={() => onDelete(post.id)}>
                Sil
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
