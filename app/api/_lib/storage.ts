// Uploads a file to Timeweb Cloud's S3-compatible Object Storage
// (twcstorage.ru) and returns a fetchable public URL — used by
// api/uploads/route.ts for images attached to a "Публикации" post.
//
// Unlike every other external integration in this codebase (Unisender,
// VK, Telegram — see api/_lib/email.ts's own comment), this one goes
// through the official @aws-sdk/client-s3 package instead of a bare
// fetch: S3 requests are signed with AWS Signature V4, and a hand-rolled
// implementation that's subtly wrong fails as an opaque
// "SignatureDoesNotMatch" with no useful diagnostic — not worth the
// dependency-avoidance principle here specifically.
//
// forcePathStyle is required: Timeweb serves public files at
// s3.twcstorage.ru/<bucket>/<key> (path-style), confirmed against a real
// file uploaded through the klio-media bucket's own panel — not
// <bucket>.s3.twcstorage.ru (virtual-hosted-style), which is what
// S3Client defaults to without this flag.

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export class StorageError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new StorageError(`Хранилище файлов не настроено: отсутствует ${name}.`, 503);
  return value;
}

export function storageConfigured(): boolean {
  return Boolean(
    process.env.S3_ENDPOINT?.trim()
    && process.env.S3_REGION?.trim()
    && process.env.S3_BUCKET?.trim()
    && process.env.S3_ACCESS_KEY_ID?.trim()
    && process.env.S3_SECRET_ACCESS_KEY?.trim(),
  );
}

let cachedClient: S3Client | null = null;
let cachedEndpoint = "";

function client(): S3Client {
  const endpoint = requiredEnv("S3_ENDPOINT");
  // Rebuild only if the endpoint actually changed (env vars are static in
  // practice, but this avoids holding a stale client across a hot reload
  // in dev where process.env can be re-read without a full restart).
  if (cachedClient && cachedEndpoint === endpoint) return cachedClient;
  cachedClient = new S3Client({
    endpoint,
    region: requiredEnv("S3_REGION"),
    forcePathStyle: true,
    credentials: {
      accessKeyId: requiredEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("S3_SECRET_ACCESS_KEY"),
    },
  });
  cachedEndpoint = endpoint;
  return cachedClient;
}

// Public URL construction mirrors forcePathStyle above — deliberately
// not using the S3Client's own request URL, which would need a second
// signed call for something that's actually just string concatenation
// once the bucket is public (confirmed for klio-media: "Публичный").
function publicUrl(key: string): string {
  const base = process.env.S3_PUBLIC_URL_BASE?.trim();
  if (base) return `${base.replace(/\/+$/, "")}/${key}`;
  const endpoint = requiredEnv("S3_ENDPOINT").replace(/\/+$/, "");
  const bucket = requiredEnv("S3_BUCKET");
  return `${endpoint}/${bucket}/${key}`;
}

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

// Generous enough for a social-post image, tight enough that one upload
// can't quietly eat a meaningful slice of the bucket's 1 GB plan — see
// the "Публикации" design discussion on why 1 GB was chosen (auto-scales
// on Timeweb's side if this project ever needs more, so this cap is
// about one upload staying reasonable, not about the bucket running out).
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export async function uploadPublicationImage(file: File, ownerEmail: string): Promise<string> {
  if (!storageConfigured()) {
    throw new StorageError("Загрузка картинок пока не настроена на сервере.", 503);
  }
  const extension = ALLOWED_CONTENT_TYPES[file.type];
  if (!extension) {
    throw new StorageError("Поддерживаются только картинки JPEG, PNG, WEBP или GIF.", 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new StorageError(`Картинка больше ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} МБ — уменьшите файл и попробуйте снова.`, 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Namespaced by owner so two accounts can never collide or overwrite
  // each other's file, without needing a database lookup to check.
  const key = `publications/${ownerEmail.toLowerCase()}/${crypto.randomUUID()}.${extension}`;

  try {
    await client().send(new PutObjectCommand({
      Bucket: requiredEnv("S3_BUCKET"),
      Key: key,
      Body: bytes,
      ContentType: file.type,
      ACL: "public-read",
    }));
  } catch (error) {
    if (error instanceof StorageError) throw error;
    console.error("S3 upload failed", error instanceof Error ? error.message : error);
    throw new StorageError("Не удалось загрузить картинку в хранилище.");
  }

  return publicUrl(key);
}
