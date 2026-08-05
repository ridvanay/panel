import crypto from "node:crypto";

/**
 * Gerçek bir sunucu dinletmeden `app.inject` ile ELLE inşa edilmiş `multipart/form-data`
 * gövdesi üretir (`@fastify/multipart` içerik-tipine göre devreye girer, `light-my-request`
 * gerçek bir HTTP soketi kullanmasa da bunu ayırt etmez). `import.test.ts` ve `media.test.ts`
 * arasında paylaşılır — iki tarafta da kopyası TUTULMAZ.
 */
export function buildMultipartPayload(input: {
  fields?: Record<string, string>;
  file: { fieldName?: string; filename: string; contentType: string; content: Buffer };
  fileFirst?: boolean;
}): { body: Buffer; contentType: string } {
  const boundary = `----vitestBoundary${crypto.randomUUID().replace(/-/g, "")}`;
  const CRLF = "\r\n";

  const fieldChunks = Object.entries(input.fields ?? {}).map(([name, value]) =>
    Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`)
  );

  const fileChunks = [
    Buffer.from(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="${input.file.fieldName ?? "file"}"; filename="${input.file.filename}"${CRLF}Content-Type: ${input.file.contentType}${CRLF}${CRLF}`
    ),
    input.file.content,
    Buffer.from(CRLF),
  ];

  const ordered = input.fileFirst ? [...fileChunks, ...fieldChunks] : [...fieldChunks, ...fileChunks];
  const body = Buffer.concat([...ordered, Buffer.from(`--${boundary}--${CRLF}`)]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
