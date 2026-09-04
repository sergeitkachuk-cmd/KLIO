// Actually talks to Telegram's Bot API and VK's classic API to publish one
// piece of content to one connected channel. The only call site outside
// this file that should exist is publishToChannel() below — everything
// platform-specific (endpoints, multi-step VK photo upload, response shape
// parsing) stays here so a future third platform is one more branch, not a
// rewrite. See publishing-config.ts for the credential shapes and limits
// this reads.

import { request as httpsRequest } from "node:https";
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
function postToTelegramApi(url: string, body: object): Promise<TelegramApiResponse> {
  const endpoint = new URL(url);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = httpsRequest({
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port || 443,
      path: `${endpoint.pathname}${endpoint.search}`,
      method: "POST",
      family: 4,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    request.setTimeout(25_000, () => request.destroy(new Error("Telegram API connection timed out after 25 seconds.")));
    request.on("error", reject);
    request.end(payload);
  });
}

async function fetchImageBytes(imageUrl: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(imageUrl);
  } catch {
    throw new PublishError("Не удалось загрузить картинку по ссылке перед публикацией.", true);
  }
  if (!response.ok) throw new PublishError(`Не удалось загрузить картинку по ссылке (HTTP ${response.status}).`, true);
  return response.blob();
}

async function publishToTelegram(creds: TelegramCredentials, text: string, imageUrl: string | null): Promise<{ providerPostId: string }> {
  const base = `https://api.telegram.org/bot${creds.botToken}`;
  const hasImage = Boolean(imageUrl);
  const body = hasImage
    ? { chat_id: creds.chatId, photo: imageUrl, caption: truncateForPlatform("telegram", text, true) }
    : { chat_id: creds.chatId, text: truncateForPlatform("telegram", text, false) };

  let response: TelegramApiResponse;
  try {
    response = await postToTelegramApi(`${base}/${hasImage ? "sendPhoto" : "sendMessage"}`, body);
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    // Credentials and post text never enter logs. The network error itself
    // does: it is the only way to distinguish a Timeweb egress/DNS issue
    // from Telegram returning an explicit API refusal.
    console.error("Telegram publish request failed", {
      message: error instanceof Error ? error.message : String(error),
      cause: cause instanceof Error ? cause.message : undefined,
    });
    throw new PublishError("Telegram не ответил на запрос публикации.", true);
  }

  const payload = (() => {
    try { return JSON.parse(response.body); } catch { return null; }
  })() as
    | { ok: boolean; result?: { message_id: number }; description?: string; error_code?: number }
    | null;

  if (!payload?.ok) {
    // 401/403 = bad/revoked bot token, 400 with "chat not found" = bot isn't
    // an admin of the channel (or chatId is wrong) — neither clears up on
    // its own, so these don't get the automatic cron retries a rate limit
    // or a momentary Telegram outage would.
    const permanent = response.status === 401 || response.status === 403 || response.status === 400;
    throw new PublishError(
      payload?.description ? `Telegram отклонил публикацию: ${payload.description}` : `Telegram отклонил публикацию (HTTP ${response.status}).`,
      !permanent,
    );
  }
  return { providerPostId: String(payload.result?.message_id ?? "") };
}

