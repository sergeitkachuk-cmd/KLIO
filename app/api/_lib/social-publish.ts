// Actually talks to Telegram's Bot API and VK's classic API to publish one
// piece of content to one connected channel. The only call site outside
// this file that should exist is publishToChannel() below — everything
// platform-specific (endpoints, multi-step VK photo upload, response shape
// parsing) stays here so a future third platform is one more branch, not a
// rewrite. See publishing-config.ts for the credential shapes and limits
// this reads.

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { fetchPublicResource } from "./public-fetch";
import { imageContentType } from "./image-type";
import { telegramApiBase } from "./telegram-proxy";
import {
  PLATFORM_TEXT_LIMITS,
  VK_API_VERSION,
  truncateForPlatform,
  type ChannelCredentials,
  type TelegramCredentials,
  type VkCredentials,
} from "./publishing-config";

export class PublishError extends Error {
  // Whether the cron poller should count this against MAX_PUBLISH_RETRIES
  // and try again next pass, or mark the row failed immediately (an
  // obviously-permanent problem like a revoked token gains nothing from
  // three more identical attempts over the following minutes).
  retryable: boolean;
  providerPostId?: string;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

type TelegramApiResponse = {
  status: number;
  body: string;
};

// The production log recorded a TCP connect timeout to api.telegram.org.
// Timeweb hosts can prefer an unusable IPv6 route for this hostname, while
// Telegram's IPv4 endpoint is available. Node's global fetch gives us no
// portable way to pin just this request family, so use the native client for
// Telegram only. This is still one request: no hidden resend that could
// duplicate a post when Telegram received it but its response was lost.
//
// That connect-timeout class of failure kept recurring even with the pin
// above (site owner: publish still failing, both scheduled and "Опубликовать
// сейчас", weeks after this fix first shipped) — the network path to
// api.telegram.org is evidently still unreliable from this host sometimes,
// not a one-time bug. send()'s catch below used to treat every failure here
// identically as "maybe Telegram got it, don't auto-retry" — safe, but it
// meant a routine connect blip needed a person to notice and press retry by
// hand every single time, on top of whatever's actually flaky about the
// route. A connect-phase failure specifically (rejected here before the
// socket ever connects) means Telegram's server never saw this request at
// all, so unlike a failure after connecting, it's provably safe to let the
// cron's own retry loop pick back up automatically — see the `connected`
// flag threaded through the rejection below and read in send()'s catch.
class TelegramTransportError extends Error {
  connected: boolean;
  constructor(message: string, connected: boolean, options?: { cause?: unknown }) {
    super(message, options);
    this.connected = connected;
  }
}

function postToTelegramApi(url: string, body: object | Buffer, signal: AbortSignal, contentType = "application/json"): Promise<TelegramApiResponse> {
  const endpoint = new URL(url);
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  // Plain HTTP when talking to a self-hosted Bot API server (see
  // telegramApiBase) instead of the real, always-HTTPS api.telegram.org.
  const requestFn = endpoint.protocol === "http:" ? httpRequest : httpsRequest;
  return new Promise((resolve, reject) => {
    // Unknown transport state is not proof of non-delivery. In particular,
    // keep-alive sockets do not emit another connect event when reused.
    let connected = true;
    const request = requestFn({
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port || (endpoint.protocol === "http:" ? 80 : 443),
      path: `${endpoint.pathname}${endpoint.search}`,
      method: "POST",
      family: 4,
      signal,
      headers: {
        "Content-Type": contentType,
        "Content-Length": payload.length,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 256 * 1024) { response.destroy(new Error("Telegram response is too large.")); return; }
        chunks.push(Buffer.from(chunk));
      });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", (error) => reject(new TelegramTransportError(error.message, true, { cause: error })));
    });
    // Once the socket actually connects, a subsequent failure (response
    // timeout, reset mid-read) can no longer prove Telegram never received
    // the request — only the pre-connect window can.
    request.on("socket", (socket) => {
      connected = !socket.connecting;
      socket.once("connect", () => { connected = true; });
    });
    request.setTimeout(25_000, () => request.destroy(new TelegramTransportError("Telegram API connection timed out after 25 seconds.", connected)));
    request.on("error", (error) => reject(error instanceof TelegramTransportError ? error : new TelegramTransportError(error.message, connected, { cause: error })));
    request.end(payload);
  });
}

