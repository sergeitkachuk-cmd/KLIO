// Streams a publication image back out of S3 through our own domain
// instead of a raw S3 URL — see uploadPublicationImage's comment in
// api/_lib/storage.ts for why: Telegram/VK's own servers fetch this URL
// directly (sendPhoto's `photo` param, VK's own photo-upload flow both
// take a plain URL, not a credential), so it's public and unauthenticated
// by design, same as the S3 URL it replaces would have been. Long
// Cache-Control is safe: keys are random UUIDs, never reused or
// overwritten (see uploadPublicationImage), so a given URL's content
// never changes.

import { downloadPublicationImage, StorageError } from "../../_lib/storage";

export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }) {
  const { key: segments } = await context.params;
  const key = segments.join("/");
  // Defense in depth, not a real security boundary (the bucket only ever
  // holds what we put there) — just keeps this route from doubling as a
  // generic "fetch any object from our bucket" proxy for an unrelated key.
  if (!key.startsWith("publications/")) return Response.json({ error: "Не найдено." }, { status: 404 });

  try {
    const { bytes, contentType } = await downloadPublicationImage(key);
    const download = new URL(request.url).searchParams.get("download") === "1";
    const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[contentType] || "bin";
    return new Response(bytes, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(bytes.byteLength),
        ...(download ? { "Content-Disposition": `attachment; filename="klio-image.${extension}"` } : {}),
      },
    });
  } catch (error) {
    if (error instanceof StorageError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Не удалось загрузить файл." }, { status: 500 });
  }
}