async function vkCall(method: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`https://api.vk.com/method/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, v: VK_API_VERSION }),
    });
  } catch {
    throw new PublishError("VK не ответил на запрос публикации.", true);
  }
  const payload = await response.json().catch(() => null) as
    | { response?: unknown; error?: { error_code: number; error_msg: string } }
    | null;
  if (!payload || payload.error) {
    const code = payload?.error?.error_code;
    // 5 = auth failed (revoked/invalid token), 15 = access denied (bot/user
    // lost admin rights on the community) — both need the owner to
    // reconnect the channel, not three more identical attempts.
    const permanent = code === 5 || code === 15 || code === 27;
    throw new PublishError(
      payload?.error ? `VK отклонил запрос: ${payload.error.error_msg}` : "VK вернул пустой ответ.",
      !permanent,
    );
  }
  return payload.response as Record<string, unknown>;
}

// VK won't attach an arbitrary external URL to a wall post — the image has
// to be uploaded into VK's own storage first, in three calls: get this
// community's upload endpoint, POST the actual bytes there, then register
// the result as a real wall photo. Only after that does wall.post's
// `attachments` param accept it. Four VK calls total per image post
// (this dance plus wall.post itself) versus Telegram's one — more moving
// parts, not more risk: every step here is a stable, long-documented VK
// method.
async function uploadPhotoForWall(creds: VkCredentials, imageUrl: string): Promise<string> {
  const photoAccessToken = creds.photoAccessToken?.trim();
  if (!photoAccessToken) {
    throw new PublishError("Для публикации VK с картинкой добавьте пользовательский токен для фото с правами «Стена» и «Фотографии».", false);
  }
  const uploadServer = await vkCall("photos.getWallUploadServer", {
    group_id: creds.groupId,
    access_token: photoAccessToken,
  });
  const uploadUrl = uploadServer.upload_url;
  if (typeof uploadUrl !== "string") throw new PublishError("VK не выдал адрес для загрузки картинки.", true);

  const imageBlob = await fetchImageBytes(imageUrl);
  const form = new FormData();
  form.append("photo", imageBlob, "post-image.jpg");

  let uploadResponse: Response;
  try {
    uploadResponse = await fetch(uploadUrl, { method: "POST", body: form });
  } catch {
    throw new PublishError("Не удалось загрузить картинку на сервер VK.", true);
  }
  const uploadResult = await uploadResponse.json().catch(() => null) as
    | { server?: number; photo?: string; hash?: string }
    | null;
  if (!uploadResult?.photo || !uploadResult.hash) throw new PublishError("VK не принял загруженную картинку.", true);

  const saved = await vkCall("photos.saveWallPhoto", {
    group_id: creds.groupId,
    photo: uploadResult.photo,
    server: String(uploadResult.server ?? ""),
    hash: uploadResult.hash,
    access_token: photoAccessToken,
  });
  const savedPhoto = Array.isArray(saved) ? saved[0] as Record<string, unknown> : undefined;
  if (!savedPhoto || typeof savedPhoto.id !== "number" || typeof savedPhoto.owner_id !== "number") {
    throw new PublishError("VK не подтвердил сохранение картинки.", true);
  }
  return `photo${savedPhoto.owner_id}_${savedPhoto.id}`;
}

async function publishToVk(creds: VkCredentials, text: string, imageUrl: string | null): Promise<{ providerPostId: string }> {
  const hasImage = Boolean(imageUrl);
  const attachment = imageUrl ? await uploadPhotoForWall(creds, imageUrl) : null;

  const result = await vkCall("wall.post", {
    // wall.post addresses a community by its *negative* owner_id — every
    // other piece of this codebase (UI, storage, groups.getWallUploadServer
    // above) works with the plain positive community id VK's own admin
    // panel shows, so the negation happens right here at the one call site
    // that actually needs it.
    owner_id: String(-Number(creds.groupId)),
    from_group: "1",
    message: truncateForPlatform("vk", text, hasImage),
    ...(attachment ? { attachments: attachment } : {}),
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
  imageUrl: string | null;
}): Promise<{ providerPostId: string }> {
  let credentials: ChannelCredentials;
  try {
    credentials = JSON.parse(params.credentialsJson) as ChannelCredentials;
  } catch {
    throw new PublishError("Данные подключения канала повреждены. Переподключите канал.", false);
  }

  if (params.platform === "telegram" && credentials.platform === "telegram") {
    return publishToTelegram(credentials.telegram, params.text, params.imageUrl);
  }
  if (params.platform === "vk" && credentials.platform === "vk") {
    return publishToVk(credentials.vk, params.text, params.imageUrl);
  }
  throw new PublishError(`Неизвестная или несовпадающая площадка публикации: ${params.platform}.`, false);
}

// Re-exported so route handlers can report an accurate remaining-length
// counter in the editor without importing publishing-config directly.
export { PLATFORM_TEXT_LIMITS };
