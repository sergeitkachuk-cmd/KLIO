// Uploads a file to Timeweb Cloud's S3-compatible Object Storage
// (twcstorage.ru) — used by api/uploads/route.ts for images attached to
// a "Публикации" post, and by uploadBrandBookPdf below.
//
// Unlike every other external integration in this codebase (Unisender,
// VK, Telegram — see api/_lib/email.ts's own comment), this one goes
// through the official @aws-sdk/client-s3 package instead of a bare
// fetch: S3 requests are signed with AWS Signature V4, and a hand-rolled
// implementation that's subtly wrong fails as an opaque
// "SignatureDoesNotMatch" with no useful diagnostic — not worth the
// dependency-avoidance principle here specifically.
//
// forcePathStyle is required: Timeweb serves path-style at
// s3.twcstorage.ru/<bucket>/<key>, not <bucket>.s3.twcstorage.ru
// (virtual-hosted-style), which is what S3Client defaults to without
// this flag.
//
// RESOLVED (was "OPEN ISSUE", 2026-09-03 → 2026-09-16): every attempt to
// make the bucket serve objects as a genuinely public S3 URL failed —
// ACL: "public-read" at upload time (this file's own prior version),
// and the bucket's own "Публичный" panel setting, both still gave a real
// Telegram publish attempt a bare 403 AccessDenied when Telegram's
// servers tried to fetch the photo URL directly ("Bad Request: failed to
// get HTTP URL content" — confirmed live, 2026-09-16). Rather than chase
// Timeweb's ACL/bucket-policy behavior further, uploadPublicationImage
// now returns a URL on our OWN domain (api/uploads/[...key]) instead of
// an S3 URL at all — that route fetches the object from S3 with our own
// signed credentials (which always works, ACL notwithstanding) and
// streams it back. Telegram/VK only ever see a plain https URL on
// klio's own domain, never talk to S3 directly, and public-read/bucket-
// policy stop mattering. See uploadBrandBookPdf's own comment for why
// that upload deliberately went private-only from the start instead.

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { imageContentType } from "./image-type";
import { isPdfSignature } from "./pdf-type";

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

