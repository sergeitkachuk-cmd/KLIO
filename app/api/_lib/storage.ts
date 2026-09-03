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
//
// OPEN ISSUE (2026-09-03, unresolved): a real Telegram publish with an
// image failed with "Bad Request: failed to get HTTP URL content" —
// Telegram itself couldn't fetch the image URL. Confirmed by curl from
// outside the app: the URL returns a bare 403 AccessDenied (S3 XML
// error body), even though the klio-media bucket's own panel shows
// "Тип бакета: Публичный". Both path-style and virtual-hosted-style
// URLs for the same object gave the same 403 — not a URL-format issue.
//
// Not yet confirmed: whether this ACL: "public-read" below actually
// works for objects uploaded through *this* code specifically. The one
// object tested so far (klio-media/КЛИО логотип фавикон.png) was
// uploaded through Timeweb's own web panel, not through
// uploadPublicationImage() — the panel's own uploader may simply not
// set a public ACL by default regardless of the bucket's declared
// "type", which would mean this file's own ACL: "public-read" already
// works fine and the panel-uploaded test object was just a bad test
// case. A second real test — a file uploaded via KLIO's own "Загрузить"
// button, then curled from outside the app — was in progress but never
// completed (the browser showed a 502 on the follow-up POST to
// /api/publications rather than the image URL itself, and the actual
// response body was never captured before the debugging session ended).
//
// Next step whoever picks this up: get a real uploadPublicationImage()
// URL and curl it. If it's also 403, per-object ACL isn't being honored
// by Timeweb's implementation at all — the confirmed-working fallback
// is an explicit bucket policy (PUT Bucket Policy — documented in
// Timeweb's own S3 API reference, "Принципы работы S3" in the bucket's
// panel) granting public s3:GetObject on the whole bucket, set once via
// the S3 API rather than relying on ACL at upload time. Timeweb's own
// official Node.js examples (github.com/timeweb-cloud/s3-examples,
// nodejs/src/sample.js) confirm this endpoint/region/forcePathStyle
// config is correct — they just don't demonstrate ACL or policy at all,
// so they don't resolve this specific question either way.

// UPDATE (2026-09-03): a KLIO-uploaded image produced NoSuchBucket, not
// AccessDenied. Its URL was https://s3.twcstorage.ru/publications/...,
// proving that S3_PUBLIC_URL_BASE had been set to the root endpoint while
// publicUrl() omitted the bucket. The URL construction below now handles
// that configuration as https://s3.twcstorage.ru/<bucket>/<key>. Retest a
// fresh KLIO upload after deployment before touching ACL or Bucket Policy.

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
  const endpoint = requiredEnv("S3_ENDPOINT").replace(/\/+$/, "");
  const bucket = requiredEnv("S3_BUCKET");
  const configuredBase = process.env.S3_PUBLIC_URL_BASE?.trim()?.replace(/\/+$/, "");

  // Timeweb's root S3 endpoint needs the bucket as the first path segment.
  // A previous deployment set S3_PUBLIC_URL_BASE to that root endpoint, so
  // the old shortcut produced /publications/... and S3 treated
  // "publications" as a bucket (NoSuchBucket). A genuinely custom public
  // domain/CDN may map directly to one bucket, so retain that opt-in shape.
  if (configuredBase && configuredBase !== endpoint) return `${configuredBase}/${key}`;
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