type DownloadedImage = { bytes: Buffer; contentType: string };

async function fetchImageBytes(imageUrl: string): Promise<DownloadedImage> {
  try {
    const response = await fetchPublicResource(imageUrl, { maxBytes: 10 * 1024 * 1024, timeoutMs: 15_000, accept: "image/*" });
    if (!response.ok) throw new PublishError(`Не удалось загрузить картинку по ссылке (HTTP ${response.status}).`, true);
    const type = imageContentType(response.bytes);
    if (!type) throw new PublishError("Ссылка должна вести на изображение JPEG, PNG, WebP или GIF.", false);
    return { bytes: Buffer.from(response.bytes), contentType: type };
  } catch (error) {
    if (error instanceof PublishError) throw error;
    throw new PublishError("Не удалось загрузить картинку по ссылке перед публикацией.", true);
  }
}

type TelegramMultipartFile = DownloadedImage & { fieldName: string; filename: string };

function telegramMultipart(fields: Record<string, string>, files: TelegramMultipartFile[]): { body: Buffer; contentType: string } {
  const boundary = `----klio-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  const add = (value: string | Buffer) => chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
  for (const [name, value] of Object.entries(fields)) {
    add(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  }
  for (const file of files) {
    add(`--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`);
    add(file.bytes);
    add("\r\n");
  }
  add(`--${boundary}--\r\n`);
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

// sendMediaGroup's result is an array (one Message per media item, in
// input order) instead of sendPhoto/sendMessage's single object - both
// shapes are possible depending which method produced this payload.
type TelegramMessagePayload = { ok: boolean; result?: { message_id: number } | { message_id: number }[]; description?: string; error_code?: number };

// telegramPublicationUrl (social-channels.ts) and fastPublicationResponse
// (publications/route.ts) both require providerPostId to match /^\d+$/ -
// a bare numeric string, never a list - so this always resolves to just
// the FIRST item's id, matching the "first message is the one that
// carries the post" convention this file already used for sendPhoto.
function firstMessageId(result: TelegramMessagePayload["result"]): number | undefined {
  return Array.isArray(result) ? result[0]?.message_id : result?.message_id;
}

function splitTelegramText(text: string, limit: number): string[] {
  const result: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    const splitAt = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const end = splitAt > Math.floor(limit * 0.55) ? splitAt : limit;
    result.push(remaining.slice(0, end).trimEnd());
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) result.push(remaining);
  return result;
}

async function publishToTelegram(creds: TelegramCredentials, text: string, imageUrls: string[]): Promise<{ providerPostId: string }> {
  const base = `${telegramApiBase()}/bot${creds.botToken}`;
  const signal = AbortSignal.timeout(120_000);
  async function send(method: "sendPhoto" | "sendMessage" | "sendMediaGroup", body: Record<string, unknown>, files: TelegramMultipartFile[] = []): Promise<TelegramMessagePayload> {
    let response: TelegramApiResponse;
    try {
      if (files.length) {
        const multipart = telegramMultipart(
          Object.fromEntries(Object.entries(body).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)])),
          files,
        );
        response = await postToTelegramApi(`${base}/${method}`, multipart.body, signal, multipart.contentType);
      } else {
        response = await postToTelegramApi(`${base}/${method}`, body, signal);
      }
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined;
      console.error("Telegram publish request failed", {
        message: error instanceof Error ? error.message : String(error),
        cause: cause instanceof Error ? cause.message : undefined,
        connected: error instanceof TelegramTransportError ? error.connected : "unknown",
      });
      // Only a failure after the socket connected is genuinely ambiguous
      // (Telegram may have received and processed the request before the
      // response was lost) - that case alone stops automatic retries and
      // asks for a manual channel check. A failure before any connection
      // was ever established provably never reached Telegram, so the
      // cron's own retry loop can safely pick this row back up on its next
      // pass instead of it silently sitting "failed" until someone notices.
      const connected = !(error instanceof TelegramTransportError) || error.connected;
      throw new PublishError(
        connected
          ? "Telegram не подтвердил результат отправки. Автоматический повтор остановлен: сначала проверьте канал, чтобы не создать дубликат."
          : "Telegram временно недоступен: не удалось установить соединение.",
        !connected,
      );
    }
    const payload = (() => {
      try { return JSON.parse(response.body); } catch { return null; }
    })() as TelegramMessagePayload | null;
    if (!payload?.ok || !firstMessageId(payload.result)) {
      const permanent = response.status === 401 || response.status === 403 || response.status === 400;
      throw new PublishError(
        payload?.description ? `Telegram отклонил публикацию: ${payload.description}` : `Telegram отклонил публикацию (HTTP ${response.status}).`,
        payload?.ok === false && !permanent,
      );
    }
    return payload;
  }

  // Telegram allows only 1,024 characters in a photo caption, while a
  // normal message holds 4,096. Keep the photo(s) as the first message and
  // continue the full text below it instead of silently cutting the ending.
  const photos = imageUrls.slice(0, 10);
  const hasImage = photos.length > 0;
  const captionParts = hasImage ? splitTelegramText(text, PLATFORM_TEXT_LIMITS.telegram.withImage) : [];
  // Telegram fetching our public URLs itself is unreliable and produced
  // WEBPAGE_CURL_FAILED midway through real carousel publications. Download
  // each selected image on our server first and attach the bytes to one
  // multipart request, so Telegram never needs to reach KLIO's storage URL.
  const uploads: TelegramMultipartFile[] = [];
  for (let index = 0; index < photos.length; index++) {
    const image = await fetchImageBytes(photos[index]);
    const extension = image.contentType === "image/png" ? "png" : image.contentType === "image/webp" ? "webp" : image.contentType === "image/gif" ? "gif" : "jpg";
    uploads.push({ ...image, fieldName: `photo${index}`, filename: `carousel-${index + 1}.${extension}` });
  }
  // sendMediaGroup requires 2-10 items - exactly one photo still goes
  // through sendPhoto unchanged, so this only branches differently once
  // there's actually more than one image to send as a real album/group.
  const first = photos.length > 1
    ? await send("sendMediaGroup", { chat_id: creds.chatId, media: uploads.map((file, index) => ({ type: "photo", media: `attach://${file.fieldName}`, ...(index === 0 ? { caption: captionParts[0] ?? "" } : {}) })) }, uploads)
    : hasImage
      ? await send("sendPhoto", { chat_id: creds.chatId, photo: `attach://${uploads[0].fieldName}`, caption: captionParts[0] ?? "" }, uploads)
      : await send("sendMessage", { chat_id: creds.chatId, text: splitTelegramText(text, PLATFORM_TEXT_LIMITS.telegram.textOnly)[0] ?? "" });
  const remaining = hasImage
    ? captionParts.slice(1).flatMap((part) => splitTelegramText(part, PLATFORM_TEXT_LIMITS.telegram.textOnly))
    : splitTelegramText(text, PLATFORM_TEXT_LIMITS.telegram.textOnly).slice(1);
  let sent = 1;
  try {
    for (const part of remaining) { await send("sendMessage", { chat_id: creds.chatId, text: part }); sent++; }
  } catch (error) {
    const partial = new PublishError(`Telegram принял ${sent} ч. публикации, но отправка не завершена. Автоматический повтор остановлен. Проверьте канал перед повторной отправкой. ${error instanceof Error ? error.message : ""}`, false);
    partial.providerPostId = String(firstMessageId(first.result));
    throw partial;
  }
  return { providerPostId: String(firstMessageId(first.result)) };
}