// Shared by downloadPublicationImage and downloadBrandBookPdf — the only
// difference between the two is what each does with the bytes/content
// type afterward (stream through api/uploads/[...key] publicly, vs. an
// owner-checked api/brand/book fetch).
async function getObjectBytes(key: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string }> {
  const response = await client().send(new GetObjectCommand({
    Bucket: requiredEnv("S3_BUCKET"),
    Key: key,
  }), { abortSignal: AbortSignal.timeout(20_000) });
  const body = response.Body;
  if (!body) throw new StorageError("Файл не найден в хранилище.", 404);
  // Copied into a fresh, concretely ArrayBuffer-backed Uint8Array (not
  // just the SDK's own ArrayBufferLike-typed one) so callers can pass
  // this directly as a Response/Blob body without a type mismatch.
  const raw = await body.transformToByteArray();
  const bytes = new Uint8Array(raw.length);
  bytes.set(raw);
  return { bytes, contentType: response.ContentType || "application/octet-stream" };
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

// baseUrl (api/uploads/route.ts passes resolveBaseUrl(request)) becomes
// the returned URL's own domain — see the file-level comment on why this
// is api/uploads/[...key] on our own domain rather than a raw S3 URL.
export async function uploadPublicationImage(file: File, ownerEmail: string, baseUrl: string): Promise<string> {
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
  if (imageContentType(bytes) !== file.type) throw new StorageError("Содержимое файла не соответствует формату картинки.", 400);
  // Namespaced by owner so two accounts can never collide or overwrite
  // each other's file, without needing a database lookup to check.
  const ownerKey = createHash("sha256").update(ownerEmail.trim().toLowerCase()).digest("hex");
  const key = `publications/${ownerKey}/${crypto.randomUUID()}.${extension}`;

  try {
    await client().send(new PutObjectCommand({
      Bucket: requiredEnv("S3_BUCKET"),
      Key: key,
      Body: bytes,
      ContentType: file.type,
    }), { abortSignal: AbortSignal.timeout(40_000) });
  } catch (error) {
    if (error instanceof StorageError) throw error;
    console.error("S3 upload failed", error instanceof Error ? error.message : error);
    throw new StorageError("Не удалось загрузить картинку в хранилище.");
  }

  return `${baseUrl.replace(/\/+$/, "")}/api/uploads/${key}`;
}

// Public, unauthenticated by design — see api/uploads/[...key]/route.ts,
// the only caller: Telegram/VK's own servers fetch a publication's image
// directly and can't present any credential of ours.
export async function downloadPublicationImage(key: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string }> {
  if (!storageConfigured()) throw new StorageError("Хранилище файлов пока не настроено на сервере.", 503);
  try {
    return await getObjectBytes(key);
  } catch (error) {
    if (error instanceof StorageError) throw error;
    console.error("S3 publication-image download failed", error instanceof Error ? error.message : error);
    throw new StorageError("Не удалось прочитать файл из хранилища.", 502);
  }
}

// Generous enough for a real brand-book export (design-heavy PDFs run
// larger than a single social-post image) while staying well inside a
// single request body.
const MAX_BRAND_BOOK_BYTES = 20 * 1024 * 1024;

// Unlike uploadPublicationImage, this is deliberately never public: a
// brand book is only ever read back by our own server (see
// api/brand/book/route.ts's GetObjectCommand fetch and the PDF-analysis
// route, which reads the same bytes right after upload), so it sidesteps
// the still-unresolved public-ACL/bucket-policy issue documented above
// entirely rather than depending on it.
export async function uploadBrandBookPdf(file: File, ownerEmail: string): Promise<{ key: string; bytes: Uint8Array }> {
  if (!storageConfigured()) {
    throw new StorageError("Загрузка файлов пока не настроена на сервере.", 503);
  }
  if (file.size > MAX_BRAND_BOOK_BYTES) {
    throw new StorageError(`Файл больше ${Math.round(MAX_BRAND_BOOK_BYTES / 1024 / 1024)} МБ — уменьшите файл и попробуйте снова.`, 400);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPdfSignature(bytes)) throw new StorageError("Поддерживаются только PDF-файлы.", 400);

  const ownerKey = createHash("sha256").update(ownerEmail.trim().toLowerCase()).digest("hex");
  const key = `brand-books/${ownerKey}/${crypto.randomUUID()}.pdf`;

  try {
    await client().send(new PutObjectCommand({
      Bucket: requiredEnv("S3_BUCKET"),
      Key: key,
      Body: bytes,
      ContentType: "application/pdf",
    }), { abortSignal: AbortSignal.timeout(40_000) });
  } catch (error) {
    if (error instanceof StorageError) throw error;
    console.error("S3 brand-book upload failed", error instanceof Error ? error.message : error);
    throw new StorageError("Не удалось загрузить файл в хранилище.");
  }

  return { key, bytes };
}

// Owner-scoped, authenticated read-back for the "Скачать" link on an
// attached brand book — see api/brand/book/route.ts, the only caller. Keys
// are namespaced by the same sha256(ownerEmail) prefix uploadBrandBookPdf
// writes, so a caller-supplied key from another account's brand can never
// resolve here (the route checks the prefix before calling this).
// Uint8Array<ArrayBuffer>, not the bare (implicitly ArrayBufferLike, i.e.
// SharedArrayBuffer-including) Uint8Array: `BodyInit` in this TS/DOM lib
// only accepts the concrete-ArrayBuffer-backed variant, and api/brand/
// book/route.ts passes this straight into `new Response(bytes, ...)`.
export async function downloadBrandBookPdf(key: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!storageConfigured()) throw new StorageError("Хранилище файлов пока не настроено на сервере.", 503);
  try {
    const { bytes } = await getObjectBytes(key);
    return bytes;
  } catch (error) {
    if (error instanceof StorageError) throw error;
    console.error("S3 brand-book download failed", error instanceof Error ? error.message : error);
    throw new StorageError("Не удалось прочитать файл из хранилища.", 502);
  }
}
