// Dedicated image service. Do not install this over the Telegram Bot API relay.
// Deploy in an OpenAI-supported region with an eligible organization/account.
import { createServer } from "node:http";
import { timingSafeEqual, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

// gpt-image-1 only accepts three literal size values - "1024x1024",
// "1536x1024" or "1024x1536" (or "auto") - not an arbitrary WxH per aspect
// ratio. "1536x1152"/"1024x1280"/"1536x864" made OpenAI reject the request
// outright for 4:3/4:5/16:9. Each requested ratio now snaps to the nearest
// of the three real sizes.
const IMAGE_SIZE_BY_RATIO = {
  "1:1": "1024x1024",
  "4:3": "1536x1024",
  "16:9": "1536x1024",
  "4:5": "1024x1536",
  "9:16": "1024x1536",
};
const IMAGE_QUALITY_VALUES = new Set(["low", "medium", "high"]);
const IMAGE_FORMAT_VALUES = new Set(["png", "jpeg", "webp"]);
const IMAGE_BACKGROUND_VALUES = new Set(["auto", "transparent", "opaque"]);
// A prompt-only body is a few KB; a base64-encoded brand logo (uploads allow
// up to 8MB raw, ~33% larger once base64-encoded) is the large case. This
// cap was still sized for prompt-only bodies, so every logo-enabled request
// was rejected here before it ever reached OpenAI (site owner: image
// generation errors only when the logo toggle is on).
const MAX_REQUEST_BYTES = 12_000_000;

function resolveRequestSize(rawSize, aspectRatio) {
  if (typeof rawSize === "string" && /^\d+x\d+$/.test(rawSize)) return rawSize;
  if (typeof aspectRatio === "string" && IMAGE_SIZE_BY_RATIO[aspectRatio]) return IMAGE_SIZE_BY_RATIO[aspectRatio];
  return "1024x1024";
}

// gpt-image-2.5-flare default (was gpt-image-1) - a manual side-by-side
// test against gpt-image-1 (test-image-models.mjs in this session's
// scratchpad) confirmed it renders Russian headline text into a generated
// image far more reliably. Same accepted size literals as gpt-image-1
// (confirmed against the OpenAI API guide before switching this default -
// resolveRequestSize below still only ever sends one of those three), so
// this is a same-shape swap, not a request-format change. Pinned to the
// dated snapshot, not the bare rolling alias OpenAI also offers - the
// alias can start pointing at a different snapshot later without any
// change here, silently changing output; the dated pin matches exactly
// what was tested, and an upgrade later is a deliberate one-line bump.
export function imageService({ token, apiKey, model = "gpt-image-2.5-flare-2026-09-08", providerFetch = fetch }) {
  const jobs = new Map(); let running = 0;
  const authorized = value => {
    if (!token || token.length < 32) return false;
    const actual = Buffer.from(value || ""); const expected = Buffer.from(`Bearer ${token}`);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  return createServer(async (request, response) => {
    const reply = (status, body) => { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(body)); };
    if (request.method === "GET" && request.url === "/health") return reply(apiKey && token?.length >= 32 ? 200 : 503, { ready: Boolean(apiKey && token?.length >= 32) });
    if (request.method !== "POST" || request.url !== "/generate") return reply(404, { error: "Not found" });
    if (!authorized(request.headers.authorization)) return reply(401, { error: "Unauthorized" });
    if (!apiKey) return reply(503, { error: "Image provider is not configured" });
    const id = request.headers["idempotency-key"];
    if (typeof id !== "string" || !/^[a-zA-Z0-9-]{16,100}$/.test(id)) return reply(400, { error: "Idempotency key required" });
    let body;
    const timer = setTimeout(() => request.destroy(), 10_000);
    try {
      let size = 0; const chunks = [];
      for await (const chunk of request) { size += chunk.length; if (size > MAX_REQUEST_BYTES) { reply(413, { error: "Request too large" }); return; } chunks.push(chunk); }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch { return reply(400, { error: "Invalid request" }); }
    finally { clearTimeout(timer); }
    if (!body || typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 12000) return reply(400, { error: "Invalid prompt" });
    if (body.image_b64 !== undefined && (typeof body.image_b64 !== "string" || !body.image_b64 || typeof body.image_type !== "string" || !/^image\/[a-z0-9.+-]+$/i.test(body.image_type)))
      return reply(400, { error: "Invalid image" });
    const logo = body.image_b64 ? { bytes: Buffer.from(body.image_b64, "base64"), contentType: body.image_type } : null;
    // Lets one caller ask for a different model than this service's own
    // startup default, without redeploying the relay for every app that
    // uses it. Falls back silently rather than rejecting, same as quality/
    // output_format/background below - an invalid value here just means
    // OpenAI itself rejects the request downstream, same as a garbage
    // value ever did before this field existed.
    const requestedModel = typeof body.model === "string" && /^[a-zA-Z0-9_.-]{1,64}$/.test(body.model) ? body.model : model;
    const imageSize = resolveRequestSize(body.size, body.aspectRatio);
    const quality = IMAGE_QUALITY_VALUES.has(body.quality) ? body.quality : "medium";
    const outputFormat = IMAGE_FORMAT_VALUES.has(body.output_format) ? body.output_format : "png";
    const background = IMAGE_BACKGROUND_VALUES.has(body.background) ? body.background : "auto";
    const hash = createHash("sha256").update(body.prompt).update(logo ? logo.bytes : "").digest("hex");
    const previous = jobs.get(id);
    if (previous && previous.hash !== hash) return reply(409, { error: "Request key already used" });
    if (!previous && running >= 2) return reply(429, { error: "Image service is busy" });
    if (!previous) {
      // Small, bounded cache; the main application owns durable request state.
      for (const [key, job] of jobs) if (jobs.size >= 8 && job.done) jobs.delete(key);
      const job = { hash, done: false, result: null };
      running++;
      job.result = (async () => {
        try {
          let upstream;
          if (logo) {
            const form = new FormData();
            form.append("model", requestedModel);
            form.append("prompt", body.prompt);
            form.append("n", "1");
            if (body.size || body.aspectRatio) form.append("size", imageSize);
            if (body.quality) form.append("quality", quality);
            if (body.output_format) form.append("output_format", outputFormat);
            if (body.background) form.append("background", background);
            form.append("image", new Blob([logo.bytes], { type: logo.contentType }), "reference");
            upstream = await providerFetch("https://api.openai.com/v1/images/edits", {
              method: "POST", headers: { Authorization: `Bearer ${apiKey}` },
              body: form,
              signal: AbortSignal.timeout(150_000),
            });
          } else {
            const upstreamPayload = {
              model: requestedModel,
              prompt: body.prompt,
              n: 1,
              ...(body.size || body.aspectRatio ? { size: imageSize } : {}),
              ...(body.quality ? { quality } : {}),
              ...(body.output_format ? { output_format: outputFormat } : {}),
              ...(body.background ? { background } : {}),
            };
            upstream = await providerFetch("https://api.openai.com/v1/images/generations", {
              method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify(upstreamPayload),
              signal: AbortSignal.timeout(150_000),
            });
          }
          if (!upstream.ok) return { status: upstream.status === 400 ? 400 : 502, body: { error: "Image provider did not complete the request" } };
          const reader = upstream.body.getReader(); const chunks = []; let size = 0;
          try {
            while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 12_000_000) { await reader.cancel(); throw new Error("Image response too large"); } chunks.push(part.value); }
          } finally { reader.releaseLock(); }
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (typeof data.data?.[0]?.b64_json !== "string") throw new Error("Missing image");
          return { status: 200, body: { data: [{ b64_json: data.data[0].b64_json }], usage: data.usage } };
        } catch { return { status: 502, body: { error: "Image request failed" } }; }
        finally { running--; job.done = true; }
      })();
      jobs.set(id, job);
    }
    const result = await jobs.get(id).result;
    reply(result.status, result.body);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = imageService({ token: process.env.KLIO_IMAGE_SERVICE_TOKEN, apiKey: process.env.OPENAI_API_KEY, model: process.env.KLIO_IMAGE_MODEL });
  server.listen(Number(process.env.PORT || 10000), "0.0.0.0", () => console.log("KLIO image service listening"));
}