async function vkCall(method: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`https://api.vk.com/method/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, v: VK_API_VERSION }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new PublishError(method === "wall.post" ? "VK не подтвердил результат отправки. Сначала проверьте стену сообщества: автоматический повтор остановлен во избежание дубликата." : "VK не ответил на запрос подготовки публикации.", method !== "wall.post");
  }
  const payload = await response.json().catch(() => null) as
    | { response?: unknown; error?: { error_code: number; error_msg: string } }
    | null;
  if (!payload || payload.error) {
    const code = payload?.error?.error_code;
    // 5 = auth failed (revoked/invalid token), 15 = access denied (bot/user
    // lost admin rights on the community) — both need the owner to
    // reconnect the channel, not three more identical attempts.
    const permanent = code === 5 || code === 15 || code === 27 || code === 901;
    throw new PublishError(
      payload?.error ? `VK отклонил запрос: ${payload.error.error_msg}` : "VK вернул пустой ответ.",
      !permanent && (Boolean(payload?.error) || method !== "wall.post"),
    );
  }
  return payload.response as Record<string, unknown>;
}

// The connect-channel form asks for a plain positive number (see its own
// "Id сообщества — число из адресной строки" instructions), but nothing
// enforced that: groups.getById at connect time (social-channels.ts)
// happily resolves a screen name/vanity URL too, VK-side, so a community
// saved by its alias instead of its numeric id looked connected and
// working right up until the first real publish. wall.post's owner_id
// silently computed from Number(alias) as NaN, and VK's only feedback was
// the opaque "owner_id not integer" - no indication anything was wrong
// with the saved channel itself. Centralized here so every VK call site
// below fails the same clear way instead of forwarding NaN.
function vkGroupIdNumber(groupId: string): number {
  const value = Number(groupId.trim());
  if (!Number.isInteger(value) || value <= 0) {
    throw new PublishError("ID сообщества VK сохранён некорректно (не число). Отключите канал и подключите его заново, указав числовой ID сообщества из адресной строки.", false);
  }
  return value;
}

// VK's photo wall-upload methods require a user token in practice, while
// photos.getMessagesUploadServer is only for private messages and fails with
// error 901 when a community has no conversation permission. VK officially
// allows group tokens for the document wall-upload flow, and image documents
// can be attached to wall.post. This keeps the one-key community setup while
// avoiding both unsupported photo auth and private-message permissions.
async function uploadImageDocumentForWall(creds: VkCredentials, imageUrl: string): Promise<string> {
  const accessToken = creds.accessToken.trim();
  const uploadServer = await vkCall("docs.getWallUploadServer", {
    group_id: String(vkGroupIdNumber(creds.groupId)),
    access_token: accessToken,
  });
  const uploadUrl = uploadServer.upload_url;
  if (typeof uploadUrl !== "string") throw new PublishError("VK не выдал адрес для загрузки картинки.", true);

  const image = await fetchImageBytes(imageUrl);
  const imageBlob = new Blob([new Uint8Array(image.bytes)], { type: image.contentType });
  const form = new FormData();
  const extension = image.contentType === "image/png" ? "png" : image.contentType === "image/webp" ? "webp" : image.contentType === "image/gif" ? "gif" : "jpg";
  form.append("file", imageBlob, `post-image.${extension}`);

  let uploadResponse: Response;
  try {
    uploadResponse = await fetch(uploadUrl, { method: "POST", body: form, signal: AbortSignal.timeout(25_000) });
  } catch {
    throw new PublishError("Не удалось загрузить картинку на сервер VK.", true);
  }
  const uploadResult = await uploadResponse.json().catch(() => null) as
    | { file?: string; error?: string | { error_msg?: string } }
    | null;
  if (!uploadResponse.ok || !uploadResult?.file) {
    const providerMessage = typeof uploadResult?.error === "string"
      ? uploadResult.error.trim().slice(0, 300)
      : typeof uploadResult?.error?.error_msg === "string"
        ? uploadResult.error.error_msg.trim().slice(0, 300)
        : "";
    console.error("VK image upload rejected", {
      status: uploadResponse.status,
      contentType: image.contentType,
      byteLength: image.bytes.length,
      hasFile: Boolean(uploadResult?.file),
      providerMessage,
    });
    const retryable = uploadResponse.status === 429 || uploadResponse.status >= 500;
    throw new PublishError(`VK не принял загруженную картинку${providerMessage ? `: ${providerMessage}` : ""}.`, retryable);
  }

  const saved = await vkCall("docs.save", {
    file: uploadResult.file,
    title: `klio-image.${extension}`,
    access_token: accessToken,
  });
  const savedDocument = saved.doc as Record<string, unknown> | undefined;
  if (!savedDocument || typeof savedDocument.id !== "number" || typeof savedDocument.owner_id !== "number") {
    throw new PublishError("VK не подтвердил сохранение картинки.", true);
  }
  const accessKey = typeof savedDocument.access_key === "string" && savedDocument.access_key.trim()
    ? `_${savedDocument.access_key.trim()}`
    : "";
  return `doc${savedDocument.owner_id}_${savedDocument.id}${accessKey}`;
}

async function publishToVk(creds: VkCredentials, text: string, imageUrls: string[]): Promise<{ providerPostId: string }> {
  const photos = imageUrls.slice(0, 10);
  const hasImage = photos.length > 0;
  // Sequential, not Promise.all - each image is its own
  // getWallUploadServer + upload + docs.save, and VK's per-second rate limit
  // for a community token is tight enough that bursting up to 8 of these
  // at once risked tripping it. wall.post itself still runs exactly once,
  // after every upload has succeeded - same invariant the single-image
  // path already relied on for its retry classification below.
  const attachments: string[] = [];
  for (const url of photos) attachments.push(await uploadImageDocumentForWall(creds, url));

  const result = await vkCall("wall.post", {
    // wall.post addresses a community by its *negative* owner_id — every
    // other piece of this codebase (UI, storage, photo upload preparation
    // above) works with the plain positive community id VK's own admin
    // panel shows, so the negation happens right here at the one call site
    // that actually needs it.
    owner_id: String(-vkGroupIdNumber(creds.groupId)),
    from_group: "1",
    message: truncateForPlatform("vk", text, hasImage),
    ...(attachments.length ? { attachments: attachments.join(",") } : {}),
    access_token: creds.accessToken,
  });

  if (typeof result.post_id !== "number") throw new PublishError("VK не вернул id опубликованной записи.", true);
  return { providerPostId: String(result.post_id) };
}

// The one entry point every route/cron job should call. `credentialsJson`
// comes straight from the socialChannels row as stored — parsing and
// dispatch both happen here so a caller never needs to know the shape.
export async function publishToChannel(params: {
  platform: string;
  credentialsJson: string;
  text: string;
  imageUrls: string[];
}): Promise<{ providerPostId: string }> {
  let credentials: ChannelCredentials;
  try {
    credentials = JSON.parse(params.credentialsJson) as ChannelCredentials;
  } catch {
    throw new PublishError("Данные подключения канала повреждены. Переподключите канал.", false);
  }

  if (params.platform === "telegram" && credentials.platform === "telegram") {
    return publishToTelegram(credentials.telegram, params.text, params.imageUrls);
  }
  if (params.platform === "vk" && credentials.platform === "vk") {
    return publishToVk(credentials.vk, params.text, params.imageUrls);
  }
  throw new PublishError(`Неизвестная или несовпадающая площадка публикации: ${params.platform}.`, false);
}

// Re-exported so route handlers can report an accurate remaining-length
// counter in the editor without importing publishing-config directly.
export { PLATFORM_TEXT_LIMITS };
